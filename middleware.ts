/**
 * Edge middleware — CRM access gate (Phase 2.A of the hardening plan).
 *
 * Every request to a protected path passes through here BEFORE Next.js
 * matches a route. We read the httpOnly access-token cookie set by
 * `/api/auth/login` (and `/auth/callback` once that's wired), decode
 * the JWT payload, and reject any request whose token is missing,
 * expired, or carries a non-operator-class role.
 *
 * This is the SERVER-SIDE enforcement layer that complements the four
 * client-side guards already in place:
 *   1. `/api/auth/login` server-side role rejection (H.4)
 *   2. Pre-hydration `auth-callback-init` script (H.5)
 *   3. `AppShellWrapper` auto-logout (H.6)
 *   4. Java backend signature validation on every authenticated call
 *
 * Signature verification at the edge:
 *   When `JWT_SECRET` is set in the environment (matching the same
 *   secret the Java backend signs with), we cryptographically verify
 *   the JWT here BEFORE the role check. A forged token — even one
 *   with a future `exp` and an operator role — fails at this gate
 *   and never sees the protected page render.
 *
 *   When `JWT_SECRET` is unset (transitional / dev environments
 *   without access to the shared secret), we fall back to payload-
 *   only validation: structure + `exp` + `role`. The Java backend's
 *   own signature check on every authenticated request remains the
 *   final wall — a forged token can still load page chrome but
 *   cannot perform any operation that talks to Java.
 *
 *   To enable full verification in production: copy the value of
 *   `JWT_SECRET` from the `flood-service-crm` Railway service to the
 *   `flood-website-crm` Vercel project (Production + Preview).
 *
 * Edge runtime caveats:
 *   • `Buffer` is NOT available — `jwtPayload.ts` falls back to `atob`
 *   • Throwing inside middleware crashes the request; catch everything
 *   • Cookies are read via `req.cookies` (not `next/headers`)
 *
 * Public paths (login, callback, health, static assets) are skipped
 * via the `matcher` config below.
 */

import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/authCookies";
import {
  decodeJwtPayload,
  isTokenStructurallyValid,
  verifyJwtSignature,
} from "@/lib/jwtPayload";
import { isOperatorJwtRole } from "@/lib/permissions";

/**
 * Build the /login redirect URL with an error code so the form can
 * render the right banner (H.7). Preserves the originally-requested
 * URL in `?callbackUrl=` so successful sign-in can bounce back.
 */
function loginRedirect(req: NextRequest, errorCode: string): NextResponse {
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("error", errorCode);
  const requested = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  if (requested !== "/" && !requested.startsWith("/login")) {
    loginUrl.searchParams.set("callbackUrl", requested);
  }
  // Clear the auth cookies so a malformed or non-operator token
  // can't keep replaying the same redirect.
  const res = NextResponse.redirect(loginUrl);
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}

export async function middleware(req: NextRequest) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;

  // No cookie → no session. AppShellWrapper will also redirect on the
  // client side, but rejecting here means the page payload never
  // ships to an unauthenticated browser.
  if (!token) {
    return loginRedirect(req, "expired");
  }

  // ── Cryptographic verification ────────────────────────────────
  //
  // `JWT_SECRET` is REQUIRED in production. With it set, `jose.jwtVerify`
  // enforces:
  //   - the signature matches (rejects forged tokens)
  //   - the `exp` claim is in the future
  //   - the alg is HS256 (rejects "alg: none" attacks)
  //
  // The previous "silent payload-only fallback" was deleted (QA P0-1):
  // an attacker who could write a JWT with a future `exp` + operator
  // role would have walked past the gate on any Vercel project where
  // the env var was forgotten. We now FAIL CLOSED — missing secret =
  // reject the request with a tagged error code that the login page
  // surfaces as "Sign-in is misconfigured. Contact your administrator."
  //
  // The fallback still exists for local dev, but it's opt-in via an
  // explicit `ALLOW_PAYLOAD_ONLY_AUTH=true` env var. CI checks reject
  // builds where that flag is set alongside `NODE_ENV=production`.
  const secret = process.env.JWT_SECRET;
  if (secret) {
    const verified = await verifyJwtSignature(token, secret);
    if (!verified.ok) {
      // Distinct error codes (QA P1-1) — the login form renders the
      // right banner, and ops can search Vercel logs for the actual
      // failure mode instead of just "expired" everywhere.
      const code =
        verified.reason === "expired"
          ? "expired"
          : verified.reason === "invalid-signature"
            ? "invalid_signature"
            : "malformed";
      return loginRedirect(req, code);
    }
    const role =
      typeof verified.payload.role === "string" ? verified.payload.role : null;
    if (!isOperatorJwtRole(role)) {
      return loginRedirect(req, "role");
    }
    return NextResponse.next();
  }

  // ── No secret configured ─────────────────────────────────────────
  if (process.env.ALLOW_PAYLOAD_ONLY_AUTH === "true") {
    // Dev / staging opt-in only. Java's signature check is still the
    // wall against forgery; this just lets `pnpm dev` work without
    // copying the secret around. NEVER true in production.
    if (process.env.NODE_ENV === "production") {
      // Belt-and-braces: even if someone toggles the env var on prod,
      // refuse to honour it. Defence in depth.
      return loginRedirect(req, "misconfigured");
    }
    if (!isTokenStructurallyValid(token)) {
      return loginRedirect(req, "expired");
    }
    const payload = decodeJwtPayload(token);
    const role = typeof payload?.role === "string" ? payload.role : null;
    if (!isOperatorJwtRole(role)) {
      return loginRedirect(req, "role");
    }
    return NextResponse.next();
  }

  // No secret AND no opt-in: reject loudly. Better than a silent
  // bypass that hides a misconfig until someone notices in prod.
  return loginRedirect(req, "misconfigured");
}

/**
 * Matcher — paths the middleware runs on.
 *
 * Everything is gated EXCEPT:
 *   - /login + /auth/callback (the auth flow itself)
 *   - /api/* (handled by per-route logic + Java backend signature
 *     check; gating BFF routes here would prevent the login flow
 *     from even running)
 *   - /_next/* (build artefacts, fonts, images, RSC streams)
 *   - /favicon.ico / .png assets
 *
 * The matcher uses Next.js's negative lookahead syntax: only paths
 * NOT matching the excluded patterns run through the middleware.
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - login (the form itself)
     * - auth/callback (the SSO bridge)
     * - api (BFF + auth routes — gated per-route, not here)
     * - _next/static (build artefacts)
     * - _next/image (image optimisation API)
     * - images (raw public/images/* assets — login hero, logo, etc.)
     * - favicon.ico, icon.png, apple-icon.png, manifest.webmanifest
     */
    "/((?!login|auth/callback|api|_next/static|_next/image|images|favicon.ico|icon.png|apple-icon.png|manifest.webmanifest).*)",
  ],
};
