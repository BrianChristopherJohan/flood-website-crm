import { NextRequest, NextResponse } from "next/server";
import { communityJavaFetch } from "@/lib/javaApi";
import { bffToken } from "@/lib/bffAuth";

// The canonical user store is flood-service-community (flood_community DB):
// customers register there, the admin is seeded there, and the CRM logs in
// via the community SSO handoff. The CRM's own flood_crm DB holds no users,
// so User Management must read/write users through communityJavaFetch — using
// the CRM's own backend returns an empty list ("No users found"). The
// community /admin/users is ROLE_ADMIN-gated; the forwarded CRM admin JWT
// satisfies it (same as the other community admin routes).
export const dynamic = "force-dynamic";
export const revalidate = 0;

function extractToken(req: NextRequest): string | undefined {
  return bffToken(req);
}

export async function GET(req: NextRequest) {
  try {
    const token = extractToken(req);
    const users = await communityJavaFetch<unknown[]>("/admin/users", { token });
    return NextResponse.json(users);
  } catch (error) {
    // Use the upstream status directly (communityJavaFetch sets `.status`) instead
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
    const user = await communityJavaFetch<unknown>("/admin/users", { method: "POST", body, token });
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
