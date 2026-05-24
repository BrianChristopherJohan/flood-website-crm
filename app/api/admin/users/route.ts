import { NextRequest, NextResponse } from "next/server";
import { javaFetch } from "@/lib/javaApi";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function extractToken(req: NextRequest): string | undefined {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? undefined;
}

export async function GET(req: NextRequest) {
  try {
    const token = extractToken(req);
    const users = await javaFetch<unknown[]>("/admin/users", { token });
    return NextResponse.json(users);
  } catch (error) {
    // Use the upstream status directly (javaFetch sets `.status`) instead
    // of fragile string-matching on the error message.
    const err = error as { status?: number; message?: string };
    const status = err.status === 401 || err.status === 403 ? err.status : 500;
    console.error(`[/api/admin/users GET] status=${err.status ?? "?"} msg=${err.message ?? ""}`);
    return NextResponse.json({ error: "Failed to fetch users" }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = extractToken(req);
    const body = await req.json();
    const user = await javaFetch<unknown>("/admin/users", { method: "POST", body, token });
    return NextResponse.json(user);
  } catch (error) {
    const err = error as { status?: number; message?: string };
    // 409 = already exists; forward 401/403 too. Surface the upstream
    // message for 409 only (it's user-actionable, e.g. "email taken").
    const status =
      err.status === 409 ? 409
      : err.status === 401 || err.status === 403 ? err.status
      : 500;
    console.error(`[/api/admin/users POST] status=${err.status ?? "?"} msg=${err.message ?? ""}`);
    return NextResponse.json(
      { error: status === 409 ? (err.message || "User already exists") : "Failed to create user" },
      { status },
    );
  }
}
