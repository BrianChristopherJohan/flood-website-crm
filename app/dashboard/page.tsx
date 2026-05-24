"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import OverviewCard from "@/components/cards/OverviewCard";
import StatusPill from "@/components/common/StatusPill";
import NodeMap from "@/components/map/NodeMap";
import { useAuth } from "@/lib/AuthContext";
import { authFetchJson } from "@/lib/authFetch";
import { useTheme } from "@/lib/ThemeContext";
import { NodeData, getStatusLabel, type Zone } from "@/lib/types";
import { useIoTStream } from "@/components/providers/IoTEventProvider";
import {
  RISK_COLORS,
  RISK_LABELS,
  RISK_FT,
  eventCountToLevel,
  isEmptyChartData,
  generateDailyFallback,
  generateWeeklyFallback,
  generateMonthlyFallback,
  generateHourlyFallback,
} from "@/lib/floodRiskMock";
import FloodRiskChart, { type FloodRiskVariant } from "@/components/charts/FloodRiskChart";

// ── IoT zone → NodeData adapter (same pattern as map + sensors) ────────────
function zoneToNodeData(z: Zone): NodeData {
  return {
    _id: z.id,
    node_id: z.nodeId ?? z.id,
    name: z.name,
    area: z.area,
    location: z.area,
    state: z.state,
    latitude: z.centroidLat,
    longitude: z.centroidLng,
    current_level: z.worstLevel,
    is_dead: z.allOffline,
    last_updated: z.lastUpdated ?? new Date().toISOString(),
    created_at: z.lastUpdated ?? new Date().toISOString(),
  };
}

interface AnalyticsData {
  stats: { label: string; value: string; trend: string }[];
  chartData: number[];
  yearlyChartData: number[];
  waterLevelByNode: { nodeId: string; level: number; status: string }[];
  floodByState: { state: string; total: number }[];
  recentEvents: { title: string; timestamp: string; type: string }[];
}

const monthLabels = Array.from({ length: 5 }, (_, i) => {
  const d = new Date();
  d.setMonth(d.getMonth() - (4 - i));
  return d.toLocaleDateString("en-MY", { month: "short", year: "2-digit" });
});

const weekLabels = Array.from({ length: 7 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (6 - i));
  return d.toLocaleDateString("en-MY", { weekday: "short", day: "numeric" });
});

// ── Flood Risk Analysis helpers — shared with /analytics via lib/floodRiskMock
type RiskScale = "hourly" | "daily" | "weekly" | "monthly";
type WeatherScenario = "normal" | "la_nina" | "el_nino";

type AiHourlyPoint = {
  label: string;
  level: number;
  probability?: number;
};

type AiNodePrediction = {
  node_id: string;
  village_id?: string;
  water_level: number;
  predicted_level: number;
  probability: number;
  risk_label: string;
  features?: {
    rain_1day?: number;
    rain_7day?: number;
    ro?: number;
    swvl1?: number;
    storm_intensity?: number;
  };
};

type AiNodesResponse = {
  success?: boolean;
  status?: number;
  error?: string;
  detail?: string;
  predictions?: AiNodePrediction[];
};

const SIMULATION_PRESETS = [
  {
    key: "current",
    label: "Current",
    helper: "Now",
    timestamp: () => new Date().toISOString(),
  },
  {
    key: "jan_monsoon",
    label: "Jan",
    helper: "NE monsoon",
    timestamp: () => `${new Date().getFullYear()}-01-15T12:00:00.000Z`,
  },
  {
    key: "jun_dry",
    label: "Jun",
    helper: "Dry season",
    timestamp: () => `${new Date().getFullYear()}-06-15T12:00:00.000Z`,
  },
  {
    key: "dec_monsoon",
    label: "Dec",
    helper: "Monsoon peak",
    timestamp: () => `${new Date().getFullYear()}-12-15T12:00:00.000Z`,
  },
] as const;

function probabilityToChartLevel(probability: number): number {
  return Number(((Math.max(0, Math.min(100, probability)) / 100) * 3).toFixed(2));
}

function predictionSeries(
  predictions: AiNodePrediction[],
  labels: string[],
  wave = 0,
): { name: string; level: number; count: number }[] {
  if (predictions.length === 0) return [];

  const sorted = [...predictions].sort((a, b) => a.node_id.localeCompare(b.node_id));
  return labels.map((name, index) => {
    const start = Math.floor((index * sorted.length) / labels.length);
    const end = Math.floor(((index + 1) * sorted.length) / labels.length);
    const bucket = sorted.slice(start, Math.max(start + 1, end));
    const sample = bucket.length ? bucket : [sorted[index % sorted.length]];
    const avgProbability =
      sample.reduce((sum, node) => sum + node.probability, 0) / sample.length;
    const phase =
      labels.length > 1 ? Math.sin((index / (labels.length - 1)) * Math.PI * 2) : 0;
    const probability = Math.max(0, Math.min(100, avgProbability + phase * wave));

    return {
      name,
      level: probabilityToChartLevel(probability),
      count: Number((probability / 5).toFixed(2)),
    };
  });
}

const WEATHER_SCENARIOS: { key: WeatherScenario; label: string; helper: string }[] = [
  { key: "normal", label: "Normal", helper: "Baseline monsoon pattern" },
  { key: "la_nina", label: "La Nina", helper: "Wet-event stress test" },
  { key: "el_nino", label: "El Nino", helper: "Dry-event baseline" },
];

const EVALUATION_ROWS: {
  scenario: WeatherScenario;
  expected: string;
  signal: string;
}[] = [
  { scenario: "el_nino", expected: "Lowest", signal: "Dry, hotter, low runoff" },
  { scenario: "normal", expected: "Middle", signal: "Baseline monsoon" },
  { scenario: "la_nina", expected: "Highest", signal: "Wet, saturated, stormier" },
];

