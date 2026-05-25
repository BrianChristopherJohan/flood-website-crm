"use client";

/**
 * Content reports moderation queue — extracted from the old
 * /community/content-reports page so it can render as a tab inside
 * the Community Management page next to Posts / Groups / Comments.
 *
 * Each row shows the reported post/comment snippet, the reporter, the
 * reason + free-text details, and quick actions:
 *   • Mark reviewed   → status="reviewed"
 *   • Dismiss         → status="dismissed"
 *   • Delete content  → DELETE the underlying post/comment + status="actioned"
 *
 * Pending reports float to the top regardless of insertion order so
 * triage stays focused.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { useTheme } from "@/lib/ThemeContext";
import { useAuth } from "@/lib/AuthContext";

// Call a same-origin BFF route using the httpOnly auth cookie, retrying
// once via silentRefresh() on 401/403. Decoupled from the in-memory
// accessToken (null on the cookie-based session), which previously gated
// fetchReports() shut so the Reports tab stayed stuck on "Loading…".
async function cookieFetchJson<T>(
  url: string,
  silentRefresh: () => Promise<string | null>,
  options: RequestInit = {},
): Promise<T> {
  const doFetch = () =>
    fetch(url, { ...options, cache: "no-store", credentials: "include" });
  let res = await doFetch();
  if (res.status === 401 || res.status === 403) {
    await silentRefresh();
    res = await doFetch();
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body?.error ?? body?.message ?? message;
    } catch {
      /* keep generic */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return undefined as T;
  return res.json() as Promise<T>;
}

type ContentReport = {
  id: string;
  targetType: "POST" | "COMMENT" | string;
  targetId: string;
  targetSnippet: string;
  targetAuthorId: string | null;
  targetAuthorName: string;
  parentPostId: string | null;
  parentPostTitle: string;
  reporterId: string;
  reporterName: string;
  reason: string;
  details: string | null;
  status: "pending" | "reviewed" | "actioned" | "dismissed" | string;
  resolvedById: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  createdAt: string | null;
};

type Page<T> = {
  content: T[];
  totalElements?: number;
  totalPages?: number;
  number?: number;
  size?: number;
};

const REASON_LABEL: Record<string, string> = {
  spam: "Spam / scam",
  harassment: "Harassment / hate",
  misinformation: "Misinformation",
  "off-topic": "Off-topic",
  other: "Other",
};

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  reviewed: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  actioned: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  dismissed: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-MY", { dateStyle: "short", timeStyle: "short" });
}

type Props = {
  /** Optional callback so the parent tab strip can show a pending count badge. */
  onPendingCountChange?: (n: number) => void;
};

