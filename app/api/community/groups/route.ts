import { NextRequest, NextResponse } from "next/server";
import { communityJavaFetch } from "@/lib/javaApi";
import { bffToken } from "@/lib/bffAuth";

export const dynamic = "force-dynamic";

function extractToken(req: NextRequest) {
  return bffToken(req);
}

// Community groups live in flood-service-community (flood_community DB), not
// the CRM's own backend — use communityJavaFetch so the CRM shows (and
// manages) the SAME groups as the community website.
export async function GET(req: NextRequest) {
  try {
    const token = extractToken(req);
    const data = await communityJavaFetch<unknown>("/community/groups", { token });
    return NextResponse.json(data);
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = extractToken(req);
    const body = await req.json();
    // POST /community/groups is @PreAuthorize("hasRole('ADMIN')") on the
    // community service; the forwarded CRM admin JWT satisfies it.
    const data = await communityJavaFetch<unknown>("/community/groups", { method: "POST", body, token });
    return NextResponse.json(data);
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}
