"use client";

import { useAuth } from "@/lib/AuthContext";
import { authFetchJson } from "@/lib/authFetch";
import { useTheme } from "@/lib/ThemeContext";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

type Report = {
  id: string;
  userId: string;
  latitude: number;
  longitude: number;
  severity: string;
  description: string | null;
  photoUrl: string | null;
  status: string;
  submittedAt: string | null;
};

const STATUS_STYLES: Record<string, string> = {
  pending:  "bg-amber-100 text-amber-800",
  reviewed: "bg-blue-100 text-blue-800",
  resolved: "bg-green-100 text-green-800",
};

// BUG-H06: API contract uses "normal" not "info" — keep both keys so old
// records stored before this fix continue to render correctly.
const SEVERITY_STYLES: Record<string, string> = {
  normal:   "bg-blue-100 text-blue-800",
  info:     "bg-blue-100 text-blue-800",
  warning:  "bg-amber-100 text-amber-800",
  critical: "bg-red-100 text-red-800",
};

function formatTime(isoString: string | null): string {
  if (!isoString) return "—";
  return new Date(isoString).toLocaleString("en-MY", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function MapPinIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path fillRule="evenodd" d="M11.54 22.351l.07.06.06-.06 8.75-8.75a7 7 0 10-9.9 0l8.75 8.75zm2.68-11.68a3 3 0 10-4.24 0 4.242 4.242 0 014.24 0z" clipRule="evenodd" />
    </svg>
  );
}

export default function ReportsPage() {
  const { isDark } = useTheme();
  const { accessToken, silentRefresh } = useAuth();

  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setFetchError(null);
    try {
      const url = filterStatus ? `/api/reports?status=${encodeURIComponent(filterStatus)}` : "/api/reports";
      const data = await authFetchJson<Report[]>(url, accessToken, silentRefresh);
      setReports(Array.isArray(data) ? data : []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load reports.";
      setFetchError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [accessToken, silentRefresh, filterStatus]);

  useEffect(() => {
    void fetchReports();
  }, [fetchReports]);

  async function updateStatus(id: string, status: string) {
    if (!accessToken) return;
    setUpdatingId(id);
    try {
      const updated = await authFetchJson<Report>(
        `/api/reports/${id}/status`,
        accessToken,
        silentRefresh,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      setReports((prev) => prev.map((r) => (r.id === id ? updated : r)));
      toast.success(`Report marked as ${status}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update status.");
    } finally {
      setUpdatingId(null);
    }
  }

  const bg    = "bg-[var(--color-bg)] text-[var(--color-text)]";
  const card  = "bg-[var(--color-card)] border-[var(--color-border)]";
  const muted = "text-[var(--color-muted)]";
  const th    = "bg-[var(--color-pill-bg)] text-[var(--color-muted)] border-[var(--color-border)]";
  const sel   = "bg-[var(--color-input-bg)] border-[var(--color-border)] text-[var(--color-text)]";

  const pending  = reports.filter((r) => r.status === "pending").length;
  const resolved = reports.filter((r) => r.status === "resolved").length;

  return (
    <div className={`min-h-screen p-6 ${bg}`}>
      <div className="mx-auto max-w-7xl space-y-6">

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Incident Reports</h1>
            <p className={`mt-1 text-sm ${muted}`}>Review and action community flood incident submissions</p>
          </div>
          <div className="flex gap-3 text-center">
            <div className={`rounded-lg border px-4 py-2 ${card}`}>
              <p className="text-lg font-bold text-amber-500">{pending}</p>
              <p className={`text-xs ${muted}`}>Pending</p>
            </div>
            <div className={`rounded-lg border px-4 py-2 ${card}`}>
              <p className="text-lg font-bold text-green-500">{resolved}</p>
              <p className={`text-xs ${muted}`}>Resolved</p>
            </div>
          </div>
        </div>

        {fetchError && (
          <div
            role="alert"
            className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{fetchError}</span>
              <button
                type="button"
                onClick={() => void fetchReports()}
                className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="report-status-filter" className={`sr-only ${muted}`}>
            Filter by status
          </label>
          <select
            id="report-status-filter"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className={`rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 ${sel}`}
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="reviewed">Reviewed</option>
            <option value="resolved">Resolved</option>
          </select>
          <span className={`text-sm ${muted}`} aria-live="polite">
            {reports.length} report{reports.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className={`overflow-hidden rounded-xl border ${card}`}>
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 p-12">
              <div
                className="h-9 w-9 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"
                aria-hidden
              />
              <p className={`text-sm ${muted}`}>Loading reports…</p>
            </div>
          ) : reports.length === 0 ? (
            <div className={`flex flex-col items-center justify-center gap-2 p-12 text-center ${muted}`}>
              <MapPinIcon className="h-12 w-12 opacity-40" />
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">No reports match this filter.</p>
              <p className="max-w-md text-xs">Try clearing the status filter or check back after new community submissions.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={`border-b text-left text-xs uppercase tracking-wide ${th}`}>
                    <th className="px-4 py-3">Submitted</th>
                    <th className="px-4 py-3">Severity</th>
                    <th className="px-4 py-3">Location</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-inherit">
                  {reports.map((r) => (
                    <tr
                      key={r.id}
                      className="transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      <td className="whitespace-nowrap px-4 py-3">{formatTime(r.submittedAt)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${SEVERITY_STYLES[r.severity] ?? "bg-gray-100 text-gray-700"}`}
                        >
                          {r.severity}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <a
                          href={`https://maps.google.com/?q=${r.latitude},${r.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-orange-500 underline-offset-2 transition-colors hover:text-orange-600"
                        >
                          <MapPinIcon className="h-4 w-4 shrink-0" />
                          {Number(r.latitude).toFixed(4)}, {Number(r.longitude).toFixed(4)}
                          <span className="sr-only"> (opens in Google Maps)</span>
                        </a>
                      </td>
                      <td className={`max-w-xs truncate px-4 py-3 ${muted}`} title={r.description ?? ""}>
                        {r.description ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLES[r.status] ?? "bg-gray-100 text-gray-700"}`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {r.status !== "resolved" && (
                          <div className="flex gap-2">
                            {r.status === "pending" && (
                              <button
                                type="button"
                                disabled={updatingId === r.id}
                                onClick={() => void updateStatus(r.id, "reviewed")}
                                className="rounded-md bg-blue-500 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
                              >
                                {updatingId === r.id ? "…" : "Review"}
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={updatingId === r.id}
                              onClick={() => void updateStatus(r.id, "resolved")}
                              className="rounded-md bg-green-500 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-green-600 disabled:opacity-50"
                            >
                              {updatingId === r.id ? "…" : "Resolve"}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
