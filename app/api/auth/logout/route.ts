// /api/auth/logout — both POST (client-driven) and GET (browser-nav)
//
// POST is the canonical path called by the client AuthContext
// `logout()` helper after it wipes localStorage — cookies linger
// otherwise and the middleware would let the next request through.
//
// GET exists so the community-side "Reset session and try again"
// button can clear CRM cookies via a top-level cross-origin navigation
// (no fetch + no CORS preflight needed). The endpoint clears cookies
// then redirects the browser to `?next=<url>` (or community login by
// default). This is the recovery hatch when stale cookies from an
// earlier failed SSO attempt are blocking the user from logging in.
//
// Both verbs do best-effort revocation against Java's `/auth/logout`
// using the refresh token from the cookie. A 4xx from Java is fine —
// local cookies still get cleared, the user-facing recovery succeeds.

import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/authCookies";
import { javaFetch } from "@/lib/javaApi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Allow-list of safe redirect targets for the `?next=` query parameter.
 * Prevents this endpoint being abused as an open-redirect by anyone
 * who can craft a URL the user trusts (the CRM is on a fixed host;
 * `next` can only point at the configured community URL, the CRM
 * itself, or a relative path).
 */
function isSafeNext(next: string): boolean {
  if (next.startsWith("/")) return true; // relative — same host
  const communityUrl = process.env.NEXT_PUBLIC_COMMUNITY_URL;
  if (communityUrl) {
    try {
      const target = new URL(next);
      const allowed = new URL(communityUrl);
      if (target.origin === allowed.origin) return true;
    } catch {
      /* fall through */
    }
  }
  return false;
}

async function revokeAtJava(req: NextRequest): Promise<void> {
  try {
    const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
    if (!refreshToken) return;
    await javaFetch<unknown>("/auth/logout", {
      method: "POST",
      body: { refreshToken },
    }).catch(() => {
      /* Java offline / 4xx — proceed with cookie wipe */
    });
  } catch {
    /* never let a Java failure block local cookie wipe */
  }
}

function clearAuthCookies(res: NextResponse): NextResponse {
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}

export async function POST(req: NextRequest) {
  await revokeAtJava(req);
  return clearAuthCookies(NextResponse.json({ ok: true }));
}

export async function GET(req: NextRequest) {
  await revokeAtJava(req);
  const url = new URL(req.url);
  const nextParam = url.searchParams.get("next");
  const communityUrl =
    process.env.NEXT_PUBLIC_COMMUNITY_URL || "http://localhost:3002";
  const defaultNext = `${communityUrl}/login`;
  const target =
    nextParam && isSafeNext(nextParam) ? nextParam : defaultNext;
  // 303 See Other — the browser issues a clean GET against `next`
  // even though it arrived here via GET. Set-Cookie deletes are
  // attached to this response so they reach the browser before the
  // next navigation.
  const res = NextResponse.redirect(target, 303);
  return clearAuthCookies(res);
}
