"use client";

/**
 * IoTEventProvider — live FloodWatch IoT data for the CRM operator app.
 *
 * Mirrors the community provider in spirit but tuned for operators:
 *
 *   • Visible toast cap raised to 8 (community is 5) — operators want
 *     every active alert visible until acknowledged.
 *   • Auto-dismiss TTL roughly doubled — operator response windows
 *     are minutes, not seconds.
 *   • "View live sensor" link points at /map (not /flood-map).
 *   • Header says "ACTIVE SENSOR ALERTS" rather than "ACTIVE FLOOD
 *     ALERTS" — operators see battery and GPS-moved alerts too.
 *
 * Subscribes to /api/sse/iot-events (CRLF-tolerant proxy) and fans
 * events to consumers via `useIoTStream()`. Mounted once in
 * app/layout.tsx so the operator dock surfaces on every page.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import type {
  AlertSeverity,
  IoTAlert,
  IoTStreamEvent,
  StreamAlert,
  StreamFloodLevel,
  StreamHeartbeat,
  StreamNodeStatus,
  StreamWeatherUpdate,
  WaterLevel,
  WeatherSnapshot,
  NodeStatus,
} from "@/lib/floodwatch/types";
import { severityForLevel } from "@/lib/floodwatch/types";

// ── Public context surface ────────────────────────────────────────

type IoTStreamContextValue = {
  /** Connection state of the underlying SSE pipe. */
  status: "connecting" | "open" | "error" | "offline";
  /** Newest-first list of recently observed alerts (max 50). */
  alerts: IoTAlert[];
  /**
   * Subset of `alerts` (by `alertKey()`) that passed the rate-limiter
   * and should appear as toast pop-ups in the dock. Alerts in `alerts`
   * but NOT in this set are dropdown-only (silently logged for the
   * bell history without flashing the operator).
   */
  poppedKeys: Set<string>;
  /** Set of alert keys the user has dismissed from the dock. They
   *  remain in `alerts` so the bell dropdown can still show them. */
  dismissedDockKeys: Set<string>;
  /** Live water level keyed by node_id (most recent flood_level event). */
  floodLevels: Map<string, WaterLevel>;
  /** Online/offline per node, from `node_online` and `node_offline`. */
  nodeStatus: Map<string, NodeStatus>;
  /** Most recent weather snapshot keyed by village_id. */
  weather: Map<string, WeatherSnapshot>;
  /** Heartbeat seq per node — pages can re-render when a node pings. */
  heartbeatSeq: Map<string, number>;
  /** Subscribe to every event for ad-hoc map / chart updates. */
  subscribe: (cb: (event: IoTStreamEvent) => void) => () => void;
  /** Trigger the browser Notification permission prompt. */
  enableDesktopAlerts: () => void;
  desktopAlertsEnabled: boolean;
};

const IoTStreamContext = createContext<IoTStreamContextValue | null>(null);

export function useIoTStream(): IoTStreamContextValue {
  const ctx = useContext(IoTStreamContext);
  if (!ctx) {
    throw new Error("useIoTStream must be used within IoTEventProvider");
  }
  return ctx;
}

// ── Severity → palette ─────────────────────────────────────────────

function severityTone(sev: AlertSeverity) {
  switch (sev) {
    case "critical":
      return {
        bar: "bg-[#dc2626]",
        accent: "#dc2626",
        copy: "text-white",
        surface: "linear-gradient(135deg, #450a0a, #7f1d1d 70%, #b91c1c)",
        glow: "shadow-[0_0_24px_-4px_rgba(220,38,38,0.55)]",
        pulse: true,
      };
    case "warning":
      return {
        bar: "bg-[#f97316]",
        accent: "#f97316",
        copy: "text-white",
        surface: "linear-gradient(135deg, #431407, #9a3412 70%, #ea580c)",
        glow: "shadow-[0_0_18px_-4px_rgba(249,115,22,0.45)]",
        pulse: false,
      };
    default:
      return {
        bar: "bg-[#f59e0b]",
        accent: "#f59e0b",
        copy: "text-white",
        surface: "linear-gradient(135deg, #451a03, #92400e 70%, #d97706)",
        glow: "shadow-[0_0_14px_-4px_rgba(245,158,11,0.4)]",
        pulse: false,
      };
  }
}

