// GET /api/ai-predict?scale=daily|weekly|monthly|hourly&year=YYYY&date=YYYY-MM-DD
//
// Proxy to the `flood-ai-prediction` FastAPI service. The dashboard
// renders the AI overlay when this returns `success: true` and quietly
// falls back to live-sensor-derived data otherwise (see
// `dashboard/page.tsx::aiOnline`).
//
// Response contract: we ALWAYS return HTTP 200 with a JSON body. The
// caller branches on `success` and `fallback`, never on HTTP status.
//
// Why 200-on-failure instead of 502/503:
//   - The dashboard already has graceful fallback UX. A 5xx from this
//     endpoint adds nothing the body's `success: false` flag doesn't
//     already convey.
//   - Browsers log every 5xx in the Console as a red error, even when
//     the JS code handles it. That noise was being mistaken for a real
//     outage and routed to the senior dev (today's session). Returning
//     200 silences the false alarm without changing the UI behaviour.
//   - The body still includes `fallback: true` plus a tagged `reason`
//     + actionable `hint` for anyone debugging via the Network tab.
//
// HTTP 5xx remains reserved for things that signal a code/config bug
// in THIS handler (unexpected throw etc.) — those are still worth a
// red console line because we can't ship past them silently.

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const AI_API_URL = process.env.AI_API_URL ?? "http://localhost:8000";

type Ok = { success: true; [k: string]: unknown };
type Fail = {
  success: false;
  fallback: true;
  reason: "no_url" | "upstream_unreachable" | "upstream_error";
  hint: string;
};

function failBody(reason: Fail["reason"], hint: string): Fail {
  return { success: false, fallback: true, reason, hint };
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const scale = searchParams.get("scale") ?? "daily";
  const year =
    searchParams.get("year") ?? new Date().getFullYear().toString();
  const date =
    searchParams.get("date") ?? new Date().toISOString().split("T")[0];

  // Bail before paying the 28-second timeout if AI_API_URL is missing
  // (or still the localhost default in prod). Dashboard falls back to
  // live-sensor-derived data instantly instead of waiting half a minute.
  if (
    !process.env.AI_API_URL &&
    AI_API_URL.startsWith("http://localhost")
  ) {
    return NextResponse.json(
      failBody(
        "no_url",
        "AI_API_URL not configured on this deployment. Set it to a " +
          "reachable flood-ai-prediction base URL or accept the " +
          "live-sensor fallback as canonical.",
      ),
    );
  }

  let endpoint: string;
  if (scale === "weekly") endpoint = `/api/v1/predict/weekly?year=${year}`;
  else if (scale === "monthly") endpoint = `/api/v1/predict/monthly?year=${year}`;
  else if (scale === "hourly") endpoint = `/api/v1/predict/hourly?date=${date}`;
  else endpoint = `/api/v1/predict/daily?year=${year}`;

  try {
    const upstream = await fetch(`${AI_API_URL}${endpoint}`, {
      signal: AbortSignal.timeout(28_000),
    });

    if (!upstream.ok) {
      return NextResponse.json(
        failBody(
          "upstream_error",
          `flood-ai-prediction returned HTTP ${upstream.status}. ` +
            "Dashboard will fall back to live-sensor data.",
        ),
      );
    }

    const data = (await upstream.json()) as Record<string, unknown>;
    const okBody: Ok = { success: true, ...data };
    return NextResponse.json(okBody);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Log server-side so Vercel function logs still flag a long-
    // running outage — but don't surface 5xx to the browser.
    console.warn("[ai-predict] upstream unreachable:", msg);
    return NextResponse.json(
      failBody(
        "upstream_unreachable",
        "AI_API_URL unreachable or timed out — verify the URL and " +
          "that flood-ai-prediction is running. Dashboard falls back " +
          "to live-sensor data automatically.",
      ),
    );
  }
}
