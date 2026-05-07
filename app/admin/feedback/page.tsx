"use client";

/**
 * Admin viewer for UAT survey responses. Mounts at /admin/feedback in the
 * CRM. Shows a paginated table with role/source filters, expandable rows
 * for the full answer JSON, and a "Download CSV" button that streams the
 * Java backend's export straight to the user's machine for Excel.
 */

import { useAuth } from "@/lib/AuthContext";
import { authFetchJson } from "@/lib/authFetch";
import { useTheme } from "@/lib/ThemeContext";
import { usePermissions } from "@/lib/hooks/usePermissions";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

type SurveyResponse = {
  id: string;
  userId: string | null;
  displayName: string | null;
  role: string;
  source: string;
  satisfactionScore: number | null;
  recommendScore: number | null;
  businessFit: string | null;
  answers: Record<string, unknown>;
  submittedAt: string;
  appVersion: string | null;
};

type SpringPage = {
  content: SurveyResponse[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
  last: boolean;
};

const ROLE_OPTIONS = [
  { value: "",      label: "All audiences" },
  { value: "user",  label: "End-user" },
  { value: "admin", label: "Admin / staff" },
  { value: "both",  label: "Both" },
];

const SOURCE_OPTIONS = [
  { value: "",          label: "Both apps" },
  { value: "community", label: "Community" },
  { value: "crm",       label: "CRM" },
];

const FIT_TONE: Record<string, string> = {
  meets:   "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  partial: "bg-amber-500/15  text-amber-400  border-amber-500/30",
  misses:  "bg-red-500/15    text-red-400    border-red-500/30",
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" });
}

function CsvIcon(p: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...p}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  );
}

