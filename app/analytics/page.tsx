"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import OverviewCard from "@/components/cards/OverviewCard";
import { useAuth } from "@/lib/AuthContext";
import { authFetchJson } from "@/lib/authFetch";
import { useTheme } from "@/lib/ThemeContext";
import {
  RISK_COLORS,
  RISK_LABELS,
  RISK_FT,
  eventCountToLevel,
  isEmptyChartData,
  generateDailyFallback,
  generateWeeklyFallback,
  generateMonthlyFallback,
  generateMalaysiaStateFallback,
  isFloodByStateSparse,
} from "@/lib/floodRiskMock";
import FloodRiskChart, { type FloodRiskVariant } from "@/components/charts/FloodRiskChart";
import {
  ChartTooltipShell,
  TooltipRow,
} from "@/components/charts/ChartTooltip";

// ─── Types matching AnalyticsDataDto ────────────────────────────────────────
interface StatDto        { label: string; value: string; icon: string; trend: string; }
interface WaterLevelDto  { nodeId: string; level: number; status: string; }
interface FloodByStateDto{ state: string; total: number; }
interface RecentEventDto { title: string; timestamp: string; type: string; }

interface AnalyticsData {
  stats:            StatDto[];
  chartData:        number[];
  yearlyChartData:  number[];
  waterLevelByNode: WaterLevelDto[];
  floodByState:     FloodByStateDto[];
  recentEvents:     RecentEventDto[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const LEVEL_TO_METERS: Record<number, number> = { 0: 0.0, 1: 1.0, 2: 2.5, 3: 4.0 };

// Severity palette — emergency-services convention (green / amber / orange / red).
// Aligned with the shared RISK_COLORS in lib/floodRiskMock so Dashboard and
// Analytics speak the same visual language.
function levelColor(level: number): string {
  if (level >= 3)  return "#dc2626"; // red-600    — Critical
  if (level === 2) return "#f97316"; // orange-500 — Warning
  if (level === 1) return "#f59e0b"; // amber-500  — Alert
  return "#22c55e";                  // green-500  — Normal
}

const PIE_COLORS = ["#dc2626", "#f97316", "#f59e0b", "#22c55e"];

const bubbleLegendData = [
  { value: "Normal (0 ft)",     color: "#22c55e" },
  { value: "Alert (1 ft)",      color: "#f59e0b" },
  { value: "Warning (2 ft)",    color: "#f97316" },
  { value: "Critical (3+ ft)",  color: "#dc2626" },
];

// Last 7 day labels
const weekLabels = Array.from({ length: 7 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (6 - i));
  return d.toLocaleDateString("en-MY", { weekday: "short", day: "numeric" });
});

// ── Flood Risk Analysis helpers — shared with /dashboard via lib/floodRiskMock
type RiskScale = "hourly" | "daily" | "weekly" | "monthly";

// Last 5 month labels
const monthLabels = Array.from({ length: 5 }, (_, i) => {
  const d = new Date();
  d.setMonth(d.getMonth() - (4 - i));
  return d.toLocaleDateString("en-MY", { month: "short", year: "2-digit" });
});

type NodesApiResponse = {
  success?: boolean;
  data?: Array<{ node_id: string; latitude: number; longitude: number }>;
};

export default function AnalyticsPage() {
  const { isDark } = useTheme();
  const { accessToken, silentRefresh } = useAuth();

  const [data, setData] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // nodeGpsMap: keyed by node_id — populated from /api/nodes to provide real lat/lng
  // for the bubble scatter map (analytics response only has nodeId, level, status).
  const [nodeGpsMap, setNodeGpsMap] = useState<Record<string, { latitude: number; longitude: number }>>({});

  // Chart axis / grid colours. Tooltip surface is owned by ChartTooltipShell.
  const chartTextColor  = isDark ? "#a0a0a0" : "#4E4B4B";
  const chartGridColor  = isDark ? "#2d3a5a" : "#E5E5E5";

  useEffect(() => {
    if (!accessToken) return;

    let cancelled = false;

    // Hard timeout — without this, a hung Java cold-start could spin
    // "Loading analytics..." forever. 15 s is enough to absorb a worst-
    // case Railway cold boot + JVM warm-up + 8 SQL aggregations + initial
    // Redis prime, but short enough that a real hang surfaces as an
    // error the user can act on.
    const ANALYTICS_TIMEOUT_MS = 15_000;

    function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const t = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms} ms`)),
          ms,
        );
        p.then(
          (v) => { clearTimeout(t); resolve(v); },
          (e) => { clearTimeout(t); reject(e); },
        );
      });
    }

    setIsLoading(true);

    // PRIMARY fetch — the analytics payload drives every chart on the
    // page. The loading spinner clears the moment THIS resolves, even
    // if the secondary node-GPS fetch is still in flight. (The bubble
    // map is the only consumer of node GPS coords; everything else
    // renders fine without them.) Previously the page used
    // Promise.allSettled([analytics, nodes]) which forced the spinner
    // to wait for the slower of the two — turning a fast analytics
    // load into a multi-second wait if /api/nodes was warming up.
    (async () => {
      try {
        const value = await withTimeout(
          authFetchJson<AnalyticsData>("/api/analytics", accessToken, silentRefresh),
          ANALYTICS_TIMEOUT_MS,
          "Analytics fetch",
        );
        if (!cancelled) setData(value);
      } catch (err) {
        if (cancelled) return;
        // Surface a useful message based on the BFF's structured error
        // code rather than a generic toast. The BFF route emits one of:
        //   missing_token | unauthorized | forbidden
        //   service_starting | upstream_error
        const reason = err as
          | { code?: string; upstreamStatus?: number; message?: string }
          | undefined;
        const code = reason?.code;
        const isTimeout = /timed out/i.test(reason?.message ?? "");
        const userMsg = isTimeout
          ? "Analytics is taking longer than usual. The service may be starting up — try refreshing in a few seconds."
          : code === "service_starting"
            ? "Service is starting up. Try again in a few seconds."
            : code === "forbidden"
              ? "Your account doesn't have access to analytics."
              : code === "unauthorized" || code === "missing_token"
                ? "Please sign in again to view analytics."
                : "Failed to load analytics data.";
        console.error(
          "Analytics fetch failed:",
          code ?? "(no code)",
          reason?.upstreamStatus ?? "(no upstream status)",
          reason?.message ?? reason,
        );
        toast.error(userMsg);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    // SECONDARY fetch — node GPS coords for the bubble map. Decoupled
    // from the primary loading state: the page renders without these
    // (the rest of the analytics work fine), and the bubble map updates
    // lazily when this resolves.
    (async () => {
      try {
        const result = await withTimeout(
          authFetchJson<NodesApiResponse>("/api/nodes", accessToken, silentRefresh),
          ANALYTICS_TIMEOUT_MS,
          "Nodes fetch",
        );
        if (cancelled) return;
        if (result?.success && Array.isArray(result.data)) {
          const map: Record<string, { latitude: number; longitude: number }> = {};
          result.data.forEach((n) => {
            if (n.node_id != null && n.latitude != null && n.longitude != null) {
              map[n.node_id] = { latitude: n.latitude, longitude: n.longitude };
            }
          });
          setNodeGpsMap(map);
        }
      } catch (err) {
        // Non-fatal — the rest of analytics renders fine — but let the
        // operator know the geographic bubble map may be incomplete so
        // they don't mistake missing bubbles for "no sensors there".
        if (!cancelled) {
          toast("Sensor map data is unavailable — the bubble chart may be incomplete.", {
            icon: "ℹ️",
          });
        }
        console.warn(
          "Node GPS fetch failed; bubble map may be incomplete.",
          err instanceof Error ? err.message : err,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken, silentRefresh]);

  // ── Derived chart data ───────────────────────────────────────────────────
  const lineChartData = (data?.chartData ?? Array(7).fill(0)).map((v, i) => ({
    name: weekLabels[i],
    events: v,
  }));

  const yearlyChartData = (data?.yearlyChartData ?? Array(5).fill(0)).map((v, i) => ({
    name: monthLabels[i],
    events: v,
  }));

  const barChartData = (data?.waterLevelByNode ?? []).map((n) => ({
    name: n.nodeId.slice(-6),
    level: LEVEL_TO_METERS[n.level] ?? 0,
    rawLevel: n.level,
  }));

  // Total Flood Incidents by State — fall back to a Malaysia-wide
  // distribution when the live API has 0 or 1 states populated, otherwise
  // an admin only ever sees a single Sarawak bar with no national context.
  // Live data wins as soon as multiple states report.
  const stateFallbackActive = isFloodByStateSparse(data?.floodByState);
  const stateBarData = stateFallbackActive
    ? generateMalaysiaStateFallback().map((s) => ({ name: s.state, total: s.total }))
    : (data?.floodByState ?? []).map((s) => ({ name: s.state, total: s.total }));

  // BUG-ANAL01 FIX: Join waterLevelByNode with real GPS from /api/nodes.
  // Only nodes whose node_id is in nodeGpsMap are plotted (no fake offsets).
  const bubbleData = (data?.waterLevelByNode ?? [])
    .filter((n) => nodeGpsMap[n.nodeId])
    .map((n) => ({
      x: nodeGpsMap[n.nodeId].longitude,
      y: nodeGpsMap[n.nodeId].latitude,
      z: (n.level + 1) * 120,
      name: n.nodeId,
      level: n.level,
    }));

  // KPI cards from stats array
  const kpiCards = data?.stats ?? [
    { label: "Active Sensors", value: "—", trend: "—", icon: "" },
    { label: "Alerts (24h)",   value: "—", trend: "—", icon: "" },
    { label: "Data Points",    value: "—", trend: "—", icon: "" },
  ];

  const pieChartData = stateBarData.map((s, i) => ({
    name: s.name,
    value: s.total,
    color: PIE_COLORS[i % PIE_COLORS.length],
  })).filter(d => d.value > 0);

  // ── Flood Risk Analysis state ─────────────────────────────────────────────
  const [riskScale, setRiskScale] = useState<RiskScale>("daily");
  const [riskVariant, setRiskVariant] = useState<FloodRiskVariant>("bar");
  const [minLevel, setMinLevel] = useState(0);

  const dailyRiskData = useMemo(() => {
    if (isEmptyChartData(data?.chartData)) return generateDailyFallback();
    return (data?.chartData ?? Array(7).fill(0)).map((count, i) => ({
      name: weekLabels[i] ?? `Day ${i + 1}`,
      level: eventCountToLevel(count),
      count,
    }));
  }, [data]);

  const weeklyRiskData = useMemo(() => {
    if (isEmptyChartData(data?.yearlyChartData)) return generateWeeklyFallback();
    const y = data?.yearlyChartData ?? Array(5).fill(0);
    return [
      { name: "Q1 Jan–Mar", level: eventCountToLevel(y[0] ?? 0), count: y[0] ?? 0 },
      { name: "Q2 Apr–Jun", level: eventCountToLevel(y[1] ?? 0), count: y[1] ?? 0 },
      { name: "Q3 Jul–Sep", level: eventCountToLevel(y[2] ?? 0), count: y[2] ?? 0 },
      { name: "Q4 Oct–Dec", level: eventCountToLevel(y[3] ?? 0), count: y[3] ?? 0 },
    ];
  }, [data]);

  const monthlyRiskData = useMemo(() => {
    if (isEmptyChartData(data?.yearlyChartData)) return generateMonthlyFallback();
    return (data?.yearlyChartData ?? Array(5).fill(0)).map((count, i) => ({
      name: monthLabels[i] ?? `M${i + 1}`,
      level: eventCountToLevel(count),
      count,
    }));
  }, [data]);

  const rawRiskData = { hourly: dailyRiskData, daily: dailyRiskData, weekly: weeklyRiskData, monthly: monthlyRiskData }[riskScale];
  const filteredRiskData = rawRiskData.map(d => ({
    ...d,
    level: d.level >= minLevel ? d.level : null,
  }));

  if (isLoading) {
    return (
      <section className="space-y-6">
        <div className="flex min-h-[400px] items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className={`h-12 w-12 animate-spin rounded-full border-4 ${isDark ? "border-dark-border border-t-primary-blue" : "border-light-grey border-t-primary-blue"}`} />
            <p className={`text-sm font-medium ${isDark ? "text-dark-text-secondary" : "text-dark-charcoal/70"}`}>
              Loading analytics...
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header>
        <h1
          className={`text-3xl font-semibold transition-colors ${
            isDark ? "text-dark-text" : "text-dark-charcoal"
          }`}
        >
          Analytics
        </h1>
        <p
          className={`text-sm transition-colors ${
            isDark ? "text-dark-text-secondary" : "text-dark-charcoal/70"
          }`}
        >
          Insights derived from live sensor telemetry to aid planning and mitigation.
        </p>
      </header>

      {/* ─── KPI Cards ──────────────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-3">
        {kpiCards.map((card) => (
          <OverviewCard
            key={card.label}
            title={card.label}
            value={card.value}
            helper="Live from sensor network"
            trend={{ label: card.trend, direction: "flat" }}
          />
        ))}
      </div>

      {/* ─── Row 1: Flood Risk Analysis + Water Level by Node ──────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <article className={`rounded-3xl border p-5 shadow-sm transition-colors ${isDark ? "border-dark-border bg-dark-card" : "border-light-grey bg-pure-white"}`}>
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className={`text-lg font-semibold transition-colors ${isDark ? "text-dark-text" : "text-dark-charcoal"}`}>
                Flood Risk Analysis
              </h2>
              <p className={`text-xs uppercase tracking-wide transition-colors ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}`}>
                Risk level distribution — XGBoost-inspired model
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-status-green animate-pulse" />
              <span className="text-xs font-semibold text-status-green">Live</span>
            </div>
          </div>

          {/* Controls */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className={`flex overflow-hidden rounded-xl border text-xs font-semibold ${isDark ? "border-dark-border" : "border-light-grey"}`}>
              {(["Daily", "Weekly", "Monthly"] as const).map((s) => {
                const key = s.toLowerCase() as RiskScale;
                const active = riskScale === key;
                return (
                  <button key={s} type="button" onClick={() => setRiskScale(key)}
                    className={`px-3 py-1.5 transition-colors ${active ? "bg-primary-blue text-pure-white" : isDark ? "bg-dark-bg text-dark-text hover:bg-dark-border/60" : "bg-pure-white text-dark-charcoal hover:bg-very-light-grey"}`}>
                    {s}
                  </button>
                );
              })}
            </div>
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
                <span className={`text-xs font-medium ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}`}>Min. Level</span>
                <select value={minLevel} onChange={(e) => setMinLevel(Number(e.target.value))}
                  className={`rounded-xl border px-2.5 py-1.5 text-xs font-semibold outline-none transition focus:border-primary-blue ${isDark ? "border-dark-border bg-dark-bg text-dark-text" : "border-light-grey bg-pure-white text-dark-charcoal"}`}>
                  <option value={0}>All levels</option>
                  <option value={1}>Alert+ (≥ 1)</option>
                  <option value={2}>Warning+ (≥ 2)</option>
                  <option value={3}>Critical (= 3)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Chart — shared FloodRiskChart, identical to /dashboard. The
              showThresholds prop adds dashed Alert / Warning / Critical
              reference lines so admins can see at a glance which buckets
              have crossed each alarm level (evacuation-decision context). */}
          <div className="mt-4 h-56 w-full min-w-0">
            <FloodRiskChart
              data={filteredRiskData}
              scale={riskScale}
              isDark={isDark}
              height={224}
              showThresholds
              variant={riskVariant}
            />
          </div>

          {/* Legend */}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            {[0, 1, 2, 3].map((lvl) => (
              <div key={lvl} className={`flex items-center gap-1.5 text-[11px] font-medium transition-opacity ${minLevel > lvl ? "opacity-30" : ""} ${isDark ? "text-dark-text-secondary" : "text-dark-charcoal/70"}`}>
                <span className="h-3 w-3 rounded-sm" style={{ background: RISK_COLORS[lvl] }} />
                {RISK_LABELS[lvl]} ({RISK_FT[lvl]})
              </div>
            ))}
          </div>
        </article>

        <article
          className={`rounded-3xl border p-5 shadow-sm transition-colors ${
            isDark ? "border-dark-border bg-dark-card" : "border-light-grey bg-pure-white"
          }`}
        >
          <h2 className={`text-lg font-semibold transition-colors ${isDark ? "text-dark-text" : "text-dark-charcoal"}`}>
            Water Level by Node
          </h2>
          <p className={`text-xs uppercase tracking-wide transition-colors ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}`}>
            Top 10 nodes — current readings (m)
          </p>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%" minHeight={200} minWidth={0}>
              <BarChart data={barChartData} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: chartTextColor }} axisLine={false} tickLine={false} label={{ value: "Node ID", position: "insideBottom", offset: -5, fontSize: 11, fill: chartTextColor }} />
                <YAxis tick={{ fontSize: 10, fill: chartTextColor }} axisLine={false} tickLine={false} domain={[0, 4.5]} label={{ value: "Level (m)", angle: -90, position: "insideLeft", fontSize: 11, fill: chartTextColor }} />
                <Tooltip
                  cursor={{ fill: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.[0]) return null;
                    const p = payload[0].payload as { rawLevel: number; level: number };
                    return (
                      <ChartTooltipShell isDark={isDark} title={`Node ${label}`}>
                        <TooltipRow
                          label="Water Level"
                          value={`${p.level} m`}
                          swatchHex={levelColor(p.rawLevel)}
                        />
                        <TooltipRow
                          label="Severity"
                          value={`${RISK_LABELS[p.rawLevel] ?? "—"} (${RISK_FT[p.rawLevel] ?? ""})`}
                        />
                      </ChartTooltipShell>
                    );
                  }}
                />
                <Legend verticalAlign="top" height={36} iconType="square" wrapperStyle={{ fontSize: 12, fontWeight: 500, color: chartTextColor }} />
                <Bar dataKey="level" name="Water Level" radius={[6, 6, 0, 0]}>
                  {barChartData.map((entry) => (
                    <Cell key={entry.name} fill={levelColor(entry.rawLevel)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </div>

      {/* ─── Row 2: Monthly trend + Bubble map ─────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <article
          className={`rounded-3xl border p-5 shadow-sm transition-colors ${
            isDark ? "border-dark-border bg-dark-card" : "border-light-grey bg-pure-white"
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className={`text-lg font-semibold transition-colors ${isDark ? "text-dark-text" : "text-dark-charcoal"}`}>
                Monthly Event Volume
              </h2>
              <p className={`text-xs uppercase tracking-wide transition-colors ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}`}>
                Last 5 months
              </p>
            </div>
            <span className="rounded-full bg-light-blue/70 px-3 py-1 text-xs font-semibold text-primary-blue dark:bg-primary-blue/20">
              Monthly
            </span>
          </div>
          <div className="mt-4 h-72 w-full min-w-0">
            <ResponsiveContainer width="100%" height={288} minWidth={0}>
              <AreaChart data={yearlyChartData}>
                <defs>
                  <linearGradient id="colorMonthly" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#1d4ed8" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#1d4ed8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: chartTextColor }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: chartTextColor }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.[0]) return null;
                    const v = Number(payload[0].value ?? 0);
                    return (
                      <ChartTooltipShell isDark={isDark} title={label}>
                        <TooltipRow
                          label="Events"
                          value={v.toLocaleString()}
                          swatchHex="#1d4ed8"
                        />
                      </ChartTooltipShell>
                    );
                  }}
                />
                <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: 12, fontWeight: 500, color: chartTextColor }} />
                <Area type="monotone" dataKey="events" name="Events" stroke="#1d4ed8" strokeWidth={2} fill="url(#colorMonthly)" dot={{ r: 4, fill: "#1d4ed8" }} activeDot={{ r: 6 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article
          className={`rounded-3xl border p-5 shadow-sm transition-colors ${
            isDark ? "border-dark-border bg-dark-card" : "border-light-grey bg-pure-white"
          }`}
        >
          <h2 className={`text-lg font-semibold transition-colors ${isDark ? "text-dark-text" : "text-dark-charcoal"}`}>
            Node Severity Bubble Map
          </h2>
          <p className={`text-xs uppercase tracking-wide transition-colors ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}`}>
            Real GPS coordinates · bubble size = water level severity
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-3">
            {bubbleLegendData.map((item) => (
              <div key={item.value} className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                <span className={`text-[10px] font-medium transition-colors ${isDark ? "text-dark-text" : "text-dark-charcoal"}`}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 h-64 w-full min-w-0">
            {bubbleData.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2">
                <span className={`text-3xl`}>📡</span>
                <p className={`text-sm font-medium ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}`}>
                  No GPS data available for mapped nodes.
                </p>
                <p className={`text-xs ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/50"}`}>
                  Ensure sensor nodes have valid coordinates registered.
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minHeight={200} minWidth={0}>
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis type="number" dataKey="x" name="Longitude" tick={{ fontSize: 10, fill: chartTextColor }} domain={["dataMin - 0.1", "dataMax + 0.1"]} tickFormatter={(v) => v.toFixed(2)} label={{ value: "Longitude (°E)", position: "insideBottom", offset: -5, fontSize: 11, fill: chartTextColor }} />
                  <YAxis type="number" dataKey="y" name="Latitude"  tick={{ fontSize: 10, fill: chartTextColor }} domain={["dataMin - 0.05", "dataMax + 0.05"]} tickFormatter={(v) => v.toFixed(2)} label={{ value: "Latitude (°N)", angle: -90, position: "insideLeft", fontSize: 11, fill: chartTextColor }} />
                  <ZAxis type="number" dataKey="z" range={[60, 400]} />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null;
                      const p = payload[0].payload as {
                        x: number; y: number; name: string; level: number;
                      };
                      return (
                        <ChartTooltipShell isDark={isDark} title={`Node ${p.name}`}>
                          <TooltipRow
                            label="Severity"
                            value={`${RISK_LABELS[p.level] ?? "—"} (${RISK_FT[p.level] ?? ""})`}
                            swatchHex={levelColor(p.level)}
                          />
                          <TooltipRow label="Latitude"  value={`${p.y.toFixed(4)}°N`} />
                          <TooltipRow label="Longitude" value={`${p.x.toFixed(4)}°E`} />
                        </ChartTooltipShell>
                      );
                    }}
                  />
                  <Scatter name="Nodes" data={bubbleData}>
                    {bubbleData.map((entry) => (
                      <Cell key={entry.name} fill={levelColor(entry.level)} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            )}
          </div>
        </article>
      </div>

      {/* ─── Row 3: Flood by State ───────────────────────────────────────────── */}
      <article
        className={`rounded-3xl border p-5 shadow-sm transition-colors ${
          isDark ? "border-dark-border bg-dark-card" : "border-light-grey bg-pure-white"
        }`}
      >
        <h2 className={`text-lg font-semibold transition-colors ${isDark ? "text-dark-text" : "text-dark-charcoal"}`}>
          Total Flood Incidents by State
        </h2>
        <p className={`text-xs uppercase tracking-wide transition-colors ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}`}>
          {stateFallbackActive
            ? "National historical baseline · Sarawak highlighted"
            : "Cumulative alert events per state · Sarawak highlighted"}
        </p>
        <div className="mt-4 h-[420px] w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart data={stateBarData} layout="vertical" barCategoryGap="14%">
              <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: chartTextColor }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => v.toLocaleString()}
                label={{ value: "Number of Incidents", position: "insideBottom", offset: -5, fontSize: 11, fill: chartTextColor }}
              />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: chartTextColor }} axisLine={false} tickLine={false} width={130} />
              <Tooltip
                cursor={{ fill: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.[0]) return null;
                  const v = Number(payload[0].value ?? 0);
                  return (
                    <ChartTooltipShell isDark={isDark} title={String(label)}>
                      <TooltipRow
                        label="Total Incidents"
                        value={v.toLocaleString()}
                        swatchHex={String(label) === "Sarawak" ? "#1d4ed8" : isDark ? "#3b6fd4" : "#93c5fd"}
                      />
                    </ChartTooltipShell>
                  );
                }}
              />
              <Legend verticalAlign="top" height={36} iconType="square" wrapperStyle={{ fontSize: 12, fontWeight: 500, color: chartTextColor }} />
              <Bar dataKey="total" name="Total Incidents" radius={[0, 6, 6, 0]}>
                {stateBarData.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={entry.name === "Sarawak" ? "#1d4ed8" : isDark ? "#3b6fd4" : "#93c5fd"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>

      {/* ─── Recommendation Engine ──────────────────────────────────────────── */}
      <article
        className={`rounded-3xl border p-5 shadow-sm transition-colors ${
          isDark ? "border-dark-border bg-dark-card" : "border-light-grey bg-pure-white"
        }`}
      >
        <h2 className={`text-lg font-semibold transition-colors ${isDark ? "text-dark-text" : "text-dark-charcoal"}`}>
          Recommendation Engine
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div className={`rounded-2xl border p-4 transition-colors ${isDark ? "border-dark-border" : "border-light-grey"}`}>
            <p className="text-sm font-semibold text-primary-red">Escalate</p>
            <p className={`mt-2 text-sm transition-colors ${isDark ? "text-dark-text-secondary" : "text-dark-charcoal/80"}`}>
              {data?.waterLevelByNode?.[0]
                ? `Node ${data.waterLevelByNode[0].nodeId} is at level ${data.waterLevelByNode[0].level} (${data.waterLevelByNode[0].status}). Monitor closely.`
                : "No critical nodes detected."}
            </p>
          </div>
          <div className={`rounded-2xl border p-4 transition-colors ${isDark ? "border-dark-border" : "border-light-grey"}`}>
            <p className="text-sm font-semibold text-status-warning-2">Preventive</p>
            <p className={`mt-2 text-sm transition-colors ${isDark ? "text-dark-text-secondary" : "text-dark-charcoal/80"}`}>
              Schedule maintenance for offline nodes. Check sensor calibration for nodes reporting steady level 3.
            </p>
          </div>
          <div className={`rounded-2xl border p-4 transition-colors ${isDark ? "border-dark-border" : "border-light-grey"}`}>
            <p className="text-sm font-semibold text-status-green">Operational</p>
            <p className={`mt-2 text-sm transition-colors ${isDark ? "text-dark-text-secondary" : "text-dark-charcoal/80"}`}>
              Auto-share a CSV snapshot with the command center every 6 hours.
            </p>
          </div>
        </div>
      </article>
    </section>
  );
}
