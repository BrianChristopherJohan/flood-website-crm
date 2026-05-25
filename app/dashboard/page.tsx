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
  const [aiData, setAiData] = useState<{ monthly?: {month:string;level:number}[]; weekly?: Record<string,number[]>; daily?: Record<string,number[]> } | null>(null);
  const [aiOnline, setAiOnline] = useState<boolean | null>(null);

  useEffect(() => {
    const year = new Date().getFullYear();
    const scale = riskScale === "hourly" ? "daily" : riskScale;
    const ac = new AbortController();
    fetch(`/api/ai-predict?scale=${scale}&year=${year}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((d: { success?: boolean; data?: unknown; daily_data?: unknown }) => {
        if (d.success) {
          setAiOnline(true);
          if (scale === "monthly") setAiData((prev) => ({ ...prev, monthly: d.data as { month: string; level: number }[] }));
          else if (scale === "weekly") setAiData((prev) => ({ ...prev, weekly: d.data as Record<string, number[]> }));
          else if (scale === "daily") setAiData((prev) => ({ ...prev, daily: d.daily_data as Record<string, number[]> }));
        } else {
          setAiOnline(false);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setAiOnline(false);
      });
    return () => ac.abort();
  }, [riskScale]);

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

  const liveRiskMap = { hourly: hourlyRiskData, daily: dailyRiskData, weekly: weeklyRiskData, monthly: monthlyRiskData };
  const aiRiskMap = { hourly: hourlyRiskData, daily: aiDailyRiskData, weekly: aiWeeklyRiskData, monthly: aiMonthlyRiskData };
  const rawRiskData = (aiSource && aiOnline ? aiRiskMap : liveRiskMap)[riskScale];
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
          helper={isLoading ? "Loading sensors…" : `${stats.activeNodes} online / ${stats.inactiveNodes} offline`}
          trend={{ label: "Live Data", direction: "up" }}
        />
        <OverviewCard
          title="Water Level Status"
          value={isLoading ? "..." : `${stats.criticalNodes + stats.warningNodes}`}
          helper={isLoading ? "Loading sensors…" : `${stats.criticalNodes} critical / ${stats.warningNodes} warning`}
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
          helper={isLoading ? "Loading sensors…" : `${stats.normalNodes} normal / ${stats.alertNodes} alert`}
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
              {isLoading ? "…" : `${nodes.length} nodes`}
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
          <div className="flex flex-wrap items-start justify-between gap-2">
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
                Online: {isLoading ? "…" : stats.activeNodes}
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
            className={`mt-4 overflow-hidden rounded-2xl border transition-colors ${
              isDark ? "border-dark-border" : "border-light-grey"
            }`}
          >
            {isLoading ? (
              <div
                className={`flex flex-col items-center justify-center gap-3 ${
                  isDark ? "bg-dark-bg" : "bg-very-light-grey"
                }`}
                style={{ height: 280 }}
              >
                <div
                  className={`h-8 w-8 animate-spin rounded-full border-4 ${
                    isDark
                      ? "border-dark-border border-t-primary-blue"
                      : "border-light-grey border-t-primary-blue"
                  }`}
                />
                <span
                  className={`text-xs font-medium ${
                    isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"
                  }`}
                >
                  Loading sensor map…
                </span>
              </div>
            ) : (
              <NodeMap nodes={nodes} height={280} zoom={12} />
            )}
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
              <span className="text-primary-red">{isLoading ? "…" : stats.criticalNodes}</span>
            </li>
            <li
              className={`rounded-2xl border px-3 py-2 transition-colors ${
                isDark
                  ? "border-dark-border bg-dark-bg"
                  : "border-light-grey bg-very-light-grey"
              }`}
            >
              Warning (2ft):{" "}
              <span className="text-status-warning-2">{isLoading ? "…" : stats.warningNodes}</span>
            </li>
            <li
              className={`rounded-2xl border px-3 py-2 transition-colors ${
                isDark
                  ? "border-dark-border bg-dark-bg"
                  : "border-light-grey bg-very-light-grey"
              }`}
            >
              Alert (1ft):{" "}
              <span className="text-status-warning-1">{isLoading ? "…" : stats.alertNodes}</span>
            </li>
            <li
              className={`rounded-2xl border px-3 py-2 transition-colors ${
                isDark
                  ? "border-dark-border bg-dark-bg"
                  : "border-light-grey bg-very-light-grey"
              }`}
            >
              Normal (0ft):{" "}
              <span className="text-status-green">{isLoading ? "…" : stats.normalNodes}</span>
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
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className={`text-lg font-semibold transition-colors ${isDark ? "text-dark-text" : "text-dark-charcoal"}`}>
                Flood Risk Analysis
              </h2>
              <p className={`text-xs uppercase tracking-wide transition-colors ${isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"}`}>
                {aiSource && aiOnline ? "XGBoost AI Prediction · flood-ai-prediction" : "Risk level over time · live sensor data"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* AI / Live source toggle */}
              <button
                type="button"
                onClick={() => setAiSource(v => !v)}
                title={aiOnline === false ? "AI service offline" : "Toggle AI predictions"}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-all ${
                  aiSource && aiOnline
                    ? "border-blue-400 bg-blue-400/10 text-blue-400"
                    : aiOnline === false
                    ? "cursor-not-allowed border-dark-border opacity-40"
                    : isDark ? "border-dark-border text-dark-text-muted hover:border-blue-400 hover:text-blue-400" : "border-light-grey text-dark-charcoal/60 hover:border-blue-400 hover:text-blue-400"
                }`}
                disabled={aiOnline === false}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                  <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                AI
              </button>
              <div className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${aiSource && aiOnline ? "bg-blue-400 animate-pulse" : "bg-status-green animate-pulse"}`} />
                <span className={`text-xs font-semibold ${aiSource && aiOnline ? "text-blue-400" : "text-status-green"}`}>
                  {aiSource && aiOnline ? "AI" : "Live"}
                </span>
              </div>
            </div>
          </div>

          {/* Controls: scale buttons + level filter */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
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
          <div className="mt-4 h-60 w-full min-w-0">
            <FloodRiskChart
              data={filteredRiskData}
              scale={riskScale}
              isDark={isDark}
              variant={riskVariant}
            />
          </div>

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
