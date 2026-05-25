// GET /api/iot/zones?dataset=...
//
// Derived "sensor circle" feed for the CRM /map page.
//
// NOTE on the route name. The CRM already exposes `/api/zones` —
// THAT route serves the Java backend's admin-defined flood-risk
// polygon zones used by the broadcasts and dashboard pages. To
// avoid collision we publish the IoT-derived sensor circles at
// `/api/iot/zones` instead. The community app uses `/api/zones` for
// the IoT shape directly because it never had the Java polygons.
//
// The data path mirrors the community equivalent:
//   1. Fetch live `IoTNode` + `IoTVillage` from the FloodWatch API
//   2. Resolve each node's coordinate (install GPS → live GPS →
//      village-centroid + per-node FNV-1a jitter for unfixed nodes)
//   3. Adapt to `RawSensorRow` and fold through `aggregateZones`
//      so the response is anonymised (hashed IDs, lat/lng rounded
//      to ~11 m)
//
// The browser never sees raw `node_id` plaintext or precise GPS.

import { NextRequest, NextResponse } from "next/server";

import {
  FloodwatchFetchError,
  floodwatchFetch,
} from "@/lib/floodwatch/api";
import type {
  Dataset,
  IoTNode,
  IoTVillage,
} from "@/lib/floodwatch/types";
import {
  aggregateZones,
  type RawSensorRow,
} from "@/lib/zoneAggregate";
import type { FloodLevel } from "@/lib/types";
import { withCache } from "@/lib/redis";

/**
 * Short server-side cache TTL (seconds) for the aggregated zone feed.
 *
 * The upstream FloodWatch IoT FastAPI is cold-started and slow on the
 * first hit, so an un-cached dashboard/map load can take several
 * seconds. We cache the *already-anonymised* `aggregateZones` output
 * (hashed IDs, lat/lng rounded to ~11 m) in Redis for a few seconds —
 * repeated loads and tab switches then return in single-digit ms while
 * the data stays effectively real-time. 12 s is short enough that the
 * SSE-driven refetch still surfaces fresh readings promptly.
 *
 * NOTE: this is a *server-side* cache of the privacy-safe output only.
 * The HTTP `Cache-Control: no-store` header below is preserved so the
 * browser/edge still never caches the response — the privacy boundary
 * is unchanged.
 */
const ZONES_CACHE_TTL = 12;

/**
 * Deterministic small-circle jitter for nodes without a GPS fix. We
 * place them near their village centroid so they still get a circle on
 * the map — offset by a per-node FNV-1a hash so the operator can tell
 * them apart instead of every uncalibrated node piling on one dot.
 *
 * Offset bounded to ≈80 m which keeps the marker inside the village
 * footprint while honestly conveying "we don't know exactly where this
 * sensor is yet". Stable across reloads — a node doesn't appear to
 * teleport between refreshes.
 */
function jitterFromNodeId(nodeId: string): { dLat: number; dLng: number } {
  let h = 2166136261;
  for (let i = 0; i < nodeId.length; i++) {
    h ^= nodeId.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  const ux = ((h & 0xffff) / 0xffff) * 2 - 1;
  const uy = (((h >>> 16) & 0xffff) / 0xffff) * 2 - 1;
  const radius = 0.00072; // ≈80 m at Pitas latitudes
  return { dLat: ux * radius, dLng: uy * radius };
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const dataset = (req.nextUrl.searchParams.get("dataset") ?? undefined) as
    | Dataset
    | undefined;

  try {
    // Cache-aside on the anonymised output. `withCache` fails open: a
    // Redis hiccup just falls through to a live fetch, so correctness
    // never depends on the cache being up.
    const zones = await withCache(
      `iot:zones:${dataset ?? "default"}`,
      ZONES_CACHE_TTL,
      async () => {
        const [nodes, villages] = await Promise.all([
          floodwatchFetch<IoTNode[]>("/nodes", {
            params: dataset ? { dataset } : undefined,
          }),
          floodwatchFetch<IoTVillage[]>("/villages", {
            params: dataset ? { dataset } : undefined,
          }).catch(() => [] as IoTVillage[]),
        ]);

        const villageCoords = new Map<string, { lat: number; lng: number }>();
        for (const v of villages) {
          if (typeof v.lat === "number" && typeof v.lng === "number") {
            villageCoords.set(v.village_id, { lat: v.lat, lng: v.lng });
          }
        }

        const rows: RawSensorRow[] = nodes.map((n) => {
          // Coordinate resolution order:
          //   1. calibrated install GPS (`install_lat/install_lng`)
          //   2. live GPS fix (`lat/lng`) when present and non-zero
          //   3. village centroid + deterministic per-node jitter (~80 m)
          let lat = n.install_lat ?? n.lat ?? 0;
          let lng = n.install_lng ?? n.lng ?? 0;
          if (!Number(lat) || !Number(lng)) {
            const v = villageCoords.get(n.village_id);
            if (v) {
              const { dLat, dLng } = jitterFromNodeId(n.node_id);
              lat = v.lat + dLat;
              lng = v.lng + dLng;
            }
          }
          return {
            id: n.node_id,
            nodeId: n.node_id,
            name: null,
            area: n.village_id,
            location: n.village_id,
            state: "Sabah",
            latitude: Number(lat) || 0,
            longitude: Number(lng) || 0,
            currentLevel: (n.water_level ?? 0) as FloodLevel,
            status: n.status === "offline" ? "inactive" : "active",
            lastUpdated: n.last_seen,
          };
        });

        return aggregateZones(rows);
      },
    );

    return new NextResponse(JSON.stringify(zones), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // Privacy boundary: never cache at the edge.
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    });
  } catch (error) {
    if (error instanceof FloodwatchFetchError) {
      return NextResponse.json(
        { error: error.message, status: error.status },
        { status: error.status || 502 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}
