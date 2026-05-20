// /auth/callback — top-level GET route handler that forwards the SSO
// handoff into the redeem route, which sets cookies and 303s to
// /dashboard (or /login?error=…).
//
// Why this is a Route Handler, not a Page:
//   Next.js 16 forbids `cookies().set(...)` outside Server Actions
//   and Route Handlers. We also need a *real* HTTP 307/303 redirect
//   (not the RSC-embedded soft-redirect `redirect()` emits from a
//   page server component), so curl, integration tests, and crawlers
//   all follow the same path browsers do.
//
// Two URL shapes still accepted:
//
//   NEW    ?code=<opaque 32-byte URL-safe random>
//   LEGACY ?at=<token>&rt=<token>&u=<json>
//
// Both 307-forward verbatim into `/api/auth/sso/redeem`. That route
// handler picks the right path based on which params are present,
// attaches Set-Cookie, and 303s onward.

import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/authCookies";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Defensive cookie sweep before we hand off to the redeem endpoint.
 *
 * If the user is arriving at /auth/callback?code=… they're starting
 * a fresh SSO handoff. Any cookies currently sitting in their browser
 * for this domain are from a previous attempt. If THAT previous
 * attempt failed mid-stream (rare, but happened during the post-
 * Railway-cutover bring-up), the browser kept sending stale
 * `flood_crm_access` / `flood_crm_refresh` cookies that the
 * middleware then rejected — putting the user into a "logged in but
 * 401'd" loop with no obvious recovery.
 *
 * Clearing them on the 307 response (BEFORE the redeem runs) means:
 *
 *   - If redeem succeeds, it overwrites with fresh values on its
 *     303 to /dashboard → user lands clean.
 *   - If redeem fails, the user lands on /login?error=… with no
 *     stale cookies left over → the next attempt starts truly fresh.
 *
 * Costs ~0 bytes; eliminates a class of impossible-to-debug login
 * loops.
 */
function attachStaleCookieClear(res: NextResponse): NextResponse {
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const at = url.searchParams.get("at");
  const rt = url.searchParams.get("rt");

  const target = new URL("/api/auth/sso/redeem", url.origin);
  if (code) {
    target.searchParams.set("code", code);
  } else if (at && rt) {
    target.searchParams.set("at", at);
    target.searchParams.set("rt", rt);
  } else {
    return attachStaleCookieClear(
      NextResponse.redirect(
        new URL("/login?error=callback", url.origin),
        303,
      ),
    );
  }

  // 307 preserves the GET method and forwards the query string.
  // Stale cookies get cleared on this same response so the redeem
  // step starts with a clean slate.
  return attachStaleCookieClear(NextResponse.redirect(target, 307));
}
