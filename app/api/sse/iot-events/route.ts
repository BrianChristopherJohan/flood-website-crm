// GET /api/sse/iot-events?types=...&dataset=...
//
// Pipes the FloodWatch IoT SSE stream to the CRM browser. The browser's
// EventSource cannot add headers nor speak directly to the upstream
// (CORS is permissive but routing through the BFF keeps client logic
// trivial), so this route opens the upstream connection and forwards
// each event.
//
// PRIVACY NOTE (CRM-specific):
//   The community site strips `lat`/`lng`/`rssi`/`snr` from heartbeats
//   and drops `node_announce` entirely. The CRM is different:
//   operators NEED those diagnostic fields to run fleet health checks,
//   so the proxy here forwards every event verbatim. Geographic
//   coordinates are still subject to the privacy aggregator on the
//   /api/zones route — but the SSE channel itself is permissive.
//
// AUTH:
//   None on the IoT API itself. The CRM-side gate is the session
//   middleware on the rest of the app; an unauthenticated client
//   could technically open this stream, but they couldn't reach any
//   of the operator pages that consume it. Future hardening can
//   gate the SSE route via the same auth as the operator app.
//
// CRLF: The upstream is Starlette/Uvicorn (FastAPI) which emits SSE
// messages with CRLF separators (`\r\n\r\n`). The boundary detector
// below accepts both LF and CRLF so we don't lose events.

import { NextResponse } from "next/server";

import { buildStreamUrl } from "@/lib/floodwatch/api";
import type { Dataset } from "@/lib/floodwatch/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** SSE stays open until disconnect. Vercel caps by plan; 300s on Pro. */
export const maxDuration = 300;

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sseError(reason: string): NextResponse {
  const body = sseEvent("backend-unavailable", { reason });
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "close",
    },
  });
}

/**
 * Locate the next SSE message boundary in `buffer` starting at `from`.
 * SSE spec allows either LF or CRLF line endings — Starlette/Uvicorn
 * (the FloodWatch IoT backend) uses CRLF. We accept both `\n\n` and
 * `\r\n\r\n` so the proxy works regardless of upstream framing.
 */
function findMessageBoundary(
  buffer: string,
  from = 0,
): { idx: number; sep: number } | null {
  const crlf = buffer.indexOf("\r\n\r\n", from);
  const lf = buffer.indexOf("\n\n", from);
  if (crlf === -1 && lf === -1) return null;
  if (crlf === -1) return { idx: lf, sep: 2 };
  if (lf === -1) return { idx: crlf, sep: 4 };
  return crlf <= lf ? { idx: crlf, sep: 4 } : { idx: lf, sep: 2 };
}

/**
 * Forward each upstream SSE message verbatim. No field stripping, no
 * event filtering — operators see everything. The only transform is
 * boundary detection so we emit one well-formed SSE message at a
 * time downstream (mirroring how the community proxy is structured,
 * which simplifies future privacy hardening if needed).
 */
/**
 * Fire-and-forget Web Push dispatch for flood-level≥2 alerts.
 *
 * The CRM SSE proxy forwards the same upstream IoT events the community
 * proxy does. To make sure operators get OS-level push even when the
 * CRM tab is closed, we fire a dispatch from BOTH apps. The
 * community-side /api/push/dispatch endpoint owns the Java subscription
 * list + the Redis dedupe, so cross-app duplicate dispatches collapse
 * to a single push at the dedupe layer (5-min cooldown per
 * `{nodeId, alertType}`).
 *
 * The dispatch URL lives on the COMMUNITY Vercel project — the Java
 * subscriptions are persisted there. CRM POSTs cross-domain
 * fire-and-forget. The endpoint is auth-free (see its route comment
 * for the rationale).
 */
function maybeFirePush(eventName: string, payload: Record<string, unknown>): void {
  if (eventName !== "alert") return;
  const alertType = typeof payload.alert_type === "string" ? payload.alert_type : null;
  const level = typeof payload.level === "number" ? payload.level : 0;
  const shouldPush =
    (alertType === "flood" && level >= 2) ||
    alertType === "battery_critical" ||
    (alertType === "water_fall" && level >= 2);
  if (!shouldPush) return;

  const nodeId = typeof payload.node_id === "string" ? payload.node_id : null;
  if (!nodeId) return;

  const communityBase =
    process.env.NEXT_PUBLIC_COMMUNITY_URL ?? "https://flood-website-community.vercel.app";
  const dispatchUrl = `${communityBase.replace(/\/$/, "")}/api/push/dispatch`;

  fetch(dispatchUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nodeId,
      villageId: typeof payload.village_id === "string" ? payload.village_id : undefined,
      alertType,
      level,
      timestamp:
        typeof payload.timestamp === "string" ? payload.timestamp : new Date().toISOString(),
      source: "crm" as const,
    }),
  }).catch((err) => {
    console.warn(
      "[crm/sse/iot-events] push dispatch fire-and-forget failed:",
      err instanceof Error ? err.message : err,
    );
  });
}

function makeForwardTransform(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let boundary: ReturnType<typeof findMessageBoundary>;
      while ((boundary = findMessageBoundary(buffer)) !== null) {
        const raw = buffer.slice(0, boundary.idx + boundary.sep);
        buffer = buffer.slice(boundary.idx + boundary.sep);

        // Side-effect: fire-and-forget Web Push dispatch on alert
        // events that meet the push threshold. The browser still
        // gets the SSE message in-tab; this is the OS-level pathway.
        try {
          const text = decoder.decode(encoder.encode(raw));
          const lines = text.split(/\r?\n/);
          let eventName: string | null = null;
          let dataLine: string | null = null;
          for (const line of lines) {
            if (eventName === null && line.startsWith("event:")) {
              eventName = line.slice(6).trim();
            } else if (dataLine === null && line.startsWith("data:")) {
              dataLine = line.slice(5).trim();
            }
          }
          if (eventName === "alert" && dataLine) {
            const parsed = JSON.parse(dataLine) as Record<string, unknown>;
            maybeFirePush(eventName, parsed);
          }
        } catch {
          // Parse failure — forward to browser anyway, just no push.
        }

        controller.enqueue(encoder.encode(raw));
      }
    },
    flush(controller) {
      if (buffer.length > 0) controller.enqueue(encoder.encode(buffer));
    },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const types = url.searchParams.get("types") ?? undefined;
  const dataset = (url.searchParams.get("dataset") ?? undefined) as
    | Dataset
    | undefined;

  const upstreamUrl = buildStreamUrl({ types, dataset });

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      },
      cache: "no-store",
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      console.error(
        "[api/sse/iot-events] upstream non-OK:",
        upstream.status,
        upstreamUrl,
        detail.slice(0, 400),
      );
      return sseError("upstream_error");
    }

    if (!upstream.body) {
      console.error("[api/sse/iot-events] missing response body:", upstreamUrl);
      return sseError("upstream_no_body");
    }

    const forwarded = upstream.body.pipeThrough(makeForwardTransform());

    return new NextResponse(forwarded, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("[api/sse/iot-events] upstream fetch failed:", upstreamUrl, err);
    return sseError("upstream_unreachable");
  }
}
