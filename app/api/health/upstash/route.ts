// GET /api/health/upstash
//
// Diagnostic endpoint for the SSO storage backend (now Railway Redis,
// previously Upstash — the endpoint name is preserved for any external
// bookmark / monitoring check that already polls this path).
//
// Reports whether the Vercel deployment can actually talk to Redis,
// and surfaces the upstream error verbatim if it can't.
//
// Why this exists: when /api/auth/sso/start 503s in production with a
// generic "service_unavailable", the only way to find out whether
// (a) REDIS_URL is missing, (b) the host is unreachable, or (c) the
// password is wrong is by reading Vercel function logs. Most
// operators don't have CLI access to those. This endpoint surfaces
// the same info as a single curl-friendly JSON response.
//
// Returns:
//   200 { ok: true, ping: "PONG", host, port, ... }
//   503 { ok: false, reason, host, port, upstreamError }
//
// Privacy: emits only the URL HOSTNAME, port, and database number.
// The password is never echoed back. The SSO payloads never appear
// in any of these responses.

import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const url = process.env.REDIS_URL ?? null;

  if (!url) {
    return NextResponse.json(
      {
        ok: false,
        reason: "env_var_missing",
        hint:
          "Set REDIS_URL on this Vercel project — use the Railway " +
          "Redis plugin's ${{Redis.REDIS_URL}} reference, or paste the " +
          "DATABASE_PUBLIC_URL from the Variables tab.",
      },
      { status: 503 },
    );
  }

  // Fingerprint info we can echo back safely.
  let host: string | null = null;
  let port: string | null = null;
  let dbIndex: string | null = null;
  let scheme: string | null = null;
  try {
    const u = new URL(url);
    host = u.hostname;
    port = u.port || (u.protocol === "rediss:" ? "6380" : "6379");
    dbIndex = u.pathname.slice(1) || "0";
    scheme = u.protocol.slice(0, -1); // "redis" or "rediss"
  } catch {
    return NextResponse.json(
      {
        ok: false,
        reason: "url_malformed",
        hint:
          "REDIS_URL is set but not a valid URL. Expected " +
          "redis://default:PASSWORD@HOST:PORT/0 or rediss://… for TLS.",
      },
      { status: 503 },
    );
  }

  try {
    // Use the adapter's PING. ioredis's connect happens lazily on
    // the first command; AbortSignal isn't supported, so we wrap
    // in Promise.race with our own timeout.
    const result = (await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("PING timed out after 5 s")), 5_000),
      ),
    ])) as string;

    return NextResponse.json({
      ok: true,
      ping: { result },
      host,
      port,
      dbIndex,
      scheme,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const looksLikeAuth = /WRONGPASS|NOAUTH|authentication/i.test(msg);
    const looksLikeConn = /ECONN|timed out|ENOTFOUND|getaddrinfo|EAI_/i.test(msg);
    return NextResponse.json(
      {
        ok: false,
        reason: looksLikeAuth
          ? "upstream_rejected"
          : looksLikeConn
            ? "upstream_unreachable"
            : "upstream_error",
        host,
        port,
        dbIndex,
        scheme,
        upstreamError: msg,
        hint: looksLikeAuth
          ? "Password in REDIS_URL is wrong. Open Railway → Redis plugin " +
            "→ Variables, copy the current DATABASE_PUBLIC_URL (or use the " +
            "${{Redis.REDIS_URL}} template ref so it follows credential " +
            "rotation), and redeploy."
          : looksLikeConn
            ? "Cannot reach the Redis host. Check Railway plugin status " +
              "and confirm the host/port in REDIS_URL match the plugin's " +
              "current variables."
            : "Unexpected error talking to Redis — see upstreamError above.",
      },
      { status: 503 },
    );
  }
}
