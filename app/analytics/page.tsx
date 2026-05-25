"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
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
} from "@/lib/floodRiskMock";
import FloodRiskChart, { type FloodRiskVariant } from "@/components/charts/FloodRiskChart";
import {
  ChartTooltipShell,
  TooltipRow,
} from "@/components/charts/ChartTooltip";
import type { IoTNode, IoTStatsSummary } from "@/lib/floodwatch/types";

// ════════════════════════════════════════════════════════════════════════════
// DATA SOURCING — everything on this page is REAL telemetry, no fabricated
// fallbacks. The four charts an admin reads for situational awareness
// (per-node water level, node-severity geography, alert-type mix, alerts by
// area) are sourced straight from the live FloodWatch IoT API — the same
// authoritative source the flood map and AI predictions already use:
//
//   • /api/iot/nodes               → live node water_level / GPS / battery
//   • /api/iot/stats/summary       → real period roll-ups (alerts_by_type,
//                                     top_alerted_villages, top_active_nodes)
//
// We query `dataset=all` so both production LoRa hardware AND the always-on
// SIM-PITAS simulator are included — every reading is genuine API data.
//
// The Flood Risk Analysis card (model-driven risk distribution) is the one
// exception and is intentionally left on its existing /api/analytics source.
// ════════════════════════════════════════════════════════════════════════════

const IOT_DATASET = "all";

// ─── Helpers ─────────────────────────────────────────────────────────────────
// Discrete float-switch level (0–3) → an indicative water depth in metres so
// the per-node bar chart reads in real-world units (the sensors only report a
// 4-state level, not a continuous gauge).
const LEVEL_TO_METERS: Record<number, number> = { 0: 0.0, 1: 1.0, 2: 2.5, 3: 4.0 };

// Severity palette — emergency-services convention (green / amber / orange / red).
function levelColor(level: number): string {
  if (level >= 3) return "#dc2626"; // red-600    — Critical
  if (level === 2) return "#f97316"; // orange-500 — Warning
  if (level === 1) return "#f59e0b"; // amber-500  — Alert
  return "#22c55e"; // green-500  — Normal
}

const bubbleLegendData = [
  { value: "Normal (0 ft)", color: "#22c55e" },
  { value: "Alert (1 ft)", color: "#f59e0b" },
  { value: "Warning (2 ft)", color: "#f97316" },
  { value: "Critical (3+ ft)", color: "#dc2626" },
];

// Human labels + colours for every alert_type the IoT API emits. Unknown
// keys (forward-compat) fall back to a slate swatch + de-snake-cased label.
const ALERT_TYPE_META: Record<string, { label: string; color: string }> = {
  flood: { label: "Flood", color: "#dc2626" },
  water_fall: { label: "Water receding", color: "#2563eb" },
  battery: { label: "Battery", color: "#f59e0b" },
  battery_low: { label: "Battery low", color: "#f59e0b" },
  battery_critical: { label: "Battery critical", color: "#b45309" },
  gps_moved: { label: "GPS moved", color: "#8b5cf6" },
  gps_signal_lost: { label: "GPS signal lost", color: "#64748b" },
  gps_restored: { label: "GPS restored", color: "#22c55e" },
  crash: { label: "Crash / reset", color: "#0ea5e9" },
};
function alertMeta(key: string): { label: string; color: string } {
  return ALERT_TYPE_META[key] ?? { label: key.replace(/_/g, " "), color: "#94a3b8" };
}

function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// Bar palette for the "alerts by area" ranking — top area highlighted.
const AREA_BAR_TOP = "#1d4ed8";
function areaBarColor(rank: number, isDark: boolean): string {
  if (rank === 0) return AREA_BAR_TOP;
  return isDark ? "#3b6fd4" : "#93c5fd";
}

// ── Flood Risk Analysis helpers — shared with /dashboard via lib/floodRiskMock
type RiskScale = "hourly" | "daily" | "weekly" | "monthly";

const weekLabels = Array.from({ length: 7 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (6 - i));
  return d.toLocaleDateString("en-MY", { weekday: "short", day: "numeric" });
});