function severityLabel(sev: AlertSeverity): string {
  if (sev === "critical") return "Critical";
  if (sev === "warning") return "Warning";
  return "Watch";
}

function timeSince(iso: string | null | undefined): string {
  if (!iso) return "just now";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return "just now";
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function alertTitle(alert: IoTAlert): string {
  switch (alert.alert_type) {
    case "flood":
      return "Flood alert";
    case "water_fall":
      return "Water level dropped";
    case "battery_low":
      return "Sensor battery low";
    case "battery_critical":
      return "Sensor battery critical";
    case "gps_moved":
      return "Sensor moved";
    default:
      return "Sensor alert";
  }
}

export function alertBody(alert: IoTAlert): string {
  if (alert.alert_type === "flood" || alert.alert_type === "water_fall") {
    const level = alert.level ?? alert.water_level ?? 0;
    return `Water level ${level}/3 at sensor ${alert.node_id}`;
  }
  if (alert.alert_type === "battery_critical" || alert.alert_type === "battery_low") {
    const v = alert.battery_voltage?.toFixed(2) ?? "?";
    return `Battery ${v}V at sensor ${alert.node_id}`;
  }
  if (alert.alert_type === "gps_moved") {
    const d = alert.dist_m ? `${Math.round(alert.dist_m)} m` : "moved";
    return `Sensor ${alert.node_id} ${d} from install`;
  }
  return `Sensor ${alert.node_id} reported an event`;
}

/** Severity bucket the dock uses to colour and prioritise an alert. */
export function alertSeverity(alert: IoTAlert): AlertSeverity {
  if (alert.alert_type === "flood") {
    return severityForLevel(alert.level ?? alert.water_level);
  }
  if (alert.alert_type === "battery_critical") return "warning";
  if (alert.alert_type === "battery_low") return "watch";
  if (alert.alert_type === "gps_moved") return "watch";
  if (alert.alert_type === "water_fall") return "watch";
  return "watch";
}

/**
 * Stable identity for a single alert event. The IoT API can emit
 * multiple alert types from the same reading at the same exact
 * timestamp (e.g. a level transition firing both `flood` and
 * `water_fall`), so we MUST include `alert_type` — `node_id-timestamp`
 * alone collides and trips React's duplicate-key warning.
 */
export function alertKey(alert: IoTAlert): string {
  return `${alert.node_id}-${alert.alert_type ?? "alert"}-${alert.timestamp}`;
}

// ── Audio chime + Notification helpers ────────────────────────────

function playEewChime(severity: AlertSeverity) {
  if (typeof window === "undefined") return;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const beep = (freq: number, start: number, duration: number, gain: number) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, now + start);
      g.gain.linearRampToValueAtTime(gain, now + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      osc.connect(g).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + duration + 0.05);
    };
    beep(880, 0, 0.18, 0.18);
    beep(660, 0.22, 0.22, 0.18);
    if (severity === "critical") beep(990, 0.5, 0.28, 0.22);
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1500);
  } catch {
    /* audio is best-effort */
  }
}

function showDesktopNotification(alert: IoTAlert) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (typeof document !== "undefined" && document.visibilityState === "visible") return;
  try {
    const sev = alertSeverity(alert);
    const n = new Notification(
      `${alertTitle(alert)} — ${severityLabel(sev)}`,
      {
        body: alertBody(alert),
        tag: `iot-alert-${alertKey(alert)}`,
        requireInteraction: sev === "critical",
        silent: false,
      },
    );
    n.onclick = () => {
      window.focus();
      window.location.href = `/map?focus=${encodeURIComponent(alert.node_id)}`;
      n.close();
    };
  } catch {
    /* permission revoked between check and call — ignore */
  }
}

