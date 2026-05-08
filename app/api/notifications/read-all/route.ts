import { NextRequest, NextResponse } from "next/server";
import { communityJavaFetch } from "@/lib/javaApi";

export const dynamic = "force-dynamic";

function getToken(req: NextRequest): string | undefined {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? undefined;
}

export async function POST(req: NextRequest) {
  try {
    const data = await communityJavaFetch<{ updated: number }>(
      "/notifications/read-all",
      { method: "POST", token: getToken(req) },
    );
    return NextResponse.json(data);
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status },
    );
  }
}
