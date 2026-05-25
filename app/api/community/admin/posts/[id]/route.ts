import { NextRequest, NextResponse } from "next/server";
import { communityJavaFetch } from "@/lib/javaApi";
import { bffToken } from "@/lib/bffAuth";

export const dynamic = "force-dynamic";

function extractToken(req: NextRequest): string | undefined {
  return bffToken(req);
}

/**
 * Admin-only delete that hits the community service's
 * /community/admin/posts/{id} endpoint (which is gated to ADMIN +
 * OPERATIONS_MANAGER on Spring's side). Used by the moderation queue
 * when an admin actions a report by removing the offending post.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await communityJavaFetch<void>(`/community/admin/posts/${id}`, {
      method: "DELETE",
      token: extractToken(req),
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status },
    );
  }
}