// ── The dock itself ───────────────────────────────────────────────

/**
 * Operator-tuned auto-dismiss windows. Roughly 2x the community
 * timings — operators need a longer attention window to triage,
 * dispatch, and acknowledge. Hover still freezes the timer.
 */
const AUTO_DISMISS_MS: Record<AlertSeverity, number> = {
  critical: 120_000, // 2 min
  warning: 60_000, // 1 min
  watch: 24_000, // 24 s
};

/** Max toasts the dock renders in collapsed mode; rest behind "+N more". */
const DOCK_VISIBLE_CAP = 3;

function IoTSensorAlertDock({
  alerts,
  onDismiss,
  onDismissAll,
}: {
  alerts: IoTAlert[];
  onDismiss: (key: string) => void;
  onDismissAll: () => void;
}) {
  const [, force] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (alerts.length === 0) return;
    const t = window.setInterval(() => force((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, [alerts.length]);

  // Auto-dismiss with hover-pause. The community dock uses the same
  // pattern — see plan addendum for the rationale.
  useEffect(() => {
    if (alerts.length === 0) return;
    const timers: number[] = [];
    for (const a of alerts) {
      const key = alertKey(a);
      if (hovered.has(key)) continue;
      const sev = alertSeverity(a);
      const ttl = AUTO_DISMISS_MS[sev];
      const elapsed = Date.now() - new Date(a.timestamp).getTime();
      const remaining = Math.max(0, ttl - elapsed);
      timers.push(window.setTimeout(() => onDismiss(key), remaining));
    }
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [alerts, hovered, onDismiss]);

  if (alerts.length === 0) return null;

  const highestSeverity: AlertSeverity = alerts.some(
    (a) => alertSeverity(a) === "critical",
  )
    ? "critical"
    : alerts.some((a) => alertSeverity(a) === "warning")
      ? "warning"
      : "watch";

  const headerTone = severityTone(highestSeverity);
  const visible = expanded ? alerts : alerts.slice(0, DOCK_VISIBLE_CAP);
  const hiddenCount = Math.max(0, alerts.length - DOCK_VISIBLE_CAP);

  return (
    <div
      className="fixed top-20 right-4 z-[200] flex max-h-[85vh] w-[min(100vw-2rem,24rem)] flex-col gap-2 overflow-y-auto pointer-events-none"
      aria-live="assertive"
      aria-relevant="additions"
    >
      <div
        className="pointer-events-auto flex items-center justify-between rounded-xl border px-3 py-2 backdrop-blur-md"
        style={{
          background: "rgba(15, 23, 42, 0.85)",
          borderColor: headerTone.accent,
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${headerTone.pulse ? "animate-pulse" : ""}`}
            style={{ background: headerTone.accent, boxShadow: `0 0 8px ${headerTone.accent}` }}
            aria-hidden
          />
          <span className="text-xs font-bold uppercase tracking-wider text-white">
            {alerts.length} ACTIVE SENSOR {alerts.length === 1 ? "ALERT" : "ALERTS"}
          </span>
        </div>
        <button
          type="button"
          onClick={onDismissAll}
          className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-white/80 transition hover:bg-white/10"
        >
          Dismiss all
        </button>
      </div>

      {visible.map((a) => {
        const sev = alertSeverity(a);
        const tone = severityTone(sev);
        const key = alertKey(a);
        return (
          <div
            key={key}
            role="alert"
            className={`pointer-events-auto relative overflow-hidden rounded-xl border-2 ${tone.copy} ${tone.glow} ${tone.pulse ? "animate-iot-flood-pulse" : ""}`}
            style={{
              background: tone.surface,
              borderColor: tone.accent,
              animation: "iot-toast-in 280ms cubic-bezier(0.16,1,0.3,1)",
            }}
            onMouseEnter={() =>
              setHovered((h) => {
                if (h.has(key)) return h;
                const next = new Set(h);
                next.add(key);
                return next;
              })
            }
            onMouseLeave={() =>
              setHovered((h) => {
                if (!h.has(key)) return h;
                const next = new Set(h);
                next.delete(key);
                return next;
              })
            }
          >
            <div className={`absolute left-0 top-0 h-full w-1 ${tone.bar}`} aria-hidden />
            <div className="flex items-start justify-between gap-2 px-4 py-3 pl-5">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-widest opacity-95">
                  {alertTitle(a)} · {severityLabel(sev)}
                </p>
                <p className="mt-1 text-sm font-semibold leading-snug">
                  {a.village_id ? `${a.village_id} · ` : ""}
                  {a.node_id}
                </p>
                <p className="mt-0.5 text-xs opacity-95">{alertBody(a)}</p>
                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] opacity-90">
                  <Link
                    href={`/map?focus=${encodeURIComponent(a.node_id)}`}
                    className="font-bold underline underline-offset-2 hover:opacity-100"
                  >
                    Open in map →
                  </Link>
                  <span className="tabular-nums">{timeSince(a.timestamp)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onDismiss(key)}
                className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold opacity-80 hover:bg-black/25 hover:opacity-100"
                aria-label="Dismiss alert"
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="pointer-events-auto self-end rounded-full border border-white/20 bg-slate-900/85 px-3 py-1 text-[11px] font-semibold text-white/90 shadow backdrop-blur-md transition hover:bg-slate-800/90"
        >
          {expanded ? "Show fewer" : `+${hiddenCount} more alert${hiddenCount === 1 ? "" : "s"}`}
        </button>
      )}

      <style jsx>{`
        @keyframes iot-toast-in {
          0% { opacity: 0; transform: translateX(24px) scale(0.96); }
          100% { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes iot-flood-pulse {
          0%, 100% { box-shadow: 0 0 24px -4px rgba(220, 38, 38, 0.55); }
          50%      { box-shadow: 0 0 36px -2px rgba(220, 38, 38, 0.85); }
        }
        :global(.animate-iot-flood-pulse) {
          animation: iot-toast-in 280ms cubic-bezier(0.16,1,0.3,1), iot-flood-pulse 1.6s ease-in-out infinite 280ms;
        }
      `}</style>
    </div>
  );
}

// ── Provider ──────────────────────────────────────────────────────

/** Cap the number of alerts retained for the dock + dropdown history. */
const MAX_RETAINED_ALERTS = 50;
/** Dedupe alerts arriving within this many ms of each other for the same node. */
const ALERT_DEDUPE_WINDOW_MS = 1000;

// ── Pop-up rate limiter ────────────────────────────────────────────
//
// The 1 s dedupe above only suppresses *duplicate* re-emissions of the
// SAME alert event. Once the IoT API starts emitting genuine new alerts
// at a high rate (e.g. a flood event tripping every node in a village
// within seconds, or the simulator running hot), the dock can pile up
// 20+ toasts and the chime fires non-stop. That's noise, not signal.
//
// The rate limiter has two stages:
//
//   1. Per-key cooldown — the same `{node_id}|{alert_type}` pair only
//      pops a toast once every COOLDOWN_PER_KEY_MS. Repeat events for
//      that key during the cooldown still go into the dropdown history
//      (so the operator log isn't lossy), but no chime, no dock toast,
//      no desktop notification.
//
//   2. Global rolling window — at most GLOBAL_POPUP_RATE_MAX toasts
//      can pop across ALL keys in any GLOBAL_POPUP_WINDOW_MS window.
//      The (RATE_MAX+1)-th alert in-window falls back to history-only.
//
// CRITICAL severity bypasses the global rate cap (operators can't
// afford to miss a critical) but still respects the per-key cooldown.
const POPUP_COOLDOWN_PER_KEY_MS = 30_000;
const GLOBAL_POPUP_RATE_MAX = 5;
const GLOBAL_POPUP_WINDOW_MS = 10_000;

export function IoTEventProvider({ children }: { children: ReactNode }) {
  // Forward `?dataset=` from the URL into the SSE stream so the page's
  // visible zones and the live event stream always agree on which
  // dataset they're showing.
  const searchParams = useSearchParams();
  const datasetParam = searchParams?.get("dataset");
  const dataset =
    datasetParam === "sample" || datasetParam === "all"
      ? datasetParam
      : null;

  const subscribers = useRef(new Set<(event: IoTStreamEvent) => void>());
  const [alerts, setAlerts] = useState<IoTAlert[]>([]);
  const [floodLevels, setFloodLevels] = useState<Map<string, WaterLevel>>(new Map());
  const [nodeStatusMap, setNodeStatusMap] = useState<Map<string, NodeStatus>>(new Map());
  const [weatherMap, setWeatherMap] = useState<Map<string, WeatherSnapshot>>(new Map());
  const [heartbeatSeq, setHeartbeatSeq] = useState<Map<string, number>>(new Map());
  const [status, setStatus] = useState<IoTStreamContextValue["status"]>("connecting");
  const [desktopAlertsEnabled, setDesktopAlertsEnabled] = useState(false);
  const lastAlertKey = useRef<Map<string, number>>(new Map());
  // Permanently-dismissed alerts (user clicked X / dismiss-all on the
  // dock). They drop out of the toast view but stay in `alerts` so the
  // bell dropdown can still show them as historical entries.
  const [dismissedDockKeys, setDismissedDockKeys] = useState<Set<string>>(
    () => new Set(),
  );
  // Alerts that passed the rate-limiter and are eligible to pop as a
  // toast. The dock filters `alerts` through this set so silenced-by-
  // rate-limit events stay out of the dock without losing dropdown
  // visibility.
  const [poppedKeys, setPoppedKeys] = useState<Set<string>>(() => new Set());
  // Rolling-window timestamps of recent popups for the global rate cap.
  // Plain ref — no need to re-render when this changes.
  const recentPopAt = useRef<number[]>([]);
  // Per-key last-popped time for the cooldown.
  const lastPopPerKey = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    setDesktopAlertsEnabled(Notification.permission === "granted");
  }, []);

  const enableDesktopAlerts = useCallback(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted") {
      setDesktopAlertsEnabled(true);
      return;
    }
    if (Notification.permission === "denied") return;
    void Notification.requestPermission().then((p) => {
      setDesktopAlertsEnabled(p === "granted");
    });
  }, []);

  const subscribe = useCallback(
    (cb: (event: IoTStreamEvent) => void) => {
      subscribers.current.add(cb);
      return () => {
        subscribers.current.delete(cb);
      };
    },
    [],
  );

  // Dismissing an alert removes it from the dock view but keeps it
  // in `alerts` so the bell dropdown can still show the historical
  // entry. This is the behaviour an operator expects: "I've seen
  // this, get it off my screen" — not "delete the record".
  const dismissAlert = useCallback((key: string) => {
    setDismissedDockKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const dismissAll = useCallback(() => {
    setDismissedDockKeys((prev) => {
      const next = new Set(prev);
      // Snapshot current alerts so we don't dismiss into-flight events.
      // The dock filters on this set so iterating the live `alerts`
      // here is safe (no removal from the underlying list).
      for (const a of alerts) next.add(alertKey(a));
      return next;
    });
  }, [alerts]);

  // ── SSE connection effect ────────────────────────────────────────
  useEffect(() => {
    let closed = false;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let retryMs = 2000;
    const maxRetryMs = 60_000;

    const dispatch = (event: IoTStreamEvent) => {
      subscribers.current.forEach((fn) => {
        try {
          fn(event);
        } catch {
          /* subscriber fault — isolate */
        }
      });
    };

    const handlers: { [K in IoTStreamEvent["type"]]: (data: unknown) => void } = {
      heartbeat: (data) => {
        const ev = data as StreamHeartbeat;
        if (!ev?.node_id) return;
        dispatch(ev);
        setHeartbeatSeq((prev) => {
          const next = new Map(prev);
          next.set(ev.node_id, (next.get(ev.node_id) ?? 0) + 1);
          return next;
        });
        setNodeStatusMap((prev) => {
          if (prev.get(ev.node_id) === "online") return prev;
          const next = new Map(prev);
          next.set(ev.node_id, "online");
          return next;
        });
      },
      flood_level: (data) => {
        const ev = data as StreamFloodLevel;
        if (!ev?.node_id) return;
        dispatch(ev);
        setFloodLevels((prev) => {
          const next = new Map(prev);
          next.set(ev.node_id, ev.water_level);
          return next;
        });
      },
      alert: (data) => {
        const ev = data as StreamAlert;
        if (!ev?.node_id) return;
        dispatch(ev);
        const dedupeKey = `${ev.node_id}|${ev.alert_type}`;
        const now = Date.now();
        // Stage 1 — strict dedupe (same key within 1 s = same event echo).
        const lastSeen = lastAlertKey.current.get(dedupeKey) ?? 0;
        if (now - lastSeen < ALERT_DEDUPE_WINDOW_MS) return;
        lastAlertKey.current.set(dedupeKey, now);

        const alert: IoTAlert = {
          node_id: ev.node_id,
          village_id: ev.village_id,
          alert_type: ev.alert_type,
          timestamp: ev.timestamp,
          level: ev.level,
          water_level: ev.level,
          float_bits: ev.float_bits,
          battery_voltage: ev.bat,
          gps_fix: ev.gps_fix,
          lat: ev.lat ?? null,
          lng: ev.lng ?? null,
          dist_m: ev.dist_m,
          home_lat: ev.home_lat,
          home_lng: ev.home_lng,
          rssi: ev.rssi,
        };
        const thisAlertKey = alertKey(alert);

        // Always append to history so the bell dropdown is lossless.
        setAlerts((prev) => [alert, ...prev].slice(0, MAX_RETAINED_ALERTS));

        // Stage 2 — pop-up rate limiter. Per-key cooldown + global
        // rolling-window cap. CRITICAL bypasses the global cap but
        // still respects the per-key cooldown so we don't double-pop
        // the same node.
        const sev = alertSeverity(alert);
        const lastPop = lastPopPerKey.current.get(dedupeKey) ?? 0;
        const cooldownPassed = now - lastPop >= POPUP_COOLDOWN_PER_KEY_MS;

        recentPopAt.current = recentPopAt.current.filter(
          (t) => now - t < GLOBAL_POPUP_WINDOW_MS,
        );
        const globalAllowed =
          sev === "critical" ||
          recentPopAt.current.length < GLOBAL_POPUP_RATE_MAX;

        if (cooldownPassed && globalAllowed) {
          lastPopPerKey.current.set(dedupeKey, now);
          recentPopAt.current.push(now);
          setPoppedKeys((prev) => {
            if (prev.has(thisAlertKey)) return prev;
            const next = new Set(prev);
            next.add(thisAlertKey);
            return next;
          });
          if (sev !== "watch") {
            playEewChime(sev);
            showDesktopNotification(alert);
          }
        }
      },
      node_online: (data) => {
        const ev = data as StreamNodeStatus;
        if (!ev?.node_id) return;
        dispatch(ev);
        setNodeStatusMap((prev) => {
          const next = new Map(prev);
          next.set(ev.node_id, "online");
          return next;
        });
      },
      node_offline: (data) => {
        const ev = data as StreamNodeStatus;
        if (!ev?.node_id) return;
        dispatch(ev);
        setNodeStatusMap((prev) => {
          const next = new Map(prev);
          next.set(ev.node_id, "offline");
          return next;
        });
      },
      weather_update: (data) => {
        const ev = data as StreamWeatherUpdate;
        if (!ev?.village_id) return;
        dispatch(ev);
        setWeatherMap((prev) => {
          const next = new Map(prev);
          next.set(ev.village_id, {
            village_id: ev.village_id,
            timestamp: ev.timestamp,
            temperature_c: ev.temperature_c,
            humidity_pct: ev.humidity_pct,
            precipitation_mm: ev.precipitation_mm,
            rain_mm: ev.rain_mm,
            weather_code: ev.weather_code,
            cloud_cover_pct: ev.cloud_cover_pct,
            wind_speed_kmh: ev.wind_speed_kmh,
            wind_gusts_kmh: ev.wind_gusts_kmh,
            is_day: ev.is_day,
          });
          return next;
        });
      },
      node_announce: (data) => {
        // The CRM proxy forwards announce events (unlike community).
        // Operators may want to log calibration moments; just dispatch
        // to subscribers without doing anything else here.
        dispatch(data as IoTStreamEvent);
      },
    };

    const makeEventListener = (type: IoTStreamEvent["type"]) =>
      (e: MessageEvent) => {
        try {
          const parsed = JSON.parse(e.data as string);
          handlers[type](parsed);
        } catch {
          /* ignore malformed */
        }
      };

    const connect = () => {
      if (closed) return;
      setStatus("connecting");
      es?.close();
      const url = dataset
        ? `/api/sse/iot-events?dataset=${encodeURIComponent(dataset)}`
        : "/api/sse/iot-events";
      es = new EventSource(url);

      const listeners: Array<[IoTStreamEvent["type"], (e: MessageEvent) => void]> = [
        ["heartbeat", makeEventListener("heartbeat")],
        ["flood_level", makeEventListener("flood_level")],
        ["alert", makeEventListener("alert")],
        ["node_online", makeEventListener("node_online")],
        ["node_offline", makeEventListener("node_offline")],
        ["weather_update", makeEventListener("weather_update")],
        ["node_announce", makeEventListener("node_announce")],
      ];
      listeners.forEach(([type, fn]) => es!.addEventListener(type, fn));

      es.addEventListener("backend-unavailable", () => {
        es?.close();
        es = null;
        if (closed) return;
        setStatus("offline");
        if (reconnectTimer) clearTimeout(reconnectTimer);
        retryMs = maxRetryMs;
        reconnectTimer = setTimeout(connect, retryMs);
      });

      es.onopen = () => {
        setStatus("open");
        retryMs = 2000;
      };

      es.onerror = () => {
        es?.close();
        es = null;
        if (closed) return;
        setStatus("error");
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, retryMs);
        retryMs = Math.min(maxRetryMs, Math.round(retryMs * 1.7));
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [dataset]);

  const value = useMemo<IoTStreamContextValue>(
    () => ({
      status,
      alerts,
      poppedKeys,
      dismissedDockKeys,
      floodLevels,
      nodeStatus: nodeStatusMap,
      weather: weatherMap,
      heartbeatSeq,
      subscribe,
      enableDesktopAlerts,
      desktopAlertsEnabled,
    }),
    [
      status,
      alerts,
      poppedKeys,
      dismissedDockKeys,
      floodLevels,
      nodeStatusMap,
      weatherMap,
      heartbeatSeq,
      subscribe,
      enableDesktopAlerts,
      desktopAlertsEnabled,
    ],
  );

  // Dock view: only rate-limit-passed alerts that the operator hasn't
  // dismissed yet. The full `alerts` array stays available to the
  // bell dropdown via the context.
  const dockAlerts = useMemo(
    () =>
      alerts.filter(
        (a) =>
          poppedKeys.has(alertKey(a)) && !dismissedDockKeys.has(alertKey(a)),
      ),
    [alerts, poppedKeys, dismissedDockKeys],
  );

  return (
    <IoTStreamContext.Provider value={value}>
      {children}
      <IoTSensorAlertDock
        alerts={dockAlerts}
        onDismiss={dismissAlert}
        onDismissAll={dismissAll}
      />
    </IoTStreamContext.Provider>
  );
}
