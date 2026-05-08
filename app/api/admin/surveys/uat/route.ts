import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getToken(req: NextRequest): string | undefined {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? undefined;
}

/**
 * Resolve the community Java service base URL.
 *
 * History — UAT surveys live ONLY on flood-service-community, but the
 * Vercel CRM deployment historically had `COMMUNITY_JAVA_API_URL`
 * unset, so the BFF fell through to `JAVA_API_URL` (which points at
 * flood-service-crm) and got 404 "Resource not found". The fallback
 * chain below resolves the right host even when the env variable is
 * missing in production by treating any non-localhost JAVA_API_URL as
 * a sign that we're on Vercel + Railway, and using the known
 * community service URL.
 */
function communityBase(): string {
  const explicit = process.env.COMMUNITY_JAVA_API_URL;
  if (explicit && explicit.length > 0) return explicit.replace(/\/$/, "");
  const fallback = process.env.JAVA_API_URL || "";
  if (fallback.includes("localhost") || fallback.includes("127.0.0.1")) {
    return fallback.replace(/\/$/, "");
  }
  return "https://flood-service-community-production.up.railway.app";
}

/**
 * GET /api/admin/surveys/uat — admin-only paginated list of UAT survey
 * responses. Forwarded to the community Java backend's /admin/surveys/uat
 * endpoint (which enforces ADMIN/OPERATIONS_MANAGER via @PreAuthorize).
 *
 * Query params:
 *   ?page=N        — zero-indexed
 *   ?size=N        — page size (clamped 1..100 server-side)
 *   ?role=user|admin|both
 *   ?source=community|crm
 */
export async function GET(req: NextRequest) {
  const token = getToken(req);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const url = new URL(req.url);
    const params = url.searchParams.toString();
    const target = `${communityBase()}/admin/surveys/uat${params ? `?${params}` : ""}`;
    const upstream = await fetch(target, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      return NextResponse.json(
        { error: text || `Upstream ${upstream.status}` },
        { status: upstream.status === 401 || upstream.status === 403 ? upstream.status : 500 },
      );
    }
    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[/api/admin/surveys/uat GET]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 },
    );
  }
}
