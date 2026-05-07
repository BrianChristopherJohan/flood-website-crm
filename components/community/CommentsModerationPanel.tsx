"use client";

/**
 * Comments moderation table — extracted from the old /community/comments page
 * so it can render inside the Community Management page as a 3rd tab next to
 * Posts and Groups.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";

import { useAuth } from "@/lib/AuthContext";
import { usePermissions } from "@/lib/hooks/usePermissions";
import { useTheme } from "@/lib/ThemeContext";
import { authFetch, authFetchJson } from "@/lib/authFetch";

const COMMUNITY_SITE =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_COMMUNITY_URL
    ? process.env.NEXT_PUBLIC_COMMUNITY_URL.replace(/\/$/, "")
    : "";

type AdminCommentRow = {
  id: string;
  postId: string;
  postTitle: string;
  parentId: string | null;
  authorId: string;
  authorName: string;
  content: string;
  score: number;
  deleted: boolean;
  createdAt: string;
  updatedAt: string | null;
};

type SpringPage = {
  content: AdminCommentRow[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
  last: boolean;
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function CommentsModerationPanel() {
  const { isDark } = useTheme();
  const { can } = usePermissions();
  const { accessToken, silentRefresh } = useAuth();
  const allowed = can("community.comments.moderate");

  const [rows, setRows] = useState<AdminCommentRow[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    async (p: number) => {
      if (!accessToken || !allowed) return;
      setLoading(true);
      try {
        const res = await authFetch(
          `/api/community/comments?page=${p}&size=20`,
          accessToken,
          silentRefresh,
        );
        if (!res.ok) {
          setError("Failed to load comments");
          return;
        }
        const data: SpringPage = await res.json();
        setRows(data.content);
        setTotalPages(data.totalPages);
        setPage(data.number);
        setError(null);
      } catch {
        setError("Failed to load comments");
      } finally {
        setLoading(false);
      }
    },
    [accessToken, silentRefresh, allowed],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.postTitle.toLowerCase().includes(q) ||
        r.authorName.toLowerCase().includes(q) ||
        r.content.toLowerCase().includes(q),
    );
  }, [rows, filter]);

  async function moderate(id: string, action: "hide" | "restore" | "delete") {
    if (!accessToken) return;
    setBusyId(id);
    try {
      await authFetchJson<unknown>(
        `/api/community/comments/${id}`,
        accessToken,
        silentRefresh,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      toast.success(
        action === "hide" ? "Comment hidden" : action === "restore" ? "Restored" : "Removed",
      );
      await load(page);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  if (!allowed) {
    return (
      <div className={`rounded-2xl border p-6 ${isDark ? "border-dark-border bg-dark-card" : "border-light-grey bg-pure-white"}`}>
        <p className="text-sm text-dark-charcoal/80 dark:text-dark-text-secondary">
          You do not have permission to moderate community comments.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-dark-charcoal/70 dark:text-dark-text-secondary">
          Hide, restore, or hard-delete comments on community posts.
        </p>
        <input
          type="search"
          placeholder="Filter this page (title, author, text)…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full sm:max-w-xs rounded-xl border border-light-grey bg-pure-white px-3 py-2 text-sm dark:border-dark-border dark:bg-dark-bg dark:text-white"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      <div
        className={`overflow-x-auto rounded-2xl border shadow-sm ${
          isDark ? "border-dark-border bg-dark-card" : "border-light-grey bg-pure-white"
        }`}
      >
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr
              className={
                isDark
                  ? "border-b border-dark-border text-dark-text-secondary"
                  : "border-b border-light-grey text-dark-charcoal/60"
              }
            >
              <th className="px-3 py-2 font-semibold">Post</th>
              <th className="px-3 py-2 font-semibold">Author</th>
              <th className="px-3 py-2 font-semibold">Comment</th>
              <th className="px-3 py-2 font-semibold">Score</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">When</th>
              <th className="px-3 py-2 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-dark-charcoal/60 dark:text-dark-text-secondary">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-dark-charcoal/60 dark:text-dark-text-secondary">
                  No comments on this page.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr
                  key={r.id}
                  className={
                    isDark ? "border-b border-dark-border/80" : "border-b border-light-grey/80"
                  }
                >
                  <td className="px-3 py-2 align-top">
                    {COMMUNITY_SITE ? (
                      <Link
                        href={`${COMMUNITY_SITE}/post/${r.postId}#comment-${r.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-primary-blue hover:underline line-clamp-2"
                      >
                        {r.postTitle || "(untitled)"}
                      </Link>
                    ) : (
                      <span className="line-clamp-2">{r.postTitle || "(untitled)"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-xs">{r.authorName}</td>
                  <td className="px-3 py-2 align-top max-w-md">
                    <span className="line-clamp-3 whitespace-pre-wrap">{r.content}</span>
                  </td>
                  <td className="px-3 py-2 align-top">{r.score}</td>
                  <td className="px-3 py-2 align-top">
                    {r.deleted ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                        Hidden / deleted
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">
                        Visible
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-dark-charcoal/70 dark:text-dark-text-secondary">
                    {timeAgo(r.createdAt)}
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      {!r.deleted && (
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => void moderate(r.id, "hide")}
                          className="rounded-lg bg-amber-600/90 px-2 py-1 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                        >
                          Hide
                        </button>
                      )}
                      {r.deleted && (
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => void moderate(r.id, "restore")}
                          className="rounded-lg bg-primary-blue px-2 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                        >
                          Restore
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => void moderate(r.id, "delete")}
                        className="rounded-lg bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={page <= 0 || loading}
          onClick={() => void load(page - 1)}
          className="rounded-xl border border-light-grey px-3 py-1.5 text-sm font-semibold disabled:opacity-40 dark:border-dark-border"
        >
          Previous
        </button>
        <span className="text-xs text-dark-charcoal/60 dark:text-dark-text-secondary">
          Page {page + 1} of {Math.max(1, totalPages)}
        </span>
        <button
          type="button"
          disabled={loading || page >= totalPages - 1}
          onClick={() => void load(page + 1)}
          className="rounded-xl border border-light-grey px-3 py-1.5 text-sm font-semibold disabled:opacity-40 dark:border-dark-border"
        >
          Next
        </button>
      </div>
    </div>
  );
}
