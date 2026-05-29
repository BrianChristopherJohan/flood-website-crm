import { NextRequest, NextResponse } from "next/server";
import { communityJavaFetch } from "@/lib/javaApi";

export const dynamic = "force-dynamic";

function extractToken(req: NextRequest): string | undefined {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? undefined;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Sanitise page — non-negative integer
    const rawPage = parseInt(searchParams.get("page") ?? "0", 10);
    const page = Math.max(0, isNaN(rawPage) ? 0 : rawPage);

    // Clamp size to 1–100
    const rawSize = parseInt(searchParams.get("size") ?? "20", 10);
    const size = Math.max(1, Math.min(isNaN(rawSize) ? 20 : rawSize, 100));

    // Whitelist sort
    const rawSort = searchParams.get("sort") ?? "new";
    const sort = rawSort === "top" ? "top" : "new";

    // Optional filters — forward as-is (Java backend validates)
    const group  = searchParams.get("group")  ?? "";
    const search = searchParams.get("search") ?? "";

    const token = extractToken(req);

    const params = new URLSearchParams({ page: String(page), size: String(size), sort });
    if (group)  params.set("group",  encodeURIComponent(group));
    if (search) params.set("search", encodeURIComponent(search));

    // Community posts live in flood-service-community (flood_community DB),
    // NOT the CRM's own backend. Use communityJavaFetch so the CRM
    // moderation view shows the SAME feed as the community website.
    const data = await communityJavaFetch<unknown>(`/community/posts?${params}`, { token });
    return NextResponse.json(data);
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status },
    );
  }
}