export default function ReportsModerationPanel({ onPendingCountChange }: Props) {
  const { isDark } = useTheme();
  const { silentRefresh } = useAuth();
  const [items, setItems] = useState<ContentReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const data = await cookieFetchJson<Page<ContentReport>>(
        "/api/community/content-reports?page=0&size=50",
        silentRefresh,
      );
      const list = data.content ?? [];
      setItems(list);
      onPendingCountChange?.(list.filter((r) => r.status === "pending").length);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load reports.");
    } finally {
      setLoading(false);
    }
  }, [silentRefresh, onPendingCountChange]);

  useEffect(() => {
    void fetchReports();
  }, [fetchReports]);

  async function setStatus(id: string, status: string) {
    setBusyId(id);
    try {
      const updated = await cookieFetchJson<ContentReport>(
        `/api/community/content-reports/${id}`,
        silentRefresh,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      setItems((prev) => {
        const next = prev.map((r) => (r.id === id ? updated : r));
        onPendingCountChange?.(next.filter((r) => r.status === "pending").length);
        return next;
      });
      toast.success(`Marked ${status}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update status.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteContentAndAction(report: ContentReport) {
    if (!confirm(`Permanently remove this ${report.targetType.toLowerCase()}?`)) return;
    setBusyId(report.id);
    try {
      if (report.targetType === "POST") {
        await cookieFetchJson(
          `/api/community/admin/posts/${report.targetId}`,
          silentRefresh,
          { method: "DELETE" },
        );
      } else if (report.targetType === "COMMENT") {
        await cookieFetchJson(
          `/api/community/comments/${report.targetId}`,
          silentRefresh,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete" }),
          },
        );
      }
      const updated = await cookieFetchJson<ContentReport>(
        `/api/community/content-reports/${report.id}`,
        silentRefresh,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "actioned" }),
        },
      );
      setItems((prev) => {
        const next = prev.map((r) => (r.id === report.id ? updated : r));
        onPendingCountChange?.(next.filter((r) => r.status === "pending").length);
        return next;
      });
      toast.success("Removed content + closed report");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't action this report.");
    } finally {
      setBusyId(null);
    }
  }

  // Pending first, then by createdAt desc — keeps triage focused.
  const sorted = [...items].sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (a.status !== "pending" && b.status === "pending") return 1;
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });

  const pendingCount = items.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">Content reports</h2>
          <p className="mt-0.5 text-xs opacity-70">
            Posts and comments flagged by community members for review.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${STATUS_BADGE.pending}`}>
              {pendingCount} pending
            </span>
          )}
          <button
            type="button"
            onClick={() => void fetchReports()}
            className="rounded-full border border-light-grey dark:border-dark-border px-3 py-1.5 text-xs font-semibold hover:bg-light-blue/30 dark:hover:bg-dark-border/50"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm opacity-60">
          Loading reports…
        </div>
      ) : sorted.length === 0 ? (
        <div
          className={`rounded-2xl border ${
            isDark ? "border-dark-border bg-dark-card" : "border-light-grey bg-pure-white"
          } p-12 text-center`}
        >
          <p className="text-sm font-semibold">No reports yet</p>
          <p className="mt-1 text-xs opacity-70">
            When users flag a post or comment it will show up here.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {sorted.map((r) => (
            <li
              key={r.id}
              className={`rounded-2xl border p-4 ${
                isDark ? "border-dark-border bg-dark-card" : "border-light-grey bg-pure-white"
              }`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={`rounded-full px-2 py-0.5 font-bold ${
                    STATUS_BADGE[r.status] ?? STATUS_BADGE.pending
                  }`}
                >
                  {r.status}
                </span>
                <span className="rounded-full bg-light-blue/40 dark:bg-blue-900/30 px-2 py-0.5 font-semibold text-primary-blue">
                  {r.targetType}
                </span>
                <span className="rounded-full border border-light-grey dark:border-dark-border px-2 py-0.5 font-semibold opacity-70">
                  {REASON_LABEL[r.reason] ?? r.reason}
                </span>
                <span className="opacity-60">{formatTime(r.createdAt)}</span>
                {r.parentPostId && (
                  <Link
                    href={`/community?post=${r.parentPostId}`}
                    className="ml-auto text-primary-blue font-semibold hover:underline"
                  >
                    Open post →
                  </Link>
                )}
              </div>

              <p className="mb-2 text-sm">
                <span className="font-semibold">{r.targetAuthorName}</span>
                <span className="opacity-60"> on </span>
                <span className="font-semibold">{r.parentPostTitle}</span>
              </p>

              <blockquote
                className={`mb-2 rounded-xl border-l-2 px-3 py-2 text-sm ${
                  isDark
                    ? "border-dark-border bg-dark-bg/40"
                    : "border-light-grey bg-very-light-grey/60"
                }`}
              >
                {r.targetSnippet || "(content unavailable)"}
              </blockquote>

              {r.details && (
                <p className="mb-3 text-xs opacity-80">
                  <span className="font-semibold">Reporter note: </span>
                  {r.details}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                <span className="opacity-70">
                  Reported by <span className="font-semibold">{r.reporterName}</span>
                  {r.resolvedByName && r.resolvedAt && (
                    <>
                      {" "}
                      · resolved by <span className="font-semibold">{r.resolvedByName}</span> at{" "}
                      {formatTime(r.resolvedAt)}
                    </>
                  )}
                </span>

                <div className="flex flex-wrap gap-2">
                  {r.status !== "reviewed" && (
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => void setStatus(r.id, "reviewed")}
                      className="rounded-full border border-light-grey dark:border-dark-border px-3 py-1 font-semibold hover:bg-light-blue/30 dark:hover:bg-dark-border/50 disabled:opacity-50"
                    >
                      Mark reviewed
                    </button>
                  )}
                  {r.status !== "dismissed" && (
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => void setStatus(r.id, "dismissed")}
                      className="rounded-full border border-light-grey dark:border-dark-border px-3 py-1 font-semibold hover:bg-light-blue/30 dark:hover:bg-dark-border/50 disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                  )}
                  {r.status !== "actioned" && (
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => void deleteContentAndAction(r)}
                      className="rounded-full bg-red-500 px-3 py-1 font-bold text-white hover:bg-red-600 disabled:opacity-50"
                    >
                      Delete content
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
