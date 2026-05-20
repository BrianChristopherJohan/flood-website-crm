// /api/auth/sso/redeem
//
// Redeem a one-time SSO handoff code from the community login.
// Two transports:
//
//   GET  /api/auth/sso/redeem?code=…
//   GET  /api/auth/sso/redeem?at=…&rt=…            (legacy)
//        — Called by the `/auth/callback` server-component page,
//          which can't set cookies itself (Next.js 16 restriction).
//          On success: 303 Location: /dashboard with Set-Cookie.
//          On failure: 303 Location: /login?error=…
//
//   POST /api/auth/sso/redeem   { code }
//        — External callers / integration tests. On success: 200
//          { ok: true } with Set-Cookie. On failure: tagged JSON
//          + status code.
//
// Steps for both:
//   1. Validate input shape.
//   2. `GETDEL sso:<code>` from Upstash — one-shot.
//   3. Verify the access-token JWT signature with JWT_SECRET.
//   4. Re-validate role server-side.
//   5. Set httpOnly access + refresh cookies.
//   6. Return success.
//
// Failure modes (all clear stale cookies as a side effect):
//   400  bad_request                — body / query missing or malformed code
//   410  code_invalid_or_expired    — unknown / already redeemed / TTL
//   403  not_operator               — role rejected
//   503  misconfigured              — JWT_SECRET missing in prod
//   500  redeem_failed              — JWT verify failed (forged bundle)

import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  authCookieOptions,
} from "@/lib/authCookies";
import {
  decodeJwtPayload,
  verifyJwtSignature,
} from "@/lib/jwtPayload";
import { isOperatorRole } from "@/lib/rbac";
import { redeemSsoCode, type SsoPayload } from "@/lib/sso";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RedeemOutcome =
  | { ok: true; accessToken: string; refreshToken: string; accessMaxAge: number }
  | { ok: false; status: number; error: string };

/**
 * Shared core. Both GET and POST funnel through here.
 *
 * On success returns the access / refresh tokens + computed max-age
 * so the wrapper can attach Set-Cookie + the right HTTP response
 * (JSON for POST, redirect for GET).
 */
async function redeemCore(opts: {
  code?: string | null;
  at?: string | null;
  rt?: string | null;
}): Promise<RedeemOutcome> {
  let payload: SsoPayload | null = null;

  if (opts.code) {
    if (opts.code.length === 0) return { ok: false, status: 400, error: "bad_request" };
    payload = await redeemSsoCode(opts.code);
    if (payload === null) {
      // Either expired (60s TTL), already redeemed (atomic GETDEL),
      // or never existed. Indistinguishable — and deliberate.
      return { ok: false, status: 410, error: "code_invalid_or_expired" };
    }
  } else if (opts.at && opts.rt) {
    // Legacy ?at=&rt=&u= path. Trust the URL contents — the JWT
    // signature check below still gates everything that matters.
    payload = {
      accessToken: opts.at,
      refreshToken: opts.rt,
      user: { id: "", email: "", displayName: "", role: "" },
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  } else {
    return { ok: false, status: 400, error: "bad_request" };
  }

  // ── JWT signature gate ─────────────────────────────────────────
  const secret = process.env.JWT_SECRET;
  let jwtRole: string | null;
  let exp: number | null = null;
  if (secret) {
    const verified = await verifyJwtSignature(payload.accessToken, secret);
    if (!verified.ok) {
      return { ok: false, status: 500, error: "redeem_failed" };
    }
    jwtRole =
      typeof verified.payload.role === "string" ? verified.payload.role : null;
    exp =
      typeof verified.payload.exp === "number" ? verified.payload.exp : null;
  } else if (
    process.env.ALLOW_PAYLOAD_ONLY_AUTH === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    const decoded = decodeJwtPayload(payload.accessToken);
    jwtRole = typeof decoded?.role === "string" ? decoded.role : null;
    exp = typeof decoded?.exp === "number" ? decoded.exp : null;
  } else {
    console.error(
      "[sso/redeem] JWT_SECRET not set; refusing redeem. " +
        "Set JWT_SECRET on Vercel to match the Java backend secret.",
    );
    return { ok: false, status: 503, error: "misconfigured" };
  }

  if (!isOperatorRole(jwtRole)) {
    return { ok: false, status: 403, error: "not_operator" };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const accessMaxAge = Math.max(60, exp !== null ? exp - nowSec : 60 * 60);
  return {
    ok: true,
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    accessMaxAge,
  };
}

function attachCookiesOnSuccess(
  res: NextResponse,
  outcome: { accessToken: string; refreshToken: string; accessMaxAge: number },
): NextResponse {
  res.cookies.set(
    ACCESS_COOKIE,
    outcome.accessToken,
    authCookieOptions(outcome.accessMaxAge),
  );
  res.cookies.set(
    REFRESH_COOKIE,
    outcome.refreshToken,
    authCookieOptions(60 * 60 * 24 * 7),
  );
  return res;
}

function clearCookiesOnFailure(res: NextResponse): NextResponse {
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}

// ── GET — the path the /auth/callback page redirects into ───────────
//
// Redirect on every outcome so the browser ends up on a clean URL
// (/dashboard or /login?error=…). Cookies attach to the redirect
// response so they reach the browser before the next navigation.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const outcome = await redeemCore({
    code: url.searchParams.get("code"),
    at: url.searchParams.get("at"),
    rt: url.searchParams.get("rt"),
  });

  const origin = url.origin;
  if (outcome.ok) {
    const res = NextResponse.redirect(new URL("/dashboard", origin), 303);
    return attachCookiesOnSuccess(res, outcome);
  }

  // Map failure → friendly login banner code.
  const errorCode =
    outcome.error === "code_invalid_or_expired"
      ? "sso_expired"
      : outcome.error === "not_operator"
        ? "role"
        : outcome.error === "misconfigured"
          ? "misconfigured"
          : "sso_failed";

  const res = NextResponse.redirect(
    new URL(`/login?error=${errorCode}`, origin),
    303,
  );
  return clearCookiesOnFailure(res);
}

// ── POST — external callers (integration tests, mobile) ─────────────
export async function POST(req: NextRequest) {
  let body: { code?: string };
  try {
    body = (await req.json()) as { code?: string };
  } catch {
    return clearCookiesOnFailure(
      NextResponse.json({ error: "bad_request" }, { status: 400 }),
    );
  }
  const outcome = await redeemCore({ code: body?.code });
  if (outcome.ok) {
    return attachCookiesOnSuccess(
      NextResponse.json({ ok: true }),
      outcome,
    );
  }
  return clearCookiesOnFailure(
    NextResponse.json({ error: outcome.error }, { status: outcome.status }),
  );
}
