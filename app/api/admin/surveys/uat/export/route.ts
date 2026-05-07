import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getToken(req: NextRequest): string | undefined {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? undefined;
}

const JAVA_BASE = (
  process.env.COMMUNITY_JAVA_API_URL ||
  process.env.JAVA_API_URL ||
  process.env.NEXT_PUBLIC_JAVA_API_URL ||
  "http://localhost:4001"
).replace(/\/$/, "");

/**
 * GET /api/admin/surveys/uat/export — admin-only CSV download.
 *
 * Forwards the raw CSV bytes from the Java backend so the browser sees a
 * real attachment download (Content-Disposition is preserved) and Excel
 * can open the file directly without a JSON-to-CSV conversion step in
 * the BFF.
 */
export async function GET(req: NextRequest) {
  const token = getToken(req);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const upstream = await fetch(`${JAVA_BASE}/admin/surveys/uat/export`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "text/csv",
      },
      cache: "no-store",
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: text || `Upstream ${upstream.status}` },
        { status: upstream.status === 401 || upstream.status === 403 ? upstream.status : 500 },
      );
    }

    const body = await upstream.arrayBuffer();
    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("content-type") ?? "text/csv; charset=utf-8");
    const dispo = upstream.headers.get("content-disposition");
    if (dispo) headers.set("Content-Disposition", dispo);
    else headers.set("Content-Disposition", `attachment; filename="floodwatch-uat-surveys.csv"`);

    return new NextResponse(body, { status: 200, headers });
  } catch (err) {
    console.error("[/api/admin/surveys/uat/export GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to export" },
      { status: 500 },
    );
  }
}
