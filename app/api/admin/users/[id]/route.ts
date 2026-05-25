import { NextRequest, NextResponse } from "next/server";
import { communityJavaFetch } from "@/lib/javaApi";

export const dynamic = "force-dynamic";

function extractToken(req: NextRequest): string | undefined {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? undefined;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const token = extractToken(req);
    const body = await req.json();
    const user = await communityJavaFetch<unknown>(`/admin/users/${id}`, {
      method: "PATCH",
      body,
      token,
    });
    return NextResponse.json(user);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const token = extractToken(req);
    await communityJavaFetch<void>(`/admin/users/${id}`, { method: "DELETE", token });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Delete failed" },
      { status: 500 }
    );
  }
}
