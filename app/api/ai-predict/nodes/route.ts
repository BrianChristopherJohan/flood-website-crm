// GET /api/ai-predict/nodes?dataset=&scenario=&timestamp=&village_id=&status=
//
// Batch flood-risk prediction for live IoT nodes under a weather scenario.
// Pipeline: pull the current node list from the FloodWatch IoT API
// (`floodwatchFetch`), then POST it to the `flood-ai-prediction` service's
// `/api/v1/predict/nodes` endpoint with the chosen scenario + simulation
// timestamp. The dashboard's AI mode renders the returned per-node
// predictions (predicted_level / probability / risk_label).
//
// Errors surface real status codes here (502/503) — unlike the GET
// /api/ai-predict overlay route — because the dashboard's AI-nodes panel
// has its own explicit "AI offline / retry" UX keyed on a failed fetch.

import { NextRequest, NextResponse } from "next/server";

import {
  FloodwatchFetchError,
  floodwatchFetch,
} from "@/lib/floodwatch/api";
import type { Dataset, IoTNode } from "@/lib/floodwatch/types";

export const dynamic = "force-dynamic";

const AI_API_URL = (process.env.AI_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const SCENARIOS = new Set(["normal", "la_nina", "el_nino"]);

function scenarioFrom(value: string | null): "normal" | "la_nina" | "el_nino" {
  return SCENARIOS.has(value ?? "") ? (value as "normal" | "la_nina" | "el_nino") : "normal";
}

function datasetFrom(value: string | null): Dataset {
  return value === "real" || value === "all" || value === "sample" ? value : "sample";
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const dataset = datasetFrom(sp.get("dataset"));
  const scenario = scenarioFrom(sp.get("scenario"));
  const timestamp = sp.get("timestamp") ?? new Date().toISOString();

  let nodes: IoTNode[];
  try {
    nodes = await floodwatchFetch<IoTNode[]>("/nodes", {
      params: {
        dataset,
        village_id: sp.get("village_id") ?? undefined,
        status: sp.get("status") ?? undefined,
      },
      signal: req.signal,
    });
  } catch (err) {
    if (err instanceof FloodwatchFetchError) {
      return NextResponse.json(
        { success: false, error: err.message, status: err.status },
        { status: err.status || 502 },
      );
    }
    return NextResponse.json(
      { success: false, error: "FloodWatch IoT API unreachable" },
      { status: 502 },
    );
  }

  const body = {
    scenario,
    timestamp,
    nodes: nodes.map((node) => ({
      node_id: node.node_id,
      village_id: node.village_id,
      water_level: node.water_level,
      lat: node.lat ?? node.install_lat ?? null,
      lng: node.lng ?? node.install_lng ?? null,
      status: node.status,
    })),
  };

  try {
    const upstream = await fetch(`${AI_API_URL}/api/v1/predict/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(28_000),
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return NextResponse.json(
        {
          success: false,
          error: "AI service unavailable",
          detail: text,
          dataset,
          scenario,
        },
        { status: 502 },
      );
    }

    const data = await upstream.json();
    return NextResponse.json({
      success: true,
      dataset,
      node_count: nodes.length,
      ...data,
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "AI service offline",
        dataset,
        scenario,
      },
      { status: 503 },
    );
  }
}
