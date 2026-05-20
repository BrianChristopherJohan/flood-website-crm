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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    return NextResponse.redirect(
      new URL("/login?error=callback", url.origin),
      303,
    );
  }

  // 307 preserves the GET method and forwards the query string.
  return NextResponse.redirect(target, 307);
}