export default function DashboardPage() {
  const { isDark } = useTheme();
  const { accessToken, silentRefresh } = useAuth();
  // QA — Subscribe to the shared IoT event stream so the dashboard
  // refreshes on flood_level / node_online / node_offline events
  // (mounted by app/layout.tsx via <IoTEventProvider>). Was a direct
  // EventSource on the legacy Java /api/sse/sensors stream.
  const { subscribe: subscribeIoT } = useIoTStream();
  const [nodes, setNodes] = useState<NodeData[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const isFirstFetch = useRef(true);

  // Read global settings from CRM Settings
  const [liveDataEnabled, setLiveDataEnabled] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(1000);

  useEffect(() => {
    const loadSettings = () => {
      const saved = localStorage.getItem("crmSettings");
      if (saved) {
        const settings = JSON.parse(saved);
        setLiveDataEnabled(settings.liveDataEnabled ?? true);
        setRefreshInterval(settings.refreshInterval ?? 1000);
      }
    };
    loadSettings();
    // Listen for storage changes from other tabs/pages
    window.addEventListener("storage", loadSettings);
    return () => window.removeEventListener("storage", loadSettings);
  }, []);

  // Initial parallel fetch: nodes + analytics (wall time ≈ max of the two, not their sum).
  useEffect(() => {
    if (!accessToken) {
      queueMicrotask(() => setIsLoading(false));
      return;
    }
    if (isFirstFetch.current) queueMicrotask(() => setIsLoading(true));
    let cancelled = false;

    // QA — migrated from Java `/api/nodes` to the FloodWatch IoT
    // BFF `/api/iot/zones`. Same NodeData[] shape coming out;
    // adapted at the boundary by `zoneToNodeData`. The IoT BFF is
    // public so no auth wrapper / token refresh dance is needed.
    const nodesP = fetch("/api/iot/zones", { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) throw new Error("Failed to fetch sensor zones");
        const zones = (await res.json()) as Zone[];
        if (!Array.isArray(zones)) throw new Error("Unexpected zones payload");
        setNodes(zones.map(zoneToNodeData));
        setLastFetch(new Date());
        isFirstFetch.current = false;
      })
      .catch((error) => {
        console.error("Error fetching IoT zones:", error);
        if (!cancelled && isFirstFetch.current) {
          toast.error("Failed to load sensor data. Please refresh.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    const analyticsP = authFetchJson<AnalyticsData>("/api/analytics", accessToken, silentRefresh)
      .then((d) => {
        if (!cancelled) setAnalytics(d);
      })
      .catch((err) => {
        console.error("Analytics fetch failed:", err);
        if (!cancelled) toast.error("Failed to load analytics data.");
      });

    void Promise.all([nodesP, analyticsP]);

    return () => {
      cancelled = true;
    };
  }, [accessToken, silentRefresh]);

  // Live updates via the IoTEventProvider mounted in app/layout.tsx.
  //
  // Was: a direct `EventSource("/api/sse/sensors")` that proxied the
  // legacy Java sensor stream. Migrated to subscribe to the shared
  // IoT stream so the dashboard moves in lockstep with the map +
  // alerts pages and the contract is the same across the app.
  // Debounce-refetch the IoT zones snapshot when a relevant event
  // fires; ignore heartbeats (no semantic change for KPI tiles).
  const dashRefetchRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    dashRefetchRef.current = async () => {
      try {
        const r = await fetch("/api/iot/zones", { cache: "no-store" });
        if (!r.ok) return;
        const zones = (await r.json()) as Zone[];
        if (Array.isArray(zones)) {
          setNodes(zones.map(zoneToNodeData));
          setLastFetch(new Date());
        }
      } catch {
        // network blip — keep the previous snapshot until next event
      }
    };
  });

  useEffect(() => {
    if (!liveDataEnabled) return;
    let scheduled: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefetch = () => {
      if (scheduled) return;
      scheduled = setTimeout(() => {
        scheduled = null;
        void dashRefetchRef.current();
      }, 1000);
    };
    const unsub = subscribeIoT((event) => {
      if (
        event.type === "flood_level" ||
        event.type === "node_online" ||
        event.type === "node_offline"
      ) {
        scheduleRefetch();
      }
    });
    return () => {
      unsub?.();
      if (scheduled) clearTimeout(scheduled);
    };
  }, [liveDataEnabled, subscribeIoT]);

  // Statistics from real-time data
  const stats = useMemo(() => {
    const totalNodes = nodes.length;
    const activeNodes = nodes.filter((n) => !n.is_dead).length;
    const inactiveNodes = nodes.filter((n) => n.is_dead).length;
    const criticalNodes = nodes.filter((n) => n.current_level === 3).length;
    const warningNodes = nodes.filter((n) => n.current_level === 2).length;
    const alertNodes = nodes.filter((n) => n.current_level === 1).length;
    const normalNodes = nodes.filter((n) => n.current_level === 0).length;
    const avgWaterLevel = totalNodes > 0 
      ? nodes.reduce((acc, n) => acc + n.current_level, 0) / totalNodes 
      : 0;
    const riskiestNode = nodes.reduce((prev, current) => 
      (current.current_level > (prev?.current_level ?? -1)) ? current : prev
    , nodes[0]);

    return {
      totalNodes,
      activeNodes,
      inactiveNodes,
      criticalNodes,
      warningNodes,
      alertNodes,
      normalNodes,
      avgWaterLevel,
      riskiestNode,
    };
  }, [nodes]);

  // Bar chart data from real-time nodes
  const barChartData = useMemo(() => {
    return nodes.slice(0, 10).map((n) => ({
      name: n.node_id.slice(-4),
      level: n.current_level,
    }));
  }, [nodes]);

  // Chart colors based on theme
  const chartTextColor = isDark ? "#a0a0a0" : "#4E4B4B";
  const chartGridColor = isDark ? "#2d3a5a" : "#E5E5E5";
  const tooltipBg = isDark ? "#16213e" : "#ffffff";
  const tooltipBorder = isDark ? "#2d3a5a" : "#BFBFBF";

  // Derived chart data from analytics API
  const lineChartData = (analytics?.yearlyChartData ?? Array(5).fill(0)).map((v, i) => ({
    name: monthLabels[i],
    waterLevel: v,
  }));
  const stateBarData = (analytics?.floodByState ?? []).map((s) => ({
    name: s.state,
    total: s.total,
    critical: 0,
  }));
  // ── Flood Risk Analysis state ────────────────────────────────────────────
  const [riskScale, setRiskScale] = useState<RiskScale>("daily");
  const [riskVariant, setRiskVariant] = useState<FloodRiskVariant>("bar");
  const [minLevel, setMinLevel] = useState(0);
  const [aiSource, setAiSource] = useState(false);
  const [weatherScenario, setWeatherScenario] = useState<WeatherScenario>("normal");
  const [simulationPreset, setSimulationPreset] = useState<(typeof SIMULATION_PRESETS)[number]["key"]>("current");
  const [simulationTimestamp, setSimulationTimestamp] = useState(() => SIMULATION_PRESETS[0].timestamp());
  const [aiRetryNonce, setAiRetryNonce] = useState(0);
  const [aiData, setAiData] = useState<{ hourly?: AiHourlyPoint[]; monthly?: {month:string;level:number}[]; weekly?: Record<string,number[]>; daily?: Record<string,number[]> } | null>(null);
  const [aiOnline, setAiOnline] = useState<boolean | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNodePredictions, setAiNodePredictions] = useState<AiNodePrediction[]>([]);
  const [aiNodesLoading, setAiNodesLoading] = useState(true);

  useEffect(() => {
    const year = new Date().getFullYear();
    const scale = riskScale;
    const today = new Date().toISOString().split("T")[0];
    const ac = new AbortController();
    fetch(`/api/ai-predict?scale=${scale}&year=${year}&date=${today}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((d: { success?: boolean; data?: unknown; daily_data?: unknown }) => {
        if (d.success) {
          if (scale === "hourly") setAiData((prev) => ({ ...prev, hourly: d.data as AiHourlyPoint[] }));
          else if (scale === "monthly") setAiData((prev) => ({ ...prev, monthly: d.data as { month: string; level: number }[] }));
          else if (scale === "weekly") setAiData((prev) => ({ ...prev, weekly: d.data as Record<string, number[]> }));
          else if (scale === "daily") setAiData((prev) => ({ ...prev, daily: d.daily_data as Record<string, number[]> }));
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
    });
    return () => ac.abort();
  }, [riskScale]);

  useEffect(() => {
    const ac = new AbortController();
    const params = new URLSearchParams({
      dataset: "sample",
      scenario: weatherScenario,
      timestamp: simulationTimestamp,
    });
    fetch(`/api/ai-predict/nodes?${params.toString()}`, { signal: ac.signal })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as AiNodesResponse;
        if (!r.ok) {
          return {
            ...body,
            success: false,
            status: r.status,
            error: body.error ?? `AI prediction request failed with HTTP ${r.status}`,
          };
        }
        return body;
      })
      .then((d: AiNodesResponse) => {
        if (d.success && Array.isArray(d.predictions)) {
          setAiNodePredictions(d.predictions);
          setAiOnline(true);
          setAiError(null);
        } else {
          setAiNodePredictions([]);
          setAiOnline(false);
          setAiError(d.error ?? "AI prediction service returned no node predictions.");
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setAiNodePredictions([]);
        setAiOnline(false);
        setAiError(err instanceof Error ? err.message : "AI prediction service is unreachable.");
      })
      .finally(() => {
        if (!ac.signal.aborted) setAiNodesLoading(false);
      });
    return () => ac.abort();
  }, [weatherScenario, simulationTimestamp, aiRetryNonce]);

  const hourlyRiskData = useMemo(() => {
    // If we have live nodes, derive max-per-hour from their last_updated stamps;
    // otherwise show a Sarawak-monsoon-aware seasonal hourly curve so the chart
    // is informative when the DB is empty.
    if (nodes.length === 0) return generateHourlyFallback();
    const now = new Date();
    const curH = now.getHours();
    return Array.from({ length: 24 }, (_, i) => {
      const h = (curH - 23 + i + 24) % 24;
      const label = `${h.toString().padStart(2, "0")}:00`;
      const inHour = nodes.filter(n => new Date(n.last_updated).getHours() === h);
      const lvl = inHour.length > 0 ? Math.max(...inHour.map(n => n.current_level)) : 0;
      return { name: label, level: lvl, count: inHour.length };
    });
  }, [nodes]);

  const dailyRiskData = useMemo(() => {
    if (isEmptyChartData(analytics?.chartData)) return generateDailyFallback();
    return (analytics?.chartData ?? Array(7).fill(0)).map((count, i) => ({
      name: weekLabels[i] ?? `Day ${i + 1}`,
      level: eventCountToLevel(count),
      count,
    }));
  }, [analytics]);

  const weeklyRiskData = useMemo(() => {
    if (isEmptyChartData(analytics?.yearlyChartData)) return generateWeeklyFallback();
    const y = analytics?.yearlyChartData ?? Array(5).fill(0);
    return [
      { name: "Q1 Jan–Mar", level: eventCountToLevel(y[0] ?? 0), count: y[0] ?? 0 },
      { name: "Q2 Apr–Jun", level: eventCountToLevel(y[1] ?? 0), count: y[1] ?? 0 },
      { name: "Q3 Jul–Sep", level: eventCountToLevel(y[2] ?? 0), count: y[2] ?? 0 },
      { name: "Q4 Oct–Dec", level: eventCountToLevel(y[3] ?? 0), count: y[3] ?? 0 },
    ];
  }, [analytics]);

  const monthlyRiskData = useMemo(() => {
    if (isEmptyChartData(analytics?.yearlyChartData)) return generateMonthlyFallback();
    return (analytics?.yearlyChartData ?? Array(5).fill(0)).map((count, i) => ({
      name: monthLabels[i] ?? `M${i + 1}`,
      level: eventCountToLevel(count),
      count,
    }));
  }, [analytics]);

  const aiDailyRiskData = useMemo(() => {
    const dd = aiData?.daily ?? {};
    const months = Object.keys(dd);
    const recent = months.slice(-1)[0];
    if (!recent) return dailyRiskData;
    return (dd[recent] as number[]).map((lvl, i) => ({ name: `${recent.slice(0,3)} ${i+1}`, level: lvl }));
  }, [aiData, dailyRiskData]);

  const aiWeeklyRiskData = useMemo(() => {
    const wd = aiData?.weekly ?? {};
    return Object.entries(wd).map(([q, levels]) => {
      const avg = (levels as number[]).reduce((a, b) => a + b, 0) / Math.max(1, (levels as number[]).length);
      return { name: q.split(" ")[0], level: Math.round(avg) };
    });
  }, [aiData]);

  const aiMonthlyRiskData = useMemo(() =>
    (aiData?.monthly ?? []).map((d: {month:string;level:number}) => ({ name: d.month.slice(0,3), level: d.level }))
  , [aiData]);

  const aiHourlyRiskData = useMemo(() =>
    (aiData?.hourly ?? []).map((d) => ({ name: d.label, level: d.level, count: d.probability ?? 0 }))
  , [aiData]);

  const scenarioHourlyRiskData = useMemo(() => {
    const labels = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, "0")}:00`);
    return predictionSeries(aiNodePredictions, labels, 5);
  }, [aiNodePredictions]);

  const scenarioDailyRiskData = useMemo(
    () => predictionSeries(aiNodePredictions, weekLabels, 4),
    [aiNodePredictions],
  );

  const scenarioWeeklyRiskData = useMemo(
    () => predictionSeries(aiNodePredictions, ["Q1", "Q2", "Q3", "Q4"]),
    [aiNodePredictions],
  );

  const scenarioMonthlyRiskData = useMemo(
    () => predictionSeries(aiNodePredictions, monthLabels),
    [aiNodePredictions],
  );

  const aiPredictionSummary = useMemo(() => {
    const total = aiNodePredictions.length;
    const avgProbability = total
      ? aiNodePredictions.reduce((sum, node) => sum + node.probability, 0) / total
      : 0;
    const critical = aiNodePredictions.filter((node) => node.predicted_level === 3).length;
    const warning = aiNodePredictions.filter((node) => node.predicted_level === 2).length;
    const topNodes = [...aiNodePredictions]
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 3);
    return { total, avgProbability, critical, warning, topNodes };
  }, [aiNodePredictions]);

  const scenarioExplanation = useMemo(() => {
    const total = aiNodePredictions.length || 1;
    const avg = (selector: (node: AiNodePrediction) => number | undefined) =>
      aiNodePredictions.reduce((sum, node) => sum + (selector(node) ?? 0), 0) / total;

    const rain1 = avg((node) => node.features?.rain_1day);
    const rain7 = avg((node) => node.features?.rain_7day);
    const runoff = avg((node) => node.features?.ro);
    const soil = avg((node) => node.features?.swvl1);
    const storm = avg((node) => node.features?.storm_intensity);
    const water = avg((node) => node.water_level);

    const headline =
      weatherScenario === "la_nina"
        ? "Wet-event scenario is increasing rainfall, runoff, and soil saturation."
        : weatherScenario === "el_nino"
          ? "Dry-event scenario is lowering rainfall and runoff, but live water levels still affect risk."
          : "Normal scenario uses baseline monsoon rainfall against the current IoT node levels.";

    return {
      headline,
      metrics: [
        { label: "24h rain", value: `${rain1.toFixed(1)} mm` },
        { label: "7d rain", value: `${rain7.toFixed(1)} mm` },
        { label: "Runoff", value: `${runoff.toFixed(1)} mm` },
        { label: "Soil moisture", value: soil.toFixed(2) },
        { label: "Storm", value: `${Math.round(storm * 100)}%` },
        { label: "Water level", value: `${water.toFixed(1)} ft` },
      ],
    };
  }, [aiNodePredictions, weatherScenario]);

  const liveRiskMap = { hourly: hourlyRiskData, daily: dailyRiskData, weekly: weeklyRiskData, monthly: monthlyRiskData };
  const aiRiskMap = aiNodePredictions.length
    ? {
        hourly: scenarioHourlyRiskData,
        daily: scenarioDailyRiskData,
        weekly: scenarioWeeklyRiskData,
        monthly: scenarioMonthlyRiskData,
      }
    : {
        hourly: aiHourlyRiskData.length ? aiHourlyRiskData : hourlyRiskData,
        daily: aiDailyRiskData,
        weekly: aiWeeklyRiskData,
        monthly: aiMonthlyRiskData,
      };
  const rawRiskData = (aiSource && aiOnline ? aiRiskMap : liveRiskMap)[riskScale];
  const aiModeActive = aiSource;
  const aiReady = aiOnline === true;
  const aiUnavailable = aiSource && aiOnline === false;
  const simulationDateLabel = new Date(simulationTimestamp).toLocaleString("en-MY", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const filteredRiskData = rawRiskData.map(d => ({
    ...d,
    level: d.level >= minLevel ? d.level : null,
  }));

  // Get status variant for StatusPill
  const getStatusVariant = (level: number): "green" | "yellow" | "orange" | "red" => {
    switch (level) {
      case 0: return "green";
      case 1: return "yellow";
      case 2: return "orange";
      case 3: return "red";
      default: return "green";
    }
  };

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1
            className={`text-3xl font-semibold transition-colors ${
              isDark ? "text-dark-text" : "text-dark-charcoal"
            }`}
          >
            Dashboard
          </h1>
          <p
            className={`text-sm transition-colors ${
              isDark ? "text-dark-text-secondary" : "text-dark-charcoal/70"
            }`}
          >
            Live situational awareness — Real-time flood monitoring.
          </p>
        </div>
        {lastFetch && (
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${liveDataEnabled ? "bg-status-green animate-pulse" : "bg-dark-charcoal/40"}`} />
            <span className={`text-xs ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}`}>
              {liveDataEnabled ? "Live" : "Paused"} | Updated: {lastFetch.toLocaleTimeString()}
            </span>
          </div>
        )}
      </header>

      {/* ─── KPI Cards ──────────────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OverviewCard
          title="Total Nodes"
          value={isLoading ? "..." : String(stats.totalNodes)}
          helper={`${stats.activeNodes} online / ${stats.inactiveNodes} offline`}
          trend={{ label: "Live Data", direction: "up" }}
        />
        <OverviewCard
          title="Water Level Status"
          value={isLoading ? "..." : `${stats.criticalNodes + stats.warningNodes}`}
          helper={`${stats.criticalNodes} critical / ${stats.warningNodes} warning`}
          trend={{ label: "Real-time", direction: stats.criticalNodes > 0 ? "down" : "flat" }}
        />
        <OverviewCard
          title="Riskiest Node"
          value={isLoading || !stats.riskiestNode ? "..." : stats.riskiestNode.node_id.slice(-6)}
          subLabel={stats.riskiestNode ? `${stats.riskiestNode.current_level}ft water level` : ""}
          trend={{
            label: stats.riskiestNode ? getStatusLabel(stats.riskiestNode.current_level) : "",
            direction: "down",
          }}
        />
        <OverviewCard
          title="Average Water Level"
          value={isLoading ? "..." : `${stats.avgWaterLevel.toFixed(1)}ft`}
          helper={`${stats.normalNodes} normal / ${stats.alertNodes} alert`}
          trend={{ label: "Live data", direction: "flat" }}
        />
      </div>

      {/* ─── Table + Map Row ────────────────────────────────────────────────── */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <article
          className={`rounded-3xl border p-5 shadow-sm transition-colors ${
            isDark
              ? "border-dark-border bg-dark-card"
              : "border-light-grey bg-pure-white"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <h2
                className={`text-lg font-semibold transition-colors ${
                  isDark ? "text-dark-text" : "text-dark-charcoal"
                }`}
              >
                Sensor Nodes
              </h2>
              <p
                className={`text-xs uppercase tracking-wide transition-colors ${
                  isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"
                }`}
              >
                Live device telemetry
              </p>
            </div>
            <span className="rounded-full bg-light-blue px-4 py-1 text-xs font-semibold text-primary-blue dark:bg-primary-blue/20">
              {nodes.length} nodes
            </span>
          </div>
          <div className="mt-4 overflow-x-auto max-h-[320px]">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className={`h-8 w-8 animate-spin rounded-full border-4 ${isDark ? "border-dark-border border-t-primary-blue" : "border-light-grey border-t-primary-blue"}`} />
              </div>
            ) : (
              <table
                className={`min-w-full text-left text-sm transition-colors ${
                  isDark ? "text-dark-text-secondary" : "text-dark-charcoal"
                }`}
              >
                <thead
                  className={`text-xs uppercase transition-colors sticky top-0 ${
                    isDark
                      ? "bg-dark-bg text-dark-text-muted"
                      : "bg-light-blue text-dark-charcoal"
                  }`}
                >
                  <tr>
                    <th className="px-4 py-3 font-semibold">Node ID</th>
                    <th className="px-4 py-3 font-semibold">Water Level</th>
                    <th className="px-4 py-3 font-semibold">Coordinates</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Node Status</th>
                    <th className="px-4 py-3 font-semibold">Last Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.length === 0 && (
                    <tr>
                      <td colSpan={6} className={`py-10 text-center text-sm ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}`}>
                        No sensor nodes configured yet
                      </td>
                    </tr>
                  )}
                  {nodes.map((node) => (
                    <tr
                      key={node._id}
                      className={`border-b last:border-b-0 transition-colors ${
                        isDark
                          ? "border-dark-border hover:bg-dark-bg"
                          : "border-light-blue/60 hover:bg-light-blue/20"
                      }`}
                    >
                      <td
                        className={`px-4 py-3 font-semibold transition-colors ${
                          isDark ? "text-dark-text" : "text-dark-charcoal"
                        }`}
                      >
                        {node.node_id}
                      </td>
                      <td className="px-4 py-3 text-primary-blue font-bold">
                        {node.current_level} ft
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {node.latitude.toFixed(4)}°N, {node.longitude.toFixed(4)}°E
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill 
                          status={getStatusLabel(node.current_level)} 
                          variant={getStatusVariant(node.current_level)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${
                          node.is_dead
                            ? "bg-status-danger/20 text-status-danger"
                            : "bg-status-green/20 text-status-green"
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${node.is_dead ? "bg-status-danger" : "bg-status-green"}`} />
                          {node.is_dead ? "Offline" : "Online"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {new Date(node.last_updated).toLocaleString("en-MY", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </article>

        <article
          className={`rounded-3xl border p-5 shadow-sm transition-colors ${
            isDark
              ? "border-dark-border bg-dark-card"
              : "border-light-grey bg-pure-white"
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              {/* Title and subtitle mirror the dedicated /map page so users
                  recognise the same widget on both surfaces. */}
              <h2
                className={`text-lg font-semibold transition-colors ${
                  isDark ? "text-dark-text" : "text-dark-charcoal"
                }`}
              >
                Flood Map
              </h2>
              <p
                className={`text-xs transition-colors ${
                  isDark ? "text-dark-text-secondary" : "text-dark-charcoal/70"
                }`}
              >
                Real-time IoT sensor locations
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-primary-blue">
                Online: {stats.activeNodes}
              </span>
              <Link
                href="/map"
                className="text-xs font-semibold text-primary-blue hover:underline"
              >
                Open full map →
              </Link>
            </div>
          </div>
          <div
            className={`mt-4 rounded-2xl border transition-colors ${
              isDark ? "border-dark-border" : "border-light-grey"
            }`}
          >
            <NodeMap nodes={nodes} height={280} zoom={12} />
          </div>
          <ul
            className={`mt-4 grid grid-cols-2 gap-3 text-xs font-semibold transition-colors ${
              isDark ? "text-dark-text-secondary" : "text-dark-charcoal/70"
            }`}
          >
            <li
              className={`rounded-2xl border px-3 py-2 transition-colors ${
                isDark
                  ? "border-dark-border bg-dark-bg"
                  : "border-light-grey bg-very-light-grey"
              }`}
            >
              Critical (3ft):{" "}
              <span className="text-primary-red">{stats.criticalNodes}</span>
            </li>
            <li
              className={`rounded-2xl border px-3 py-2 transition-colors ${
                isDark
                  ? "border-dark-border bg-dark-bg"
                  : "border-light-grey bg-very-light-grey"
              }`}
            >
              Warning (2ft):{" "}
              <span className="text-status-warning-2">{stats.warningNodes}</span>
            </li>
            <li
              className={`rounded-2xl border px-3 py-2 transition-colors ${
                isDark
                  ? "border-dark-border bg-dark-bg"
                  : "border-light-grey bg-very-light-grey"
              }`}
            >
              Alert (1ft):{" "}
              <span className="text-status-warning-1">{stats.alertNodes}</span>
            </li>
            <li
              className={`rounded-2xl border px-3 py-2 transition-colors ${
                isDark
                  ? "border-dark-border bg-dark-bg"
                  : "border-light-grey bg-very-light-grey"
              }`}
            >
              Normal (0ft):{" "}
              <span className="text-status-green">{stats.normalNodes}</span>
            </li>
          </ul>
        </article>
      </div>

      {/* ─── Flood Risk Analysis ────────────────────────────────────────────── */}
      <div className="grid gap-6">
        <article
          className={`rounded-3xl border p-5 shadow-sm transition-colors ${
            isDark ? "border-dark-border bg-dark-card" : "border-light-grey bg-pure-white"
          }`}
        >
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className={`text-lg font-semibold transition-colors ${isDark ? "text-dark-text" : "text-dark-charcoal"}`}>
                Flood Risk Analysis
              </h2>
              <p className={`text-xs uppercase tracking-wide transition-colors ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}`}>
                {aiModeActive ? "IoT nodes enriched with scenario weather features" : "Risk level over time from live sensor telemetry"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* AI / Live source toggle */}
              <div className={`flex rounded-2xl border p-1 text-xs font-semibold ${isDark ? "border-dark-border bg-dark-bg" : "border-light-grey bg-very-light-grey"}`}>
                <button
                  type="button"
                  onClick={() => setAiSource(false)}
                  aria-pressed={!aiModeActive}
                  className={`rounded-xl px-3 py-1.5 transition-colors ${
                    !aiModeActive
                      ? "bg-status-green text-pure-white"
                      : isDark
                        ? "text-dark-text-muted hover:text-dark-text"
                        : "text-dark-charcoal/60 hover:text-dark-charcoal"
                  }`}
                >
                  Live
                </button>
                <button
                  type="button"
                  onClick={() => setAiSource(true)}
                  aria-pressed={aiModeActive}
                  className={`rounded-xl px-3 py-1.5 transition-colors ${
                    aiModeActive
                      ? "bg-primary-blue text-pure-white"
                      : isDark
                        ? "text-dark-text-muted hover:text-dark-text"
                        : "text-dark-charcoal/60 hover:text-dark-charcoal"
                  }`}
                >
                  AI
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${
                  aiModeActive
                    ? aiReady
                      ? "bg-blue-400 animate-pulse"
                      : "bg-status-warning-1"
                    : "bg-status-green animate-pulse"
                }`} />
                <span className={`text-xs font-semibold ${
                  aiModeActive ? (aiReady ? "text-blue-400" : "text-status-warning-1") : "text-status-green"
                }`}>
                  {aiModeActive ? (aiReady ? "AI" : "AI offline") : "Live"}
                </span>
              </div>
            </div>
          </div>

          <div className={`mt-4 grid gap-3 border-y py-3 text-sm sm:grid-cols-4 ${isDark ? "border-dark-border" : "border-light-grey"}`}>
            <div>
              <span className={`block text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/55"}`}>
                Source
              </span>
              <strong className={isDark ? "text-dark-text" : "text-dark-charcoal"}>
                {aiModeActive ? "AI batch prediction" : "Live telemetry"}
              </strong>
            </div>
            <div>
              <span className={`block text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/55"}`}>
                Scenario
              </span>
              <strong className={isDark ? "text-dark-text" : "text-dark-charcoal"}>
                {WEATHER_SCENARIOS.find((s) => s.key === weatherScenario)?.label ?? "Normal"}
              </strong>
              {aiModeActive && (
                <span className={`mt-0.5 block text-[11px] ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/55"}`}>
                  {simulationDateLabel}
                </span>
              )}
            </div>
            <div>
              <span className={`block text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/55"}`}>
                Avg AI probability
              </span>
              <strong className={aiModeActive && aiReady ? "text-primary-blue" : isDark ? "text-dark-text" : "text-dark-charcoal"}>
                {aiModeActive ? (aiReady ? `${Math.round(aiPredictionSummary.avgProbability)}%` : "Unavailable") : "Standby"}
              </strong>
            </div>
            <div>
              <span className={`block text-[11px] font-semibold uppercase tracking-wide ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/55"}`}>
                Predicted hotspots
              </span>
              <strong className={aiPredictionSummary.critical > 0 ? "text-status-danger" : aiPredictionSummary.warning > 0 ? "text-status-warning-2" : "text-status-green"}>
                {aiModeActive && aiReady ? `${aiPredictionSummary.critical} critical, ${aiPredictionSummary.warning} warning` : `${stats.warningNodes + stats.criticalNodes} active`}
              </strong>
            </div>
          </div>

          {aiModeActive && (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className={`text-xs font-semibold uppercase tracking-wide ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}`}>
                  Weather scenario
                </span>
                <div className={`flex flex-1 flex-wrap justify-end gap-1 rounded-2xl p-1 ${isDark ? "bg-dark-bg" : "bg-very-light-grey"}`}>
                  {WEATHER_SCENARIOS.map((scenario) => {
                    const active = weatherScenario === scenario.key;
                    return (
                      <button
                        key={scenario.key}
                        type="button"
                        onClick={() => {
                          setAiNodesLoading(true);
                          setWeatherScenario(scenario.key);
                        }}
                        className={`min-w-[9rem] rounded-xl px-3 py-2 text-left transition-colors ${
                          active
                            ? "bg-primary-blue text-pure-white"
                            : isDark
                              ? "text-dark-text-muted hover:bg-dark-border/60 hover:text-dark-text"
                              : "text-dark-charcoal/65 hover:bg-pure-white hover:text-dark-charcoal"
                        }`}
                      >
                        <span className="block text-xs font-semibold">{scenario.label}</span>
                        <span className={`block text-[10px] ${active ? "text-pure-white/75" : ""}`}>{scenario.helper}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className={`text-xs font-semibold uppercase tracking-wide ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}`}>
                  Simulation month
                </span>
                <div className={`flex flex-1 flex-wrap justify-end gap-1 rounded-2xl p-1 ${isDark ? "bg-dark-bg" : "bg-very-light-grey"}`}>
                  {SIMULATION_PRESETS.map((preset) => {
                    const active = simulationPreset === preset.key;
                    return (
                      <button
                        key={preset.key}
                        type="button"
                        onClick={() => {
                          setAiNodesLoading(true);
                          setSimulationPreset(preset.key);
                          setSimulationTimestamp(preset.timestamp());
                        }}
                        className={`min-w-[7rem] rounded-xl px-3 py-2 text-left transition-colors ${
                          active
                            ? "bg-primary-blue text-pure-white"
                            : isDark
                              ? "text-dark-text-muted hover:bg-dark-border/60 hover:text-dark-text"
                              : "text-dark-charcoal/65 hover:bg-pure-white hover:text-dark-charcoal"
                        }`}
                      >
                        <span className="block text-xs font-semibold">{preset.label}</span>
                        <span className={`block text-[10px] ${active ? "text-pure-white/75" : ""}`}>{preset.helper}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {aiUnavailable && (
            <div className={`mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-xs ${
              isDark
                ? "border-status-warning-1/40 bg-status-warning-1/10 text-dark-text-secondary"
                : "border-status-warning-1/35 bg-status-warning-1/10 text-dark-charcoal/70"
            }`}>
              <span>
                AI mode is selected, but predictions are unavailable. Live telemetry remains active.
                <span className="mt-1 block font-semibold">
                  {aiError ?? "Start flood-ai-prediction on port 8000, then retry."}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setAiNodesLoading(true);
                  setAiRetryNonce((n) => n + 1);
                }}
                className="rounded-xl bg-status-warning-1 px-3 py-1.5 text-xs font-semibold text-pure-white transition hover:brightness-95"
              >
                Retry AI
              </button>
            </div>
          )}

          {aiModeActive && (
            <div className={`mt-3 rounded-2xl border p-3 ${isDark ? "border-dark-border bg-dark-bg/60" : "border-light-grey bg-very-light-grey/70"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`text-xs font-semibold uppercase tracking-wide ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}`}>
                  Scenario evaluation
                </span>
                <span className={`text-[11px] ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/55"}`}>
                  Expected ordering: La Nina &gt; Normal &gt; El Nino
                </span>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                {EVALUATION_ROWS.map((row) => {
                  const active = weatherScenario === row.scenario;
                  const label = WEATHER_SCENARIOS.find((s) => s.key === row.scenario)?.label ?? row.scenario;
                  return (
                    <div
                      key={row.scenario}
                      className={`rounded-xl border px-3 py-2 text-xs ${
                        active
                          ? "border-primary-blue bg-primary-blue/10"
                          : isDark
                            ? "border-dark-border bg-dark-card"
                            : "border-light-grey bg-pure-white"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`font-semibold ${isDark ? "text-dark-text" : "text-dark-charcoal"}`}>
                          {label}
                        </span>
                        <span className={active && aiReady ? "font-semibold text-primary-blue" : isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}>
                          {active && aiReady ? `${Math.round(aiPredictionSummary.avgProbability)}%` : row.expected}
                        </span>
                      </div>
                      <p className={`mt-1 ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/55"}`}>
                        {row.signal}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Controls: scale buttons + level filter */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            {/* Scale selector */}
            <div className={`flex overflow-hidden rounded-xl border text-xs font-semibold ${isDark ? "border-dark-border" : "border-light-grey"}`}>
              {(["Hourly", "Daily", "Weekly", "Monthly"] as const).map((s) => {
                const key = s.toLowerCase() as RiskScale;
                const active = riskScale === key;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setRiskScale(key)}
                    className={`px-3 py-1.5 transition-colors ${
                      active
                        ? "bg-primary-blue text-pure-white"
                        : isDark
                          ? "bg-dark-bg text-dark-text hover:bg-dark-border/60"
                          : "bg-pure-white text-dark-charcoal hover:bg-very-light-grey"
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>

            {/* Chart variant + min-level filter */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className={`flex overflow-hidden rounded-xl border text-xs font-semibold ${isDark ? "border-dark-border" : "border-light-grey"}`}>
                {(["bar", "line"] as const).map((v) => {
                  const active = riskVariant === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setRiskVariant(v)}
                      aria-pressed={active}
                      className={`px-3 py-1.5 capitalize transition-colors ${
                        active
                          ? "bg-primary-blue text-pure-white"
                          : isDark
                            ? "bg-dark-bg text-dark-text hover:bg-dark-border/60"
                            : "bg-pure-white text-dark-charcoal hover:bg-very-light-grey"
                      }`}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}`}>
                  Min. Level
                </span>
                <select
                  value={minLevel}
                  onChange={(e) => setMinLevel(Number(e.target.value))}
                  className={`rounded-xl border px-2.5 py-1.5 text-xs font-semibold outline-none transition focus:border-primary-blue ${
                    isDark
                      ? "border-dark-border bg-dark-bg text-dark-text"
                      : "border-light-grey bg-pure-white text-dark-charcoal"
                  }`}
                >
                  <option value={0}>All levels</option>
                  <option value={1}>Alert+ (≥ 1)</option>
                  <option value={2}>Warning+ (≥ 2)</option>
                  <option value={3}>Critical (= 3)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Chart — shared FloodRiskChart used by both /dashboard and
              /analytics so the visualisation stays byte-identical. */}
          <div className="mt-5 h-64 w-full min-w-0">
            <FloodRiskChart
              data={filteredRiskData}
              scale={riskScale}
              isDark={isDark}
              variant={riskVariant}
              height={256}
              showThresholds
            />
          </div>

          {aiModeActive && aiReady && (
            <div className={`mt-3 border-t pt-3 ${isDark ? "border-dark-border" : "border-light-grey"}`}>
              <div className={`mb-3 rounded-2xl border p-3 ${isDark ? "border-dark-border bg-dark-bg/60" : "border-light-grey bg-very-light-grey/70"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <span className={`text-xs font-semibold uppercase tracking-wide ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}`}>
                      AI scenario explanation
                    </span>
                    <p className={`mt-1 text-sm font-medium ${isDark ? "text-dark-text" : "text-dark-charcoal"}`}>
                      {scenarioExplanation.headline}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${isDark ? "bg-dark-card text-dark-text-secondary" : "bg-pure-white text-dark-charcoal/65"}`}>
                    {simulationDateLabel}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  {scenarioExplanation.metrics.map((metric) => (
                    <div
                      key={metric.label}
                      className={`rounded-xl border px-3 py-2 ${isDark ? "border-dark-border bg-dark-card" : "border-light-grey bg-pure-white"}`}
                    >
                      <span className={`block text-[10px] font-semibold uppercase tracking-wide ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/55"}`}>
                        {metric.label}
                      </span>
                      <strong className={`mt-0.5 block text-sm ${isDark ? "text-dark-text" : "text-dark-charcoal"}`}>
                        {metric.value}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`text-xs font-semibold uppercase tracking-wide ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}`}>
                  Highest predicted node risks
                </span>
                <span className={`text-xs ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}`}>
                  {aiNodesLoading ? "Updating..." : `${aiPredictionSummary.total} IoT nodes`}
                </span>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                {aiPredictionSummary.topNodes.map((node) => (
                  <div key={node.node_id} className="min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm font-semibold ${isDark ? "text-dark-text" : "text-dark-charcoal"}`}>
                        {node.node_id}
                      </span>
                      <span className={`text-xs font-semibold ${node.predicted_level >= 3 ? "text-status-danger" : node.predicted_level === 2 ? "text-status-warning-2" : node.predicted_level === 1 ? "text-status-warning-1" : "text-status-green"}`}>
                        {Math.round(node.probability)}%
                      </span>
                    </div>
                    <div className={`mt-1 h-1.5 overflow-hidden rounded-full ${isDark ? "bg-dark-bg" : "bg-very-light-grey"}`}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, Math.round(node.probability))}%`,
                          background: RISK_COLORS[node.predicted_level] ?? RISK_COLORS[0],
                        }}
                      />
                    </div>
                    <p className={`mt-1 truncate text-[11px] ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}`}>
                      {node.village_id ?? "Sample village"} | {RISK_LABELS[node.predicted_level] ?? node.risk_label}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-4">
            {[0, 1, 2, 3].map((lvl) => (
              <div
                key={lvl}
                className={`flex items-center gap-1.5 text-[11px] font-medium transition-opacity ${minLevel > lvl ? "opacity-30" : ""} ${isDark ? "text-dark-text-secondary" : "text-dark-charcoal/70"}`}
              >
                <span className="h-3 w-3 rounded-sm" style={{ background: RISK_COLORS[lvl] }} />
                {RISK_LABELS[lvl]} ({RISK_FT[lvl]})
              </div>
            ))}
          </div>
        </article>

      </div>

      {/* ─── Bar Charts Row ─────────────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Water Level by Node – Vertical Bar */}
        <article
          className={`rounded-3xl border p-5 shadow-sm transition-colors ${
            isDark
              ? "border-dark-border bg-dark-card"
              : "border-light-grey bg-pure-white"
          }`}
        >
          <h2
            className={`text-lg font-semibold transition-colors ${
              isDark ? "text-dark-text" : "text-dark-charcoal"
            }`}
          >
            Water Level by Node ID
          </h2>
          <p
            className={`text-xs uppercase tracking-wide transition-colors ${
              isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"
            }`}
          >
            Real-time readings (ft)
          </p>
          <div className="mt-4 h-72 w-full min-w-0">
            <ResponsiveContainer width="100%" height={288} minWidth={0}>
              <BarChart data={barChartData} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10, fill: chartTextColor }}
                  axisLine={false}
                  tickLine={false}
                  label={{
                    value: "Node ID",
                    position: "insideBottom",
                    offset: -5,
                    fontSize: 11,
                    fill: chartTextColor,
                  }}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: chartTextColor }}
                  axisLine={false}
                  tickLine={false}
                  domain={[0, 4]}
                  label={{
                    value: "Water Level (ft)",
                    angle: -90,
                    position: "insideLeft",
                    fontSize: 11,
                    fill: chartTextColor,
                  }}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: `1px solid ${tooltipBorder}`,
                    fontSize: 12,
                    backgroundColor: tooltipBg,
                    color: isDark ? "#e8e8e8" : "#4E4B4B",
                  }}
                  formatter={(value) => [`${value} ft`, "Water Level"]}
                />
                <Legend
                  verticalAlign="top"
                  height={36}
                  iconType="square"
                  wrapperStyle={{ fontSize: 12, fontWeight: 500, color: chartTextColor }}
                />
                <Bar
                  dataKey="level"
                  name="Water Level"
                  fill="#1d4ed8"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        {/* Total Flood by State – Horizontal Bar */}
        <article
          className={`rounded-3xl border p-5 shadow-sm transition-colors ${
            isDark
              ? "border-dark-border bg-dark-card"
              : "border-light-grey bg-pure-white"
          }`}
        >
          <h2
            className={`text-lg font-semibold transition-colors ${
              isDark ? "text-dark-text" : "text-dark-charcoal"
            }`}
          >
            Total Flood by State
          </h2>
          <p
            className={`text-xs uppercase tracking-wide transition-colors ${
              isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"
            }`}
          >
            Total vs Critical incidents
          </p>
          <div className="mt-4 h-72 w-full min-w-0">
            <ResponsiveContainer width="100%" height={288} minWidth={0}>
              <BarChart data={stateBarData} layout="vertical" barCategoryGap="18%">
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: chartTextColor }}
                  axisLine={false}
                  tickLine={false}
                  label={{
                    value: "Number of Incidents",
                    position: "insideBottom",
                    offset: -5,
                    fontSize: 11,
                    fill: chartTextColor,
                  }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 10, fill: chartTextColor }}
                  axisLine={false}
                  tickLine={false}
                  width={80}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: `1px solid ${tooltipBorder}`,
                    fontSize: 12,
                    backgroundColor: tooltipBg,
                    color: isDark ? "#e8e8e8" : "#4E4B4B",
                  }}
                />
                <Legend
                  verticalAlign="top"
                  height={36}
                  iconType="square"
                  wrapperStyle={{ fontSize: 12, fontWeight: 500, color: chartTextColor }}
                />
                <Bar
                  dataKey="total"
                  name="Total Incidents"
                  fill="#1d4ed8"
                  radius={[0, 6, 6, 0]}
                />
                <Bar
                  dataKey="critical"
                  name="Critical Incidents"
                  fill="#1e3a8a"
                  radius={[0, 6, 6, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </div>
    </section>
  );
}
