import { NextRequest, NextResponse } from "next/server";
import { communityJavaFetch } from "@/lib/javaApi";

export const dynamic = "force-dynamic";

function getToken(req: NextRequest): string | undefined {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? undefined;
}

/**
 * POST /api/surveys/uat — submit a UAT survey response.
 *
 * Forwards the payload to the Java backend, which stores all responses
 * (community + CRM) in the same Postgres table so admins can review and
 * export from a single source of truth.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = await communityJavaFetch("/surveys/uat", {
      method: "POST",
      body,
      token: getToken(req),
    });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("[/api/surveys/uat POST]", error);
    const status = (error as { status?: number }).status;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: status === 401 || status === 403 ? status : 500 },
    );
  }
}
