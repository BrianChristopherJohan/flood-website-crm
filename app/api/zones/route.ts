// GET /api/zones — list all flood risk zones

import { NextRequest, NextResponse } from "next/server";
import { javaFetch } from "@/lib/javaApi";

export const dynamic = "force-dynamic";

function getToken(req: NextRequest): string | undefined {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? undefined;
}

export async function GET(req: NextRequest) {
  const token = getToken(req);
  // This route is Java-backed and operator-gated (used by the Broadcasts
  // page). Reject anonymous callers up front with a clean 401 instead of
  // letting the upstream 401 surface as a generic 500.
  if (!token) {
    return NextResponse.json(
      { error: "Authentication required", code: "missing_token" },
      { status: 401 },
    );
  }
  try {
    const data = await javaFetch("/zones", { token });
    return NextResponse.json(data);
  } catch (error) {
    // Forward the upstream status (401/403/404/5xx) instead of masking
    // everything as 500. javaFetch sets `.status`; log only status+message
    // server-side, never the raw upstream body.
    const err = error as { status?: number; message?: string };
    const status = err.status ?? 502;
    console.error(`[/api/zones GET] upstream status=${status} msg=${err.message ?? "(none)"}`);
    return NextResponse.json(
      { error: "Failed to fetch zones", upstreamStatus: status },
      { status: status === 401 || status === 403 || status === 404 ? status : 502 },
    );
  }
}
