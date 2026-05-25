import { NextRequest, NextResponse } from "next/server";
import { javaFetch } from "@/lib/javaApi";
import { withCache, CACHE_TTL } from "@/lib/redis";
import { bffToken } from "@/lib/bffAuth";

export const revalidate = 0;
export const dynamic = "force-dynamic";

/**
 * GET /api/analytics — operator analytics dashboard data.
 *
 * Hardening (2026-05-21):
 *   - Fail-open on Redis: if `withCache` throws (e.g. Redis unreachable
 *     on a cold start, or the cache provider was unset), still serve the
 *     fresh upstream result. Previously a Redis blip turned the whole
 *     analytics page into "Failed to load" — the cache should be an
 *     accelerator, not a single point of failure.
 *   - Propagate the upstream status code + a structured error code so
 *     the page can render specific guidance (`service_starting` on Java
 *     cold start, `redis_unavailable`, etc.) instead of a generic toast.
 *   - Distinguish 401/403 from 5xx so the AuthContext can know whether
 *     to silent-refresh or surface the failure.
 */
export async function GET(req: NextRequest) {
  // Source the JWT from the httpOnly cookie first, falling back to the
  // Authorization header. On the cookie-based session (SSO handoff /
  // fresh login) the client AuthContext never holds an in-memory access
  // token, so the header is empty after a page load — reading the cookie
  // is what keeps analytics loading instead of spinning forever.
  const token = bffToken(req);
  if (!token) {
    return NextResponse.json(
      { error: "Not authenticated", code: "missing_token" },
      { status: 401 },
    );
  }

  const cacheKey = `crm:analytics:${token.slice(-8)}`;
  const fetchUpstream = () => javaFetch("/analytics", { token });

  try {
    // Try cache first; if Redis fails, fall through to a raw fetch so the
    // page still works even when the cache layer is down.
    let data: unknown;
    try {
      data = await withCache(cacheKey, CACHE_TTL.analytics, fetchUpstream);
    } catch (cacheErr) {
      console.warn(
        "[/api/analytics] cache layer unavailable, falling back to direct fetch:",
        cacheErr instanceof Error ? cacheErr.message : cacheErr,
      );
      data = await fetchUpstream();
    }
    return NextResponse.json(data);
  } catch (error) {
    // Surface the actual Java error so the page can give a useful message.
    const err = error as { status?: number; message?: string; body?: unknown };
    const status = err.status ?? 500;
    const httpStatus =
      status === 401 || status === 403 || status === 502 || status === 503
        ? status
        : 500;
    const code =
      httpStatus === 401
        ? "unauthorized"
        : httpStatus === 403
          ? "forbidden"
          : httpStatus === 502 || httpStatus === 503
            ? "service_starting"
            : "upstream_error";

    console.error(
      `[/api/analytics] upstream failed status=${status} code=${code} msg=${err.message ?? "(no message)"}`,
      err.body ? `body=${JSON.stringify(err.body).slice(0, 300)}` : "",
    );

    return NextResponse.json(
      {
        error: err.message ?? "Failed to fetch analytics",
        code,
        upstreamStatus: status,
      },
      { status: httpStatus },
    );
  }
}
