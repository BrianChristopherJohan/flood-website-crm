import { NextRequest, NextResponse } from "next/server";
import { communityJavaFetch } from "@/lib/javaApi";
import { bffToken } from "@/lib/bffAuth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Public blog articles live in flood-service-community (flood_community DB) —
// the same source the community website + mobile app read. The CRM manages
// those articles, so every blog route must use communityJavaFetch, NOT the
// CRM's own backend (which has no blog data). No server-side caching here:
// this is a low-traffic admin page and stale lists would hide an operator's
// own create/edit/delete for minutes.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page     = searchParams.get("page")     ?? "0";
    const size     = searchParams.get("size")     ?? "50";
    const category = searchParams.get("category") ?? "";

    const cat = category && category !== "All" ? category : "all";
    const catParam = cat !== "all" ? `&category=${encodeURIComponent(cat)}` : "";

    const data = await communityJavaFetch<unknown>(
      `/blogs?page=${page}&size=${size}${catParam}`,
    );
    return NextResponse.json(data);
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = bffToken(req);
    const body = await req.json();
    const data = await communityJavaFetch<unknown>("/blogs", { method: "POST", body, token });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}
