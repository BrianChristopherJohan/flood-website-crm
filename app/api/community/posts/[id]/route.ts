import { NextRequest, NextResponse } from "next/server";
import { communityJavaFetch } from "@/lib/javaApi";
import { bffToken } from "@/lib/bffAuth";

export const dynamic = "force-dynamic";

function extractToken(req: NextRequest): string | undefined {
  return bffToken(req);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const token = extractToken(req);
    // Moderation delete — hit the community service's admin endpoint
    // (ADMIN / OPERATIONS_MANAGER gated, can remove ANY post), not the
    // author-only /community/posts/{id}. The post lives in flood_community,
    // so this must go through communityJavaFetch.
    await communityJavaFetch<void>(`/community/admin/posts/${id}`, { method: "DELETE", token });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}