export default function AdminFeedbackPage() {
  const { isDark } = useTheme();
  const { accessToken, silentRefresh } = useAuth();
  const { can } = usePermissions();

  const allowed = can("dashboard.view"); // Admin-only check is enforced server-side too.

  const [data, setData] = useState<SpringPage | null>(null);
  const [page, setPage] = useState(0);
  const [size] = useState(25);
  const [filterRole, setFilterRole] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const fetchPage = useCallback(
    async (p: number) => {
      if (!accessToken) return;
      setLoading(true);
      try {
        const qs = new URLSearchParams();
        qs.set("page", String(p));
        qs.set("size", String(size));
        if (filterRole)   qs.set("role", filterRole);
        if (filterSource) qs.set("source", filterSource);
        const res = await authFetchJson<SpringPage>(
          `/api/admin/surveys/uat?${qs.toString()}`,
          accessToken,
          silentRefresh,
        );
        setData(res);
        setPage(res.number);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load survey responses");
      } finally {
        setLoading(false);
      }
    },
    [accessToken, silentRefresh, size, filterRole, filterSource],
  );

  useEffect(() => {
    void fetchPage(0);
  }, [fetchPage]);

  async function handleDownload() {
    if (!accessToken) return;
    setExporting(true);
    try {
      const res = await fetch("/api/admin/surveys/uat/export", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      const a = document.createElement("a");
      a.href = url;
      a.download = `floodwatch-uat-surveys-${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("CSV downloaded — open it in Excel.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setExporting(false);
    }
  }

  const summary = useMemo(() => {
    if (!data?.content?.length) return null;
    const rows = data.content;
    const avgSat = rows.reduce((a, r) => a + (r.satisfactionScore ?? 0), 0) / rows.length;
    const avgRec = rows.reduce((a, r) => a + (r.recommendScore ?? 0), 0) / rows.length;
    const meets  = rows.filter((r) => r.businessFit === "meets").length;
    return {
      avgSat: avgSat.toFixed(1),
      avgRec: avgRec.toFixed(1),
      meetsPct: Math.round((meets / rows.length) * 100),
    };
  }, [data]);

  if (!allowed) {
    return (
      <section className="rounded-2xl border p-6"
        style={{ background: "var(--color-card)", borderColor: "var(--color-border)" }}>
        <h1 className="text-lg font-bold" style={{ color: "var(--color-text)" }}>UAT survey responses</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          You do not have permission to view UAT survey responses.
        </p>
      </section>
    );
  }

  const card = `rounded-2xl border ${isDark ? "bg-dark-card border-dark-border" : "bg-pure-white border-light-grey"}`;
  const muted = "var(--color-muted)";
  const text  = "var(--color-text)";

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: text }}>UAT Survey Responses</h1>
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
            Submissions from the community website and the CRM. Filter by audience or app, then download the CSV for Excel.
          </p>
        </div>
        <button
          type="button"
          onClick={handleDownload}
          disabled={exporting}
          className="inline-flex items-center gap-2 rounded-xl bg-primary-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          <CsvIcon className="h-4 w-4" />
          {exporting ? "Exporting…" : "Download CSV"}
        </button>
      </header>

      {/* Summary KPIs (this page only — quick eyeballing) */}
      {summary && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className={`${card} p-4`}>
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: muted }}>Avg. satisfaction</p>
            <p className="mt-2 text-2xl font-bold" style={{ color: text }}>{summary.avgSat} <span className="text-sm" style={{ color: muted }}>/ 5</span></p>
          </div>
          <div className={`${card} p-4`}>
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: muted }}>Avg. recommend (NPS)</p>
            <p className="mt-2 text-2xl font-bold" style={{ color: text }}>{summary.avgRec} <span className="text-sm" style={{ color: muted }}>/ 10</span></p>
          </div>
          <div className={`${card} p-4`}>
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: muted }}>Meets requirement</p>
            <p className="mt-2 text-2xl font-bold" style={{ color: text }}>{summary.meetsPct}<span className="text-sm" style={{ color: muted }}>%</span></p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-blue"
          style={{ background: "var(--color-input-bg, var(--color-card))", borderColor: "var(--color-border)", color: text }}
        >
          {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value)}
          className="rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-blue"
          style={{ background: "var(--color-input-bg, var(--color-card))", borderColor: "var(--color-border)", color: text }}
        >
          {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {data && (
          <span className="text-xs" style={{ color: muted }}>
            {data.totalElements} responses · page {data.number + 1} of {Math.max(1, data.totalPages)}
          </span>
        )}
      </div>

      {/* Table */}
      <div className={`${card} overflow-x-auto`}>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: "var(--color-border)", color: muted }}>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">When</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Who</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Role</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Source</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Sat.</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">NPS</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Fits</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center" style={{ color: muted }}>Loading…</td>
              </tr>
            ) : !data || data.content.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center" style={{ color: muted }}>
                  No survey responses match these filters.
                </td>
              </tr>
            ) : (
              data.content.map((r) => {
                const isOpen = expanded === r.id;
                return (
                  <>
                    <tr key={r.id} className="border-b" style={{ borderColor: "var(--color-border)" }}>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums" style={{ color: text }}>
                        {formatWhen(r.submittedAt)}
                      </td>
                      <td className="px-4 py-3" style={{ color: text }}>
                        {r.displayName ?? <span style={{ color: muted }}>(anonymous)</span>}
                      </td>
                      <td className="px-4 py-3 capitalize" style={{ color: text }}>{r.role}</td>
                      <td className="px-4 py-3 capitalize" style={{ color: text }}>{r.source}</td>
                      <td className="px-4 py-3 tabular-nums" style={{ color: text }}>
                        {r.satisfactionScore != null ? `${r.satisfactionScore} / 5` : "—"}
                      </td>
                      <td className="px-4 py-3 tabular-nums" style={{ color: text }}>
                        {r.recommendScore != null ? `${r.recommendScore} / 10` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {r.businessFit ? (
                          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${FIT_TONE[r.businessFit] ?? ""}`}>
                            {r.businessFit}
                          </span>
                        ) : <span style={{ color: muted }}>—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : r.id)}
                          className="rounded-lg px-2 py-1 text-xs font-semibold text-primary-blue hover:bg-primary-blue/10"
                        >
                          {isOpen ? "Hide" : "View"}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${r.id}-detail`} style={{ background: "var(--color-input-bg, var(--color-card))" }}>
                        <td colSpan={8} className="px-4 py-4">
                          <pre
                            className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border p-3 text-xs leading-relaxed"
                            style={{
                              borderColor: "var(--color-border)",
                              background: "var(--color-bg)",
                              color: "var(--color-text-secondary)",
                              fontFamily: "ui-monospace, SF Mono, Consolas, monospace",
                            }}
                          >
{JSON.stringify(r.answers, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pager */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => fetchPage(Math.max(0, page - 1))}
            disabled={page <= 0 || loading}
            className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-40"
            style={{ borderColor: "var(--color-border)", color: text }}
          >
            ← Previous
          </button>
          <span className="text-xs tabular-nums" style={{ color: muted }}>
            Page {page + 1} of {data.totalPages}
          </span>
          <button
            type="button"
            onClick={() => fetchPage(page + 1)}
            disabled={loading || page >= data.totalPages - 1}
            className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-40"
            style={{ borderColor: "var(--color-border)", color: text }}
          >
            Next →
          </button>
        </div>
      )}
    </section>
  );
}
