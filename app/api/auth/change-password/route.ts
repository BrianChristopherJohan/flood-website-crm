import { NextRequest, NextResponse } from "next/server";
import { javaFetch } from "@/lib/javaApi";
import { ACCESS_COOKIE } from "@/lib/authCookies";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * POST /api/auth/change-password
 *
 * BFF proxy to Java POST /auth/change-password. Authenticated.
 *
 * Token resolution (QA NEW-2):
 *   1. Read the httpOnly `flood_crm_access` cookie (the canonical
 *      token store after the cookie migration).
 *   2. Fall back to `Authorization: Bearer …` header for any legacy
 *      caller still passing tokens explicitly (mobile, integration
 *      tests, the AuthContext.changePassword path before it gets
 *      refactored to drop the accessToken state).
 *
 * Before this fix the route only accepted the Authorization header,
 * so a normal browser session — which has the cookie but cannot read
 * it in JS — got 401 on every password-change attempt.
 *
 * Body: { currentPassword: string; newPassword: string }
 */
export async function POST(req: NextRequest) {
  try {
    const cookieToken = req.cookies.get(ACCESS_COOKIE)?.value;
    const headerToken = req.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "");
    const token = cookieToken ?? headerToken;
    if (!token) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }
    const body = await req.json();
    const data = await javaFetch<{ message: string }>(
      "/auth/change-password",
      {
        method: "POST",
        body,
        token,
        timeoutMs: 12_000,
      },
    );
    return NextResponse.json(data);
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Password change failed",
      },
      { status },
    );
  }
}
