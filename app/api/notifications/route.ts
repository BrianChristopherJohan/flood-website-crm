import { NextRequest, NextResponse } from "next/server";
import { communityJavaFetch } from "@/lib/javaApi";

export const dynamic = "force-dynamic";

function getToken(req: NextRequest): string | undefined {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? undefined;
}

/** GET /api/notifications?page=0&size=20 — bell dropdown list. */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const qs = url.searchParams.toString();
    const data = await communityJavaFetch<unknown>(
      qs ? `/notifications?${qs}` : "/notifications",
      { token: getToken(req) },
    );
    return NextResponse.json(data);
  } catch (error) {
    const status = (error as { status?: number }).status;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: status === 401 || status === 403 ? status : 500 },
    );
  }
}
