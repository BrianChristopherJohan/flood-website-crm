import { NextRequest, NextResponse } from "next/server";
import { communityJavaFetch } from "@/lib/javaApi";

export const dynamic = "force-dynamic";

function getToken(req: NextRequest): string | undefined {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? undefined;
}

export async function GET(req: NextRequest) {
  try {
    const data = await communityJavaFetch<{ count: number }>(
      "/notifications/unread-count",
      { token: getToken(req) },
    );
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ count: 0 }, { status: 200 });
  }
}
