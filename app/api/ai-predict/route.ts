import { NextRequest, NextResponse } from "next/server";

const AI_API_URL = (process.env.AI_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const scale = searchParams.get("scale") ?? "daily";
  const year = searchParams.get("year") ?? new Date().getFullYear().toString();
  const date = searchParams.get("date") ?? new Date().toISOString().split("T")[0];

  try {
    let endpoint = "";
    if (scale === "daily") endpoint = `/api/v1/predict/daily?year=${year}`;
    else if (scale === "weekly") endpoint = `/api/v1/predict/weekly?year=${year}`;
    else if (scale === "monthly") endpoint = `/api/v1/predict/monthly?year=${year}`;
    else if (scale === "hourly") endpoint = `/api/v1/predict/hourly?date=${date}`;
    else endpoint = `/api/v1/predict/daily?year=${year}`;

    const upstream = await fetch(`${AI_API_URL}${endpoint}`, {
      signal: AbortSignal.timeout(28_000),
    });

    if (!upstream.ok) {
      return NextResponse.json(
        {
          success: false,
          error: "AI service unavailable",
          fallback: true,
          hint: "Set AI_API_URL on the server (e.g. Vercel env) to your flood-ai-prediction base URL.",
        },
        { status: 502 }
      );
    }

    const data = await upstream.json();
    return NextResponse.json({ success: true, ...data });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "AI service offline",
        fallback: true,
        hint: "AI_API_URL unreachable or timed out — verify the URL and that flood-ai-prediction is running.",
      },
      { status: 503 }
    );
  }
}
