"use client";

/**
 * <NotificationBell /> — CRM bell + dropdown.
 *
 * Same UX as the Community version, but auth is header-based (the CRM
 * keeps its access token in localStorage rather than an HttpOnly
 * cookie), so EventSource isn't usable here. We poll
 *   GET /api/notifications/unread-count   every 20 s
 * and refetch the list when the count changes upward — that gives
 * operators the bell + sound experience without the SSE plumbing.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { authFetch } from "@/lib/authFetch";

type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  severity: "info" | "warning" | "critical" | string;
  readAt: string | null;
  createdAt: string;
};

type Page<T> = {
  content: T[];
};

const POLL_MS = 20_000;

export default function NotificationBell() {
  const { accessToken, silentRefresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const userInteracted = useRef(false);
  const audioCtx = useRef<AudioContext | null>(null);
  const lastCount = useRef(0);

  // Capture user-interaction so the bell sound is allowed to play.
  useEffect(() => {
    const flag = () => { userInteracted.current = true; };
    window.addEventListener("pointerdown", flag, { once: true });
    window.addEventListener("keydown",     flag, { once: true });
    return () => {
      window.removeEventListener("pointerdown", flag);
      window.removeEventListener("keydown",     flag);
    };
  }, []);

  const playBell = useCallback(() => {
    if (!userInteracted.current) return;
    if (typeof window === "undefined") return;
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      if (!audioCtx.current) audioCtx.current = new Ctor();
      const ctx = audioCtx.current;
      if (ctx.state === "suspended") void ctx.resume();
      const tone = (freq: number, start: number, dur: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur + 0.05);
      };
      tone(880, 0,    0.18);
      tone(659, 0.13, 0.22);
    } catch { /* best-effort */ }
  }, []);

  // ── List + count ──────────────────────────────────────────────────────────
  const fetchUnread = useCallback(async (): Promise<number> => {
    if (!accessToken) return 0;
    try {
      const res = await authFetch("/api/notifications/unread-count", accessToken, silentRefresh);
      if (!res.ok) return 0;
      const { count } = (await res.json()) as { count: number };
      return count ?? 0;
    } catch { return 0; }
  }, [accessToken, silentRefresh]);

  const fetchList = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await authFetch("/api/notifications?page=0&size=20", accessToken, silentRefresh);
      if (!res.ok) {
        if (res.status === 401) { setItems([]); setUnread(0); }
        return;
      }
      const data = (await res.json()) as Page<Notification>;
      const list = data.content ?? [];
      setItems(list);
      setUnread(list.filter(n => !n.readAt).length);
    } finally {
      setLoading(false);
    }
  }, [accessToken, silentRefresh]);

  // Initial load
  useEffect(() => {
    if (!accessToken) return;
    void fetchList().then(async () => {
      lastCount.current = await fetchUnread();
    });
  }, [accessToken, fetchList, fetchUnread]);

  // Poll for new alerts
  useEffect(() => {
    if (!accessToken) return;
    const id = window.setInterval(async () => {
      const count = await fetchUnread();
      if (count > lastCount.current) {
        playBell();
        await fetchList();
      }
      lastCount.current = count;
      setUnread(count);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [accessToken, fetchUnread, fetchList, playBell]);

  // Outside click + Esc
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markRead(id: string) {
    if (!accessToken) return;
    setItems(prev => prev.map(n => n.id === id ? { ...n, readAt: new Date().toISOString() } : n));
    setUnread(c => Math.max(0, c - 1));
    try {
      await authFetch(`/api/notifications/${encodeURIComponent(id)}/read`, accessToken, silentRefresh, { method: "POST" });
    } catch { /* optimistic */ }
  }

  async function markAllRead() {
    if (!accessToken) return;
    setItems(prev => prev.map(n => n.readAt ? n : { ...n, readAt: new Date().toISOString() }));
    setUnread(0);
    try {
      await authFetch("/api/notifications/read-all", accessToken, silentRefresh, { method: "POST" });
    } catch { /* optimistic */ }
  }

  if (!accessToken) return null;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void fetchList();
        }}
        aria-label={`Notifications${unread > 0 ? ` — ${unread} unread` : ""}`}
        aria-expanded={open}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-slate-200 hover:bg-white/10 transition"
      >
        <BellIcon className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-12 z-50 w-[360px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-xl text-slate-200"
        >
          <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
            <p className="text-sm font-bold">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={() => void markAllRead()} className="text-[11px] font-semibold text-blue-300 hover:text-blue-200">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {loading && items.length === 0 && (
              <p className="px-4 py-6 text-center text-xs text-slate-400">Loading…</p>
            )}
            {!loading && items.length === 0 && (
              <div className="px-4 py-8 text-center">
                <BellIcon className="mx-auto mb-2 h-7 w-7 text-slate-600" />
                <p className="text-xs text-slate-400">You&apos;re all caught up.</p>
              </div>
            )}
            <ul>
              {items.map(n => (
                <li key={n.id}>
                  <Row notification={n} onClick={() => void markRead(n.id)} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ notification, onClick }: { notification: Notification; onClick: () => void }) {
  const tone =
    notification.severity === "critical" ? { bg: "rgba(220, 38, 38, 0.12)", dot: "#dc2626" } :
    notification.severity === "warning"  ? { bg: "rgba(249, 115, 22, 0.12)", dot: "#f97316" } :
                                           { bg: "rgba(56, 139, 253, 0.10)", dot: "#388bfd" };
  const isUnread = !notification.readAt;

  return (
    <button type="button" onClick={onClick} className="block w-full text-left">
      <div
        className="flex gap-3 px-4 py-3 transition hover:bg-white/5"
        style={isUnread ? { background: tone.bg } : undefined}
      >
        <span
          className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full"
          style={{
            backgroundColor: isUnread ? tone.dot : "transparent",
            border: isUnread ? "none" : "1px solid #334155",
          }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-slate-100">{notification.title}</p>
          {notification.body && (
            <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-400">{notification.body}</p>
          )}
          <p className="mt-1 text-[10px] text-slate-500">{formatRelative(notification.createdAt)}</p>
        </div>
      </div>
    </button>
  );
}

function BellIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function formatRelative(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
