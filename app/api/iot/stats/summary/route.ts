// GET /api/iot/stats/summary?period=today|week|month&dataset=...
//
// Proxies the FloodWatch IoT API's pre-aggregated stats summary. Unlike
// /stats (a point-in-time snapshot), this returns real historical roll-ups
// over the chosen window: alerts_by_type, top_alerted_villages, and
// top_active_nodes. The analytics page renders these directly so its
// charts reflect genuine telemetry rather than any client-side fallback.

import { NextRequest, NextResponse } from "next/server";

import {
  FloodwatchFetchError,
  floodwatchFetch,
} from "@/lib/floodwatch/api";
import type { Dataset, IoTStatsSummary } from "@/lib/floodwatch/types";

const PERIODS = new Set(["today", "week", "month"]);

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const periodRaw = sp.get("period") ?? "month";
  const period = PERIODS.has(periodRaw) ? periodRaw : "month";
  const dataset = (sp.get("dataset") ?? undefined) as Dataset | undefined;

  try {
    const summary = await floodwatchFetch<IoTStatsSummary>("/stats/summary", {
      params: { period, dataset },
    });
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof FloodwatchFetchError) {
      return NextResponse.json(
        { error: err.message, status: err.status },
        { status: err.status || 502 },
      );
    }
    return NextResponse.json(
      { error: "FloodWatch IoT API unreachable" },
      { status: 502 },
    );
  }
}
