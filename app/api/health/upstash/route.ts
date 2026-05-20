// GET /api/health/upstash
//
// Diagnostic endpoint for the SSO storage backend. Reports whether the
// Vercel deployment can actually talk to Upstash, and surfaces the
// upstream error verbatim if it can't.
//
// Why this exists: when /api/auth/sso/start 503s in production with a
// generic "service_unavailable", the only way to find out whether
// (a) the env vars are missing, (b) the token is wrong, or (c) the
// Upstash project itself is gone is by reading Vercel function logs.
// Most operators don't have CLI access to those. This endpoint
// surfaces the same info as a single curl-friendly JSON response.
//
// Returns:
//   200 { ok: true, ping: "PONG", urlHost, tokenPrefix, ... }
//   503 { ok: false, reason, urlHost, tokenPrefix, upstreamError }
//
// Privacy: emits only the URL HOSTNAME (a public DNS name) and the
// first 8 characters of the token (not reversible). The actual SSO
// payloads never appear in any of these responses.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? null;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? null;

  // Stable identity-safe fingerprints we can echo back.
  let urlHost: string | null = null;
  try {
    urlHost = url ? new URL(url).host : null;
  } catch {
    urlHost = "<malformed URL>";
  }
  const tokenPrefix = token ? token.slice(0, 8) + "…" : null;

  if (!url || !token) {
    return NextResponse.json(
      {
        ok: false,
        reason: "env_vars_missing",
        hasUrl: Boolean(url),
        hasToken: Boolean(token),
        hint:
          "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN on the " +
          "community Vercel project (Production + Preview) and redeploy.",
      },
      { status: 503 },
    );
  }

  // Probe upstream with the simplest possible command. PING is free
  // and unambiguous.
  try {
    const res = await fetch(url + "/PING", {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
      // 5 s is plenty — Upstash's median is well under 100 ms.
      signal: AbortSignal.timeout(5_000),
    });
    const bodyText = await res.text().catch(() => "");
    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          reason: "upstream_rejected",
          urlHost,
          tokenPrefix,
          status: res.status,
          upstreamBody: bodyText.slice(0, 200),
          hint:
            res.status === 401
              ? "UPSTASH_REDIS_REST_TOKEN is invalid for this Upstash instance. " +
                "Open Upstash console, open the matching DB, copy the REST API " +
                "TOKEN, paste it into Vercel community env vars, and redeploy."
              : res.status === 404
                ? "UPSTASH_REDIS_REST_URL points at a non-existent endpoint. " +
                  "Confirm the URL in Vercel env vars matches the one shown " +
                  "in the Upstash console for this DB."
                : "Upstash returned a non-OK status. See upstreamBody for context.",
        },
        { status: 503 },
      );
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      // Upstash returns plain text "PONG" for some configurations.
    }
    return NextResponse.json({
      ok: true,
      ping: parsed ?? bodyText.slice(0, 64),
      urlHost,
      tokenPrefix,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        reason: "upstream_unreachable",
        urlHost,
        tokenPrefix,
        upstreamError: msg,
        hint:
          /timeout|abort/i.test(msg)
            ? "Upstash REST endpoint timed out. Check Upstash status + that " +
              "the URL host resolves from Vercel's region."
            : "Fetch to Upstash threw before a response. The URL is probably " +
              "malformed or the host doesn't exist.",
      },
      { status: 503 },
    );
  }
}
