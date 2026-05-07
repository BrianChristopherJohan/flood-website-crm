import { NextRequest, NextResponse } from "next/server";
import { communityJavaFetch } from "@/lib/javaApi";

export const dynamic = "force-dynamic";

function getToken(req: NextRequest): string | undefined {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? undefined;
}

/**
 * GET /api/admin/surveys/uat — admin-only paginated list of UAT survey
 * responses. Forwarded to the Java backend's /admin/surveys/uat endpoint
 * (which enforces ADMIN/OPERATIONS_MANAGER via @PreAuthorize).
 *
 * Query params:
 *   ?page=N        — zero-indexed
 *   ?size=N        — page size (clamped 1..100 server-side)
 *   ?role=user|admin|both
 *   ?source=community|crm
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const params = url.searchParams.toString();
    const path = params ? `/admin/surveys/uat?${params}` : "/admin/surveys/uat";
    const data = await communityJavaFetch(path, { token: getToken(req) });
    return NextResponse.json(data);
  } catch (error) {
    console.error("[/api/admin/surveys/uat GET]", error);
    const status = (error as { status?: number }).status;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: status === 401 || status === 403 ? status : 500 },
    );
  }
}
