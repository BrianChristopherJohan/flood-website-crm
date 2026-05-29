import { NextResponse } from "next/server";
import { communityJavaFetch } from "@/lib/javaApi";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await communityJavaFetch<string[]>("/blogs/categories");
    return NextResponse.json(Array.isArray(data) ? data : []);
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
