// POST /api/auth/sso/redeem
//
// Redeem a one-time SSO handoff code from the community login. The
// `/auth/callback` server component normally calls this logic INLINE
// (saves a same-origin fetch + cookie-forwarding dance), but this
// route handler exists as an externally-callable counterpart for:
//   - mobile or external clients that ever want to bridge via SSO
//   - integration tests that need to drive the flow via curl
//
// Steps:
//   1. Validate code shape.
//   2. `GETDEL sso:<code>` from Upstash — one-shot.
//   3. Verify the access-token JWT signature with JWT_SECRET (CRM
//      is the only side that holds the secret; this is the wall
//      against tampered or forged bundles).
//   4. Re-validate the role server-side.
//   5. Set httpOnly access + refresh cookies on the CRM origin.
//   6. Return 200 { ok: true } — the cookies do the work.
//
// Failure modes (all clear stale cookies as a side effect):
//   400 { error: "bad_request" }           — body missing or malformed code
//   410 { error: "code_invalid_or_expired" } — unknown / already redeemed / TTL
//   403 { error: "not_operator" }          — role rejected
//   503 { error: "service_unavailable" }   — Upstash blip
//   500 { error: "redeem_failed" }         — JWT verify failed (forged bundle)

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
import { redeemSsoCode } from "@/lib/sso";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fail(status: number, error: string): NextResponse {
  const res = NextResponse.json({ error }, { status });
  // Side effect: clear any stale cookies on rejection so a previous
  // operator session can't survive a botched handoff.
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}

export async function POST(req: NextRequest) {
  let body: { code?: string };
  try {
    body = (await req.json()) as { code?: string };
  } catch {
    return fail(400, "bad_request");
  }
  const code = body?.code;
  if (typeof code !== "string" || code.length === 0) {
    return fail(400, "bad_request");
  }

  const payload = await redeemSsoCode(code);
  if (payload === null) {
    // Either expired (60 s TTL), already redeemed (atomic GETDEL),
    // or never existed. Indistinguishable — and that's deliberate.
    return fail(410, "code_invalid_or_expired");
  }

  // ── JWT signature gate (QA P0-1 — fail closed without secret) ─
  const secret = process.env.JWT_SECRET;
  let jwtRole: string | null;
  let exp: number | null = null;
  if (secret) {
    const verified = await verifyJwtSignature(payload.accessToken, secret);
    if (!verified.ok) {
      // Bundle tampered with in Upstash (unlikely — we mint it
      // from our own login flow) OR JWT_SECRET drifted between
      // Java and CRM.
      return fail(500, "redeem_failed");
    }
    jwtRole =
      typeof verified.payload.role === "string" ? verified.payload.role : null;
    exp =
      typeof verified.payload.exp === "number" ? verified.payload.exp : null;
  } else if (
    process.env.ALLOW_PAYLOAD_ONLY_AUTH === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    // Opt-in dev fallback only. Java's signature verification on
    // every authenticated call is still the wall.
    const decoded = decodeJwtPayload(payload.accessToken);
    jwtRole = typeof decoded?.role === "string" ? decoded.role : null;
    exp = typeof decoded?.exp === "number" ? decoded.exp : null;
  } else {
    console.error(
      "[sso/redeem] JWT_SECRET not set; refusing redeem. " +
        "Set JWT_SECRET on Vercel to match the Java backend secret.",
    );
    return fail(503, "misconfigured");
  }

  // ── Role gate ───────────────────────────────────────────────
  if (!isOperatorRole(jwtRole)) {
    return fail(403, "not_operator");
  }

  // ── Set cookies ─────────────────────────────────────────────
  const nowSec = Math.floor(Date.now() / 1000);
  const accessMaxAge = Math.max(60, exp !== null ? exp - nowSec : 60 * 60);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    ACCESS_COOKIE,
    payload.accessToken,
    authCookieOptions(accessMaxAge),
  );
  res.cookies.set(
    REFRESH_COOKIE,
    payload.refreshToken,
    authCookieOptions(60 * 60 * 24 * 7), // 7 days
  );
  return res;
}
