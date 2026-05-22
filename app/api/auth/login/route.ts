// POST /api/auth/login
//
// CRM-side proxy to the Java backend's `/auth/login`. Three things
// happen here that the Java backend doesn't:
//
//   1. Operator-class gate (H.4). We decode the JWT payload to read
//      its `role` claim and REJECT non-operator roles BEFORE returning
//      tokens to the browser. A Customer with valid credentials gets
//      a 403 with zero secrets exposed.
//
//   2. httpOnly cookie issuance (Phase 2.C). On success, we set the
//      access token as an httpOnly cookie so the Edge middleware can
//      gate protected paths server-side. The cookie is invisible to
//      JavaScript, closing the XSS window that pure localStorage
//      auth leaves open.
//
//   3. Backwards-compatible localStorage payload. We STILL return the
//      tokens in the JSON body so the existing AuthContext keeps
//      working during the migration. The middleware enforces using
//      the cookie; the bearer-from-localStorage path stays valid for
//      `authFetch` until that flow is replaced.
//
// The Java backend itself enforces signature validation on every
// subsequent request, so even if a forged token slipped past us
// the mutations would still fail server-side.

import { NextRequest, NextResponse } from "next/server";
import { javaFetch } from "@/lib/javaApi";
import { isOperatorJwtRole } from "@/lib/permissions";
import { decodeJwtPayload } from "@/lib/jwtPayload";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  authCookieOptions,
} from "@/lib/authCookies";

export const dynamic = "force-dynamic";

type JavaLoginResponse = {
  session?: { accessToken?: string; refreshToken?: string };
  user?: { role?: string; email?: string };
};

const CRM_ACCESS_DENIED_MESSAGE =
  "This account is not authorised for CRM access. " +
  "Please use the community website for end-user features.";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  let result: JavaLoginResponse;
  try {
    result = await javaFetch<JavaLoginResponse>("/auth/login", {
      method: "POST",
      body,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Login failed";
    const upstreamStatus = (error as { status?: number }).status;
    const status = upstreamStatus ?? 502;
    const isLocalBackend =
      (process.env.JAVA_API_URL ?? process.env.NEXT_PUBLIC_JAVA_API_URL ?? "")
        .includes("localhost");
    return NextResponse.json(
      {
        error: upstreamStatus
          ? msg
          : "CRM backend unavailable. Check JAVA_API_URL and make sure flood-service-crm is running.",
        detail: msg,
        hint: isLocalBackend
          ? "Your CRM frontend is pointing at http://localhost:4002. Start flood-service-crm on port 4002 or set JAVA_API_URL to the deployed backend."
          : "The configured CRM backend could not be reached. Verify JAVA_API_URL in .env.local or Vercel.",
      },
      { status },
    );
  }

  // ── Operator-class gate ────────────────────────────────────────
  const accessToken = result?.session?.accessToken;
  const userRole = result?.user?.role;
  const jwtPayload = decodeJwtPayload(accessToken);
  const effectiveRole =
    userRole ?? (typeof jwtPayload?.role === "string" ? jwtPayload.role : null);

  if (!isOperatorJwtRole(effectiveRole)) {
    console.warn(
      "[/api/auth/login] rejected non-operator login attempt",
      result?.user?.email ?? "(no email)",
      "role:",
      effectiveRole ?? "(unknown)",
    );
    return NextResponse.json(
      { error: CRM_ACCESS_DENIED_MESSAGE },
      { status: 403 },
    );
  }

  // ── Success: set httpOnly auth cookies + return JSON ──────────
  //
  // Cookie lifetimes intentionally generous; the middleware will reject
  // any cookie whose decoded JWT `exp` has elapsed, so the Set-Cookie
  // Max-Age is a soft upper bound — Java's own exp claim is the wall.
  const response = NextResponse.json(result);

  if (accessToken) {
    // Match the upstream JWT lifetime if we can read it, else 1 h.
    const exp = typeof jwtPayload?.exp === "number" ? jwtPayload.exp : 0;
    const remaining = Math.max(
      60,
      exp > 0 ? exp - Math.floor(Date.now() / 1000) : 60 * 60,
    );
    response.cookies.set(ACCESS_COOKIE, accessToken, authCookieOptions(remaining));
  }
  if (result?.session?.refreshToken) {
    // Refresh tokens live longer than access tokens — give them a 7-day
    // soft ceiling, the Java side does the real expiry check.
    response.cookies.set(
      REFRESH_COOKIE,
      result.session.refreshToken,
      authCookieOptions(60 * 60 * 24 * 7),
    );
  }

  return response;
}
