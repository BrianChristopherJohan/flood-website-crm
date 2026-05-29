import { NextRequest, NextResponse } from "next/server";
import { communityJavaFetch } from "@/lib/javaApi";
import { bffToken } from "@/lib/bffAuth";

export const dynamic = "force-dynamic";

function extractToken(req: NextRequest): string | undefined {
  return bffToken(req);
}

/**
 * GET — Spring `Page<AdminCommentListItemDto>` from flood-service-community
 * `GET /community/admin/comments`
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawPage = parseInt(searchParams.get("page") ?? "0", 10);
    const page = Math.max(0, isNaN(rawPage) ? 0 : rawPage);
    const rawSize = parseInt(searchParams.get("size") ?? "20", 10);
    const size = Math.max(1, Math.min(isNaN(rawSize) ? 20 : rawSize, 50));

    const token = extractToken(req);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = new URLSearchParams({ page: String(page), size: String(size) });
    const data = await communityJavaFetch<unknown>(`/community/admin/comments?${params}`, { token });
    return NextResponse.json(data);
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status },
    );
  }
}