const monthLabels = Array.from({ length: 5 }, (_, i) => {
  const d = new Date();
  d.setMonth(d.getMonth() - (4 - i));
  return d.toLocaleDateString("en-MY", { month: "short", year: "2-digit" });
});

// ── Period selector for the IoT summary roll-ups ─────────────────────────────
type SummaryPeriod = "today" | "week" | "month";
const PERIOD_OPTIONS: { key: SummaryPeriod; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "Last 30 Days" },
];
const PERIOD_NOUN: Record<SummaryPeriod, string> = {
  today: "today",
  week: "this week",
  month: "last 30 days",
};

// Risk-chart data still rides the authenticated Java analytics route.
interface RiskAnalyticsData {
  chartData: number[];
  yearlyChartData: number[];
}

// Fetch an authenticated BFF route using the httpOnly cookie. On 401/403 the
// access cookie may have expired — silent-refresh once, then retry.
async function fetchJsonWithCookie<T>(
  url: string,
  silentRefresh: () => Promise<string | null>,
): Promise<T> {
  const doFetch = () => fetch(url, { cache: "no-store", credentials: "include" });
  let res = await doFetch();
  if (res.status === 401 || res.status === 403) {
    await silentRefresh();
    res = await doFetch();
  }
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

// Public IoT BFF routes need no auth — plain no-store GET.
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

export default function AnalyticsPage() {
  const { isDark } = useTheme();
  const { silentRefresh } = useAuth();

  // Live IoT data (primary — drives the page).
  const [nodes, setNodes] = useState<IoTNode[]>([]);
  const [summary, setSummary] = useState<IoTStatsSummary | null>(null);
  const [period, setPeriod] = useState<SummaryPeriod>("month");
  const [isLoading, setIsLoading] = useState(true); // first nodes load
  const [summaryLoading, setSummaryLoading] = useState(true);

  // Risk-chart data (secondary — model-driven, from Java analytics).
  const [risk, setRisk] = useState<RiskAnalyticsData | null>(null);

  // Chart axis / grid colours. Tooltip surface is owned by ChartTooltipShell.
  const chartTextColor = isDark ? "#a0a0a0" : "#4E4B4B";
  const chartGridColor = isDark ? "#2d3a5a" : "#E5E5E5";

  // ── Effect A: live nodes (IoT) + risk data (Java) — once on mount ──────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const list = await getJson<IoTNode[]>(`/api/iot/nodes?dataset=${IOT_DATASET}`);
        if (!cancelled) setNodes(Array.isArray(list) ? list : []);
      } catch (err) {
        if (!cancelled) {
          console.error("[analytics] live nodes fetch failed:", err);
          toast.error("Couldn't load live sensor data.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    // Risk-chart data is non-blocking; the card falls back to its own
    // model-distribution if the Java service is cold/empty.
    (async () => {
      try {
        const value = await fetchJsonWithCookie<RiskAnalyticsData>(
          "/api/analytics",
          silentRefresh,
        );
        if (!cancelled) setRisk(value);
      } catch (err) {
        if (!cancelled) console.warn("[analytics] risk data unavailable:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [silentRefresh]);

  // ── Effect B: summary roll-ups — refetch whenever the period changes ───────
  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true);
    (async () => {
      try {
        const s = await getJson<IoTStatsSummary>(
          `/api/iot/stats/summary?period=${period}&dataset=${IOT_DATASET}`,
        );
        if (!cancelled) setSummary(s);
      } catch (err) {
        if (!cancelled) {
          console.error("[analytics] summary fetch failed:", err);
          setSummary(null);
        }
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period]);

  // ── Derived: live-node charts ──────────────────────────────────────────────
  const onlineCount = useMemo(
    () => nodes.filter((n) => n.status === "online").length,
    [nodes],
  );

  // Water level by node — worst-first, top 12, real water_level.
  const waterLevelByNode = useMemo(
    () =>
      [...nodes]
        .sort((a, b) => b.water_level - a.water_level)
        .slice(0, 12)
        .map((n) => ({
          name: n.node_id.slice(-6),
          fullId: n.node_id,
          level: LEVEL_TO_METERS[n.water_level] ?? 0,
          rawLevel: n.water_level,
        })),
    [nodes],
  );

  // Node severity geography — only nodes with a real GPS / install fix.
  // Reject (0,0) and non-finite coords so test nodes without a fix don't
  // collapse onto Null Island.
  const bubbleData = useMemo(
    () =>
      nodes
        .map((n) => {
          const lat = n.lat ?? n.install_lat ?? null;
          const lng = n.lng ?? n.install_lng ?? null;
          return { lat, lng, node: n };
        })
        .filter(
          ({ lat, lng }) =>
            typeof lat === "number" &&
            typeof lng === "number" &&
            Number.isFinite(lat) &&
            Number.isFinite(lng) &&
            !(lat === 0 && lng === 0),
        )
        .map(({ lat, lng, node }) => ({
          x: lng as number,
          y: lat as number,
          z: (node.water_level + 1) * 120,
          name: node.node_id,
          level: node.water_level,
        })),
    [nodes],
  );

  // ── Derived: summary roll-up charts ────────────────────────────────────────
  const alertTypeData = useMemo(() => {
    const byType = (summary?.alerts_by_type ?? {}) as Record<string, number>;
    return Object.entries(byType)
      .filter(([, v]) => (v ?? 0) > 0)
      .map(([key, value]) => ({ key, name: alertMeta(key).label, value, color: alertMeta(key).color }))
      .sort((a, b) => b.value - a.value);
  }, [summary]);

  const alertTypeTotal = useMemo(
    () => alertTypeData.reduce((sum, d) => sum + d.value, 0),
    [alertTypeData],
  );

  const areaData = useMemo(
    () =>
      (summary?.top_alerted_villages ?? [])
        .slice(0, 8)
        .map((v) => ({ name: v.village_id, total: v.alerts })),
    [summary],
  );

  const activeNodeData = useMemo(
    () =>
      (summary?.top_active_nodes ?? [])
        .slice(0, 8)
        .map((n) => ({ name: n.node_id.length > 12 ? n.node_id.slice(-10) : n.node_id, fullId: n.node_id, readings: n.readings })),
    [summary],
  );

  // ── KPI cards — real, period-aware ─────────────────────────────────────────
  const kpiCards = [
    {
      label: "Active Sensors",
      value: isLoading ? "—" : String(onlineCount),
      helper: `${nodes.length} total in network`,
      trend: "online now",
    },
    {
      label: `Alerts (${PERIOD_OPTIONS.find((p) => p.key === period)?.label ?? ""})`,
      value: summaryLoading || !summary ? "…" : formatCount(summary.total_alerts),
      helper: `Across all monitored areas`,
      trend: PERIOD_NOUN[period],
    },
    {
      label: "Readings Processed",
      value: summaryLoading || !summary ? "…" : formatCount(summary.total_readings),
      helper: `Sensor messages ${PERIOD_NOUN[period]}`,
      trend: PERIOD_NOUN[period],
    },
    {
      label: "Peak Water Level",
      value:
        summaryLoading || !summary
          ? "…"
          : `${RISK_LABELS[summary.peak_water_level] ?? "—"}`,
      helper:
        summaryLoading || !summary
          ? `Highest ${PERIOD_NOUN[period]}`
          : `${RISK_FT[summary.peak_water_level] ?? ""} · highest ${PERIOD_NOUN[period]}`,
      trend: "severity",
    },
  ];

  // ── Flood Risk Analysis (model-driven; unchanged data source) ──────────────
  const [riskScale, setRiskScale] = useState<RiskScale>("daily");
  const [riskVariant, setRiskVariant] = useState<FloodRiskVariant>("bar");
  const [minLevel, setMinLevel] = useState(0);

  const dailyRiskData = useMemo(() => {
    if (isEmptyChartData(risk?.chartData)) return generateDailyFallback();
    return (risk?.chartData ?? Array(7).fill(0)).map((count, i) => ({
      name: weekLabels[i] ?? `Day ${i + 1}`,
      level: eventCountToLevel(count),
      count,
    }));
  }, [risk]);

  const weeklyRiskData = useMemo(() => {
    if (isEmptyChartData(risk?.yearlyChartData)) return generateWeeklyFallback();
    const y = risk?.yearlyChartData ?? Array(5).fill(0);
    return [
      { name: "Q1 Jan–Mar", level: eventCountToLevel(y[0] ?? 0), count: y[0] ?? 0 },
      { name: "Q2 Apr–Jun", level: eventCountToLevel(y[1] ?? 0), count: y[1] ?? 0 },
      { name: "Q3 Jul–Sep", level: eventCountToLevel(y[2] ?? 0), count: y[2] ?? 0 },
      { name: "Q4 Oct–Dec", level: eventCountToLevel(y[3] ?? 0), count: y[3] ?? 0 },
    ];
  }, [risk]);

  const monthlyRiskData = useMemo(() => {
    if (isEmptyChartData(risk?.yearlyChartData)) return generateMonthlyFallback();
    return (risk?.yearlyChartData ?? Array(5).fill(0)).map((count, i) => ({
      name: monthLabels[i] ?? `M${i + 1}`,
      level: eventCountToLevel(count),
      count,
    }));
  }, [risk]);

  const rawRiskData = { hourly: dailyRiskData, daily: dailyRiskData, weekly: weeklyRiskData, monthly: monthlyRiskData }[riskScale];
  const filteredRiskData = rawRiskData.map((d) => ({
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

  const cardClass = `rounded-3xl border p-5 shadow-sm transition-colors ${isDark ? "border-dark-border bg-dark-card" : "border-light-grey bg-pure-white"}`;
  const titleClass = `text-lg font-semibold transition-colors ${isDark ? "text-dark-text" : "text-dark-charcoal"}`;
  const subtitleClass = `text-xs uppercase tracking-wide transition-colors ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}`;
  const emptyTextClass = `text-sm font-medium ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}`;

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className={`text-3xl font-semibold transition-colors ${isDark ? "text-dark-text" : "text-dark-charcoal"}`}>
            Analytics
          </h1>
          <p className={`text-sm transition-colors ${isDark ? "text-dark-text-secondary" : "text-dark-charcoal/70"}`}>
            Live insights from the FloodWatch sensor network — every chart below is real telemetry.
          </p>
        </div>
        {/* Period toggle — drives the summary roll-up charts + KPIs */}
        <div className={`flex overflow-hidden rounded-xl border text-xs font-semibold ${isDark ? "border-dark-border" : "border-light-grey"}`}>
          {PERIOD_OPTIONS.map((p) => {
            const active = period === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriod(p.key)}
                aria-pressed={active}
                className={`px-3 py-1.5 transition-colors ${
                  active
                    ? "bg-primary-blue text-pure-white"
                    : isDark
                      ? "bg-dark-bg text-dark-text hover:bg-dark-border/60"
                      : "bg-pure-white text-dark-charcoal hover:bg-very-light-grey"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* ─── KPI Cards ──────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((card) => (
          <OverviewCard
            key={card.label}
            title={card.label}
            value={card.value}
            helper={card.helper}
            trend={{ label: card.trend, direction: "flat" }}
          />
        ))}
      </div>

      {/* ─── Row 1: Flood Risk Analysis + Water Level by Node ──────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <article className={cardClass}>
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className={titleClass}>Flood Risk Analysis</h2>
              <p className={subtitleClass}>Risk level distribution — XGBoost-inspired model</p>
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

        <article className={cardClass}>
          <h2 className={titleClass}>Water Level by Node</h2>
          <p className={subtitleClass}>Live readings — worst-first (top {waterLevelByNode.length})</p>
          <div className="mt-4 h-72">
            {waterLevelByNode.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2">
                <span className="text-3xl">📡</span>
                <p className={emptyTextClass}>No live nodes reporting.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minHeight={200} minWidth={0}>
                <BarChart data={waterLevelByNode} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: chartTextColor }} axisLine={false} tickLine={false} label={{ value: "Node ID", position: "insideBottom", offset: -5, fontSize: 11, fill: chartTextColor }} />
                  <YAxis tick={{ fontSize: 10, fill: chartTextColor }} axisLine={false} tickLine={false} domain={[0, 4.5]} label={{ value: "Level (m)", angle: -90, position: "insideLeft", fontSize: 11, fill: chartTextColor }} />
                  <Tooltip
                    cursor={{ fill: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null;
                      const p = payload[0].payload as { fullId: string; rawLevel: number; level: number };
                      return (
                        <ChartTooltipShell isDark={isDark} title={`Node ${p.fullId}`}>
                          <TooltipRow label="Water Level" value={`${p.level} m`} swatchHex={levelColor(p.rawLevel)} />
                          <TooltipRow label="Severity" value={`${RISK_LABELS[p.rawLevel] ?? "—"} (${RISK_FT[p.rawLevel] ?? ""})`} />
                        </ChartTooltipShell>
                      );
                    }}
                  />
                  <Legend verticalAlign="top" height={36} iconType="square" wrapperStyle={{ fontSize: 12, fontWeight: 500, color: chartTextColor }} />
                  <Bar dataKey="level" name="Water Level" radius={[6, 6, 0, 0]}>
                    {waterLevelByNode.map((entry) => (
                      <Cell key={entry.fullId} fill={levelColor(entry.rawLevel)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </article>
      </div>

      {/* ─── Row 2: Alert Type Distribution + Alerts by Area ───────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <article className={cardClass}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className={titleClass}>Alert Type Distribution</h2>
              <p className={subtitleClass}>What the sensors are reporting · {PERIOD_NOUN[period]}</p>
            </div>
            <span className="rounded-full bg-light-blue/70 px-3 py-1 text-xs font-semibold text-primary-blue dark:bg-primary-blue/20">
              {formatCount(alertTypeTotal)} alerts
            </span>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-5">
            <div className="h-64 sm:col-span-3">
              {alertTypeData.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2">
                  <span className="text-3xl">✅</span>
                  <p className={emptyTextClass}>No alerts in this period.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%" minHeight={200} minWidth={0}>
                  <PieChart>
                    <Pie data={alertTypeData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={92} paddingAngle={2} stroke="none">
                      {alertTypeData.map((entry) => (
                        <Cell key={entry.key} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.[0]) return null;
                        const p = payload[0].payload as { name: string; value: number; color: string };
                        const pct = alertTypeTotal > 0 ? ((p.value / alertTypeTotal) * 100).toFixed(1) : "0";
                        return (
                          <ChartTooltipShell isDark={isDark} title={p.name}>
                            <TooltipRow label="Count" value={p.value.toLocaleString()} swatchHex={p.color} />
                            <TooltipRow label="Share" value={`${pct}%`} />
                          </ChartTooltipShell>
                        );
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            {/* Custom legend — ranked list with counts */}
            <div className="flex flex-col justify-center gap-2 sm:col-span-2">
              {alertTypeData.slice(0, 6).map((d) => {
                const pct = alertTypeTotal > 0 ? ((d.value / alertTypeTotal) * 100).toFixed(0) : "0";
                return (
                  <div key={d.key} className="flex items-center gap-2 text-xs">
                    <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: d.color }} />
                    <span className={`flex-1 truncate ${isDark ? "text-dark-text-secondary" : "text-dark-charcoal/80"}`}>{d.name}</span>
                    <span className={`font-semibold ${isDark ? "text-dark-text" : "text-dark-charcoal"}`}>{formatCount(d.value)}</span>
                    <span className={isDark ? "text-dark-text-muted" : "text-dark-charcoal/50"}>{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </article>

        <article className={cardClass}>
          <h2 className={titleClass}>Alerts by Area</h2>
          <p className={subtitleClass}>Most-alerted villages · {PERIOD_NOUN[period]}</p>
          <div className="mt-4 h-72 w-full min-w-0">
            {areaData.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2">
                <span className="text-3xl">🗺️</span>
                <p className={emptyTextClass}>No area activity in this period.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart data={areaData} layout="vertical" barCategoryGap="18%">
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: chartTextColor }} axisLine={false} tickLine={false} tickFormatter={(v: number) => formatCount(v)} label={{ value: "Alerts", position: "insideBottom", offset: -5, fontSize: 11, fill: chartTextColor }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: chartTextColor }} axisLine={false} tickLine={false} width={130} />
                  <Tooltip
                    cursor={{ fill: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.[0]) return null;
                      const v = Number(payload[0].value ?? 0);
                      return (
                        <ChartTooltipShell isDark={isDark} title={String(label)}>
                          <TooltipRow label="Total Alerts" value={v.toLocaleString()} swatchHex={AREA_BAR_TOP} />
                        </ChartTooltipShell>
                      );
                    }}
                  />
                  <Bar dataKey="total" name="Alerts" radius={[0, 6, 6, 0]}>
                    {areaData.map((entry, i) => (
                      <Cell key={entry.name} fill={areaBarColor(i, isDark)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </article>
      </div>

      {/* ─── Row 3: Node Severity Geo Map + Most Active Sensors ────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <article className={cardClass}>
          <h2 className={titleClass}>Node Severity Map</h2>
          <p className={subtitleClass}>Live GPS · bubble size = water level severity</p>
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
                <span className="text-3xl">📡</span>
                <p className={emptyTextClass}>No GPS-located nodes online.</p>
                <p className={`text-xs ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/50"}`}>
                  Nodes need a valid GPS fix to appear here.
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minHeight={200} minWidth={0}>
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis type="number" dataKey="x" name="Longitude" tick={{ fontSize: 10, fill: chartTextColor }} domain={["dataMin - 0.1", "dataMax + 0.1"]} tickFormatter={(v) => v.toFixed(2)} label={{ value: "Longitude (°E)", position: "insideBottom", offset: -5, fontSize: 11, fill: chartTextColor }} />
                  <YAxis type="number" dataKey="y" name="Latitude" tick={{ fontSize: 10, fill: chartTextColor }} domain={["dataMin - 0.05", "dataMax + 0.05"]} tickFormatter={(v) => v.toFixed(2)} label={{ value: "Latitude (°N)", angle: -90, position: "insideLeft", fontSize: 11, fill: chartTextColor }} />
                  <ZAxis type="number" dataKey="z" range={[60, 400]} />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null;
                      const p = payload[0].payload as { x: number; y: number; name: string; level: number };
                      return (
                        <ChartTooltipShell isDark={isDark} title={`Node ${p.name}`}>
                          <TooltipRow label="Severity" value={`${RISK_LABELS[p.level] ?? "—"} (${RISK_FT[p.level] ?? ""})`} swatchHex={levelColor(p.level)} />
                          <TooltipRow label="Latitude" value={`${p.y.toFixed(4)}°N`} />
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

        <article className={cardClass}>
          <h2 className={titleClass}>Most Active Sensors</h2>
          <p className={subtitleClass}>Readings received · {PERIOD_NOUN[period]}</p>
          <div className="mt-4 h-64 w-full min-w-0">
            {activeNodeData.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2">
                <span className="text-3xl">📈</span>
                <p className={emptyTextClass}>No reading activity in this period.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart data={activeNodeData} layout="vertical" barCategoryGap="18%">
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: chartTextColor }} axisLine={false} tickLine={false} tickFormatter={(v: number) => formatCount(v)} label={{ value: "Readings", position: "insideBottom", offset: -5, fontSize: 11, fill: chartTextColor }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: chartTextColor }} axisLine={false} tickLine={false} width={110} />
                  <Tooltip
                    cursor={{ fill: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null;
                      const p = payload[0].payload as { fullId: string; readings: number };
                      return (
                        <ChartTooltipShell isDark={isDark} title={`Node ${p.fullId}`}>
                          <TooltipRow label="Readings" value={p.readings.toLocaleString()} swatchHex="#1d4ed8" />
                        </ChartTooltipShell>
                      );
                    }}
                  />
                  <Bar dataKey="readings" name="Readings" radius={[0, 6, 6, 0]} fill="#1d4ed8" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}
