import { NextRequest, NextResponse } from "next/server";
import { communityJavaFetch } from "@/lib/javaApi";
import { bffToken } from "@/lib/bffAuth";

export const dynamic = "force-dynamic";

function extractToken(req: NextRequest): string | undefined {
  return bffToken(req);
}

/** PATCH — `{ action: "hide" | "restore" | "delete" }` → `PATCH /community/admin/comments/{id}` */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const token = extractToken(req);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await ctx.params;
    const body: unknown = await req.json();

    await communityJavaFetch<void>(`/community/admin/comments/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
      token,
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
