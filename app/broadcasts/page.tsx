"use client";

import { useAuth } from "@/lib/AuthContext";
import { authFetchJson } from "@/lib/authFetch";
import { usePermissions } from "@/lib/hooks/usePermissions";
import { useTheme } from "@/lib/ThemeContext";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

type Broadcast = {
  id: string;
  title: string;
  body: string;
  targetZone: string;
  severity: string;
  sentBy: string | null;
  sentAt: string | null;
  recipientCount: number;
};

type ZoneRow = { id: string; name: string; riskLevel: string };

function SendIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2 .01 7z" />
    </svg>
  );
}

const SEVERITY_STYLES: Record<string, string> = {
  normal:   "bg-blue-100 text-blue-800",
  info:     "bg-blue-100 text-blue-800",
  warning:  "bg-amber-100 text-amber-800",
  critical: "bg-red-100 text-red-800",
};

function relativeTime(isoString: string | null): string {
  if (!isoString) return "—";
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const EMPTY_FORM = {
  title: "",
  body: "",
  targetZone: "all",
  severity: "normal",
};

export default function BroadcastsPage() {
  const { isDark } = useTheme();
  const { accessToken, silentRefresh, user } = useAuth();
  const { can } = usePermissions();

  const canSendBroadcasts = can("alerts.manage");

  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [zones, setZones] = useState<ZoneRow[]>([]);

  const [form, setForm] = useState(EMPTY_FORM);

  const fetchBroadcasts = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    setListError(null);
    setLoading(true);
    try {
      const data = await authFetchJson<Broadcast[]>("/api/broadcasts", accessToken, silentRefresh);
      setBroadcasts(Array.isArray(data) ? data : []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not load broadcasts.";
      setListError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [accessToken, silentRefresh]);

  useEffect(() => {
    void fetchBroadcasts();
  }, [fetchBroadcasts]);

  useEffect(() => {
    if (!accessToken) return;
    void (async () => {
      try {
        const data = await authFetchJson<ZoneRow[] | unknown>("/api/zones", accessToken, silentRefresh);
        if (Array.isArray(data)) setZones(data);
      } catch {
        /* optional: free-text zone still works */
      }
    })();
  }, [accessToken, silentRefresh]);

  function handlePreviewSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.body.trim()) {
      setFormError("Title and message are required.");
      return;
    }
    setFormError(null);
    setConfirmOpen(true);
  }

  async function handleConfirmedSend() {
    if (!accessToken) return;
    setConfirmOpen(false);
    setSending(true);
    setFormError(null);
    try {
      await authFetchJson<unknown>("/api/broadcasts", accessToken, silentRefresh, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      toast.success("Broadcast sent successfully.");
      setForm(EMPTY_FORM);
      await fetchBroadcasts();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to send broadcast.";
      setFormError(msg);
      toast.error(msg);
    } finally {
      setSending(false);
    }
  }

  const bg    = "bg-[var(--color-bg)] text-[var(--color-text)]";
  const card  = "bg-[var(--color-card)] border-[var(--color-border)]";
  const input = "bg-[var(--color-input-bg)] border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-muted)]";
  const label = "text-[var(--color-text)]";
  const muted = "text-[var(--color-muted)]";

  return (
    <div className={`min-h-screen p-6 ${bg}`}>
      <div className="mx-auto max-w-5xl space-y-6">

        <div>
          <h1 className="text-2xl font-bold">Emergency Broadcasts</h1>
          <p className={`mt-1 text-sm ${muted}`}>
            Send push notifications to registered mobile users (requires alerts.manage).
          </p>
        </div>

        {canSendBroadcasts && (
          <div className={`rounded-xl border p-6 ${card}`}>
            <h2 className="mb-4 text-lg font-semibold">Send New Broadcast</h2>
            <form onSubmit={handlePreviewSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="bc-title" className={`mb-1 block text-sm font-medium ${label}`}>
                    Title
                  </label>
                  <input
                    id="bc-title"
                    required
                    maxLength={255}
                    placeholder="Flood warning — Kuching area"
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 ${input}`}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="bc-severity" className={`mb-1 block text-sm font-medium ${label}`}>
                      Severity
                    </label>
                    <select
                      id="bc-severity"
                      value={form.severity}
                      onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}
                      className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 ${input}`}
                    >
                      <option value="normal">Normal</option>
                      <option value="warning">Warning</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="bc-zone" className={`mb-1 block text-sm font-medium ${label}`}>
                      Target Zone
                    </label>
                    <select
                      id="bc-zone"
                      value={form.targetZone}
                      onChange={(e) => setForm((f) => ({ ...f, targetZone: e.target.value }))}
                      className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 ${input}`}
                    >
                      <option value="all">All Zones</option>
                      {zones.map((z) => (
                        <option key={z.id} value={z.name}>
                          {z.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <div>
                <label htmlFor="bc-body" className={`mb-1 block text-sm font-medium ${label}`}>
                  Message <span className={`font-normal ${muted}`}>({form.body.length}/160)</span>
                </label>
                <textarea
                  id="bc-body"
                  required
                  maxLength={160}
                  rows={3}
                  placeholder="Residents in low-lying areas should move to higher ground immediately."
                  value={form.body}
                  onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                  className={`w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 ${input}`}
                />
              </div>

              {formError && <p className="text-sm text-red-500">{formError}</p>}

              <button
                type="submit"
                disabled={sending || !form.title.trim() || !form.body.trim()}
                className="flex items-center gap-2 rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
              >
                <SendIcon className="h-4 w-4" />
                {sending ? "Sending…" : "Review & Send"}
              </button>
            </form>
          </div>
        )}

        <div className={`rounded-xl border ${card}`}>
          <div className="border-b border-inherit p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="font-semibold">Broadcast History</h2>
              {listError && (
                <button
                  type="button"
                  onClick={() => void fetchBroadcasts()}
                  className="text-sm font-medium text-orange-500 hover:text-orange-600"
                >
                  Retry load
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 p-12">
              <div
                className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"
                aria-hidden
              />
              <p className={`text-sm ${muted}`}>Loading broadcasts…</p>
            </div>
          ) : broadcasts.length === 0 ? (
            <p className={`p-8 text-center text-sm ${muted}`}>No broadcasts sent yet.</p>
          ) : (
            <div className="divide-y divide-inherit">
              {broadcasts.map((b) => (
                <div key={b.id} className="flex items-start gap-4 p-4">
                  <span
                    className={`mt-0.5 rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${SEVERITY_STYLES[b.severity] ?? "bg-gray-100 text-gray-700"}`}
                  >
                    {b.severity}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{b.title}</p>
                    <p className={`mt-0.5 text-sm ${muted}`}>{b.body}</p>
                    <p className={`mt-1 text-xs ${muted}`}>
                      Zone: {b.targetZone} · {b.recipientCount} recipients · {relativeTime(b.sentAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-broadcast-title"
            className="w-full max-w-md rounded-2xl p-6 shadow-xl bg-[var(--color-card)] text-[var(--color-text)]"
          >
            <h2 id="confirm-broadcast-title" className="mb-1 text-lg font-bold">
              Confirm Broadcast
            </h2>
            <p className={`mb-5 text-sm ${muted}`}>
              Review the details below. Once sent, this broadcast is delivered to users in the target zone and{" "}
              <strong>cannot be recalled</strong>.
            </p>

            <div className="mb-6 space-y-3 rounded-xl border p-4 border-[var(--color-border)] bg-[var(--color-pill-bg)]">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                    SEVERITY_STYLES[form.severity] ?? "bg-gray-100 text-gray-700"
                  }`}
                >
                  {form.severity}
                </span>
                <span className="text-sm font-semibold">{form.title}</span>
              </div>
              <p className={`text-sm leading-relaxed ${muted}`}>{form.body}</p>
              <div className="flex flex-wrap items-center gap-4 border-t pt-2 text-xs border-[var(--color-border)] text-[var(--color-muted)]">
                <span>
                  Zone: <strong>{form.targetZone || "all"}</strong>
                </span>
                <span>
                  Sent by: <strong>{user?.email ?? "—"}</strong>
                </span>
              </div>
            </div>

            <div
              className={`mb-5 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${
                isDark ? "border-amber-700/50 bg-amber-900/30 text-amber-300" : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              <SendIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Emergency broadcasts are irreversible. Verify accuracy before sending.</span>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="flex-1 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-hover)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmedSend()}
                disabled={sending}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
              >
                <SendIcon className="h-4 w-4" />
                {sending ? "Sending…" : "Confirm Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
