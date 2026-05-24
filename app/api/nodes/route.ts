// ─────────────────────────────────────────────────────────────
// GET /api/nodes
//
// BFF proxy — fetches sensor nodes from the Java Spring Boot API,
// caches in Redis for 30 s, returns the NodeData shape.
//
// LEGACY ROUTE NOTE (2026-05-18):
//   The /map page no longer consumes this route — it pulls live
//   sensor data from `/api/iot/zones` (FloodWatch IoT API). This
//   route stays in service for the remaining CRM pages
//   (/sensors, /analytics, /dashboard, /alerts, /settings) that
//   still depend on the Java backend's NodeData shape. Those pages
//   migrate to `/api/iot/*` in a follow-up Phase 5 ticket.
//
// Cache strategy:
//   - Key: "crm:nodes:all"
//   - TTL: 30 s (near real-time sensor polling)
//   - Invalidation: automatic expiry (sensor data refreshes on its own)
// ─────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { javaFetch, type JavaSensorDto } from "@/lib/javaApi";
import { withCache, CACHE_TTL } from "@/lib/redis";
import type { NodeData } from "@/lib/types";

export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") ?? undefined;
    const token = authHeader?.replace(/^Bearer\s+/i, "");

    const nodes = await withCache<NodeData[]>(
      "crm:nodes:all",
      CACHE_TTL.nodes,
      async () => {
        const sensors = await javaFetch<JavaSensorDto[]>("/sensors", { token });

        return sensors.map((s) => ({
          _id: s.id,
          node_id: s.nodeId,
          name: s.name,
          area: s.area,
          location: s.location,
          state: s.state,
          latitude: s.coordinate[1],
          longitude: s.coordinate[0],
          current_level: s.currentLevel ?? 0,
          is_dead: s.isDead ?? s.status === "inactive",
          last_updated: s.lastUpdated,
          created_at: s.createdAt,
        }));
      }
    );

    return NextResponse.json({
      success: true,
      data: nodes,
      count: nodes.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Log only status + message (never the raw error object, which can
    // carry the upstream response body). Don't echo internal messages
    // to the client either.
    const err = error as { status?: number; message?: string };
    console.error(`[/api/nodes] upstream status=${err.status ?? "?"} msg=${err.message ?? ""}`);
    const httpStatus = err.status === 401 || err.status === 403 ? err.status : 502;
    return NextResponse.json(
      { success: false, error: "Failed to fetch nodes data" },
      { status: httpStatus }
    );
  }
}
