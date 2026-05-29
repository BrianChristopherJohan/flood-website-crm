import type { NextRequest } from "next/server";

import { ACCESS_COOKIE } from "@/lib/authCookies";

/**
 * Resolve the JWT access token for a BFF → backend call.
 *
 * Prefers the httpOnly `flood_crm_access` cookie, which is ALWAYS present
 * for an authenticated session — including after a full page reload, when
 * the client AuthContext has no in-memory access token to put in the
 * Authorization header. Falls back to the `Authorization: Bearer …` header
 * for any caller that still sends one.
 *
 * Why this matters: every role-gated backend call (post/group/blog/user
 * moderation) was forwarding only the header token. After a reload that
 * header is empty, so the backend got no credentials and replied 401 —
 * mutations silently failed. Sourcing from the cookie makes server-to-
 * server auth resilient to the client's in-memory state.
 */
export function bffToken(req: NextRequest): string | undefined {
  const cookieToken = req.cookies.get(ACCESS_COOKIE)?.value;
  if (cookieToken && cookieToken.length > 0) return cookieToken;
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? undefined;
}
