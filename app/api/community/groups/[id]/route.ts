import { NextRequest, NextResponse } from "next/server";
import { communityJavaFetch } from "@/lib/javaApi";

export const dynamic = "force-dynamic";

function extractToken(req: NextRequest) {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? undefined;
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const token = extractToken(req);
    // Moderation delete via the community service's admin endpoint
    // (ADMIN / OPERATIONS_MANAGER gated). The group lives in
    // flood_community, so route through communityJavaFetch.
    await communityJavaFetch<void>(`/community/admin/groups/${id}`, { method: "DELETE", token });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const token = extractToken(req);
    const body = await req.json();
    // Moderation edit (name / description / icon colour) via the community
    // service's admin endpoint (ADMIN / OPERATIONS_MANAGER gated). The group
    // lives in flood_community, so route through communityJavaFetch.
    const data = await communityJavaFetch<unknown>(`/community/admin/groups/${id}`, {
      method: "PATCH",
      body,
      token,
    });
    return NextResponse.json(data);
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}
