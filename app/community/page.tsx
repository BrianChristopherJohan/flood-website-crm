"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTheme } from "@/lib/ThemeContext";
import { useAuth } from "@/lib/AuthContext";
import { authFetch } from "@/lib/authFetch";
import { usePermissions } from "@/lib/hooks/usePermissions";
import CommentsModerationPanel from "@/components/community/CommentsModerationPanel";
import ReportsModerationPanel from "@/components/community/ReportsModerationPanel";

// ── Types ──────────────────────────────────────────────────────────────────────

type Post = {
  id: string; authorName: string; groupName?: string; groupSlug?: string;
  title: string; content: string; imageUrl?: string;
  likesCount: number; commentsCount: number; createdAt: string;
};

type Group = {
  id: string; slug: string; name: string; description?: string;
  iconLetter: string; iconColor: string; membersCount: number; postsCount: number;
};

type PagedPosts = { content: Post[]; last: boolean; number: number };

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now"; if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Component ──────────────────────────────────────────────────────────────────

function CommunityManagementInner() {
  const { isDark } = useTheme();
  const { accessToken, silentRefresh } = useAuth();
  const { can } = usePermissions();
  const canModerateComments = can("community.comments.moderate");

  // Read ?tab=… from the URL so the redirect from /community/comments
  // (kept for backward compatibility) lands on the right tab.
  const params = useSearchParams();
  const initialTab = (() => {
    const t = params.get("tab");
    if (t === "groups" || t === "comments" || t === "reports") return t;
    return "posts";
  })();
  const [tab, setTab] = useState<"posts" | "groups" | "comments" | "reports">(initialTab);
  const [pendingReports, setPendingReports] = useState(0);

  // Group edit (Update) state — completes CRUD on Groups
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [editGroupForm, setEditGroupForm] = useState({ name: "", description: "", iconColor: "#1d4ed8" });
  const [editGroupError, setEditGroupError] = useState<string | null>(null);
  const [savingEditGroup, setSavingEditGroup] = useState(false);

  // Posts state
  const [posts, setPosts] = useState<Post[]>([]);
  const [postsPage, setPostsPage] = useState(0);
  const [postsHasMore, setPostsHasMore] = useState(true);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postSearch, setPostSearch] = useState("");
  const [postSort, setPostSort] = useState<"new" | "top">("new");
  const [deletingPost, setDeletingPost] = useState<string | null>(null);

  // Groups state
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pendingDeletePost, setPendingDeletePost] = useState<string | null>(null);
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState<string | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupForm, setGroupForm] = useState({ slug: "", name: "", description: "", iconColor: "#1d4ed8" });
  const [groupFormError, setGroupFormError] = useState<string | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);
  const isFirstFetch = useRef(true);

  // ── Fetch posts ──────────────────────────────────────────────────────────────

  // The post + group feeds are PUBLIC reads (the community backend serves
  // them anonymously), so they are intentionally decoupled from accessToken.
  // Gating them behind the session token caused the spinner to hang forever
  // whenever accessToken was briefly null / not-yet-hydrated, since the
  // loading flag is only cleared once the fetch runs. A plain same-origin
  // fetch still carries the CRM session cookie for the BFF route's own gate.
  const fetchPosts = useCallback(async (page: number, sort: string, replace: boolean) => {
    if (replace) setPostsLoading(true);
    try {
      const res = await fetch(`/api/community/posts?page=${page}&size=20&sort=${sort}`, { cache: "no-store" });
      if (!res.ok) {
        setFetchError("Failed to load posts. Please try again.");
        return;
      }
      const data: PagedPosts = await res.json();
      setPosts(prev => replace ? data.content : [...prev, ...data.content]);
      setPostsHasMore(!data.last);
      setPostsPage(page);
      setFetchError(null);
    } catch {
      setFetchError("Failed to load posts. Please try again.");
    } finally { setPostsLoading(false); }
  }, []);

  // ── Fetch groups ─────────────────────────────────────────────────────────────

  const fetchGroups = useCallback(async () => {
    setGroupsLoading(true);
    try {
      const res = await fetch("/api/community/groups", { cache: "no-store" });
      if (!res.ok) {
        setFetchError("Failed to load groups. Please try again.");
        return;
      }
      setGroups(await res.json());
      setFetchError(null);
    } catch {
      setFetchError("Failed to load groups. Please try again.");
    } finally { setGroupsLoading(false); }
  }, []);

  useEffect(() => {
    if (isFirstFetch.current) { fetchGroups(); isFirstFetch.current = false; }
    fetchPosts(0, postSort, true);
  }, [postSort, fetchPosts, fetchGroups]);

  // ── Actions ───────────────────────────────────────────────────────────────────

  async function confirmDeletePost(id: string) {
    setPendingDeletePost(id);
  }

  async function executeDeletePost(id: string) {
    setPendingDeletePost(null);
    setDeletingPost(id);
    const res = await authFetch(`/api/community/posts/${id}`, accessToken!, silentRefresh, { method: "DELETE" });
    if (res.ok || res.status === 204) setPosts(p => p.filter(x => x.id !== id));
    setDeletingPost(null);
  }

  async function confirmDeleteGroup(id: string) {
    setPendingDeleteGroup(id);
  }

  async function executeDeleteGroup(id: string) {
    setPendingDeleteGroup(null);
    setDeletingGroup(id);
    const res = await authFetch(`/api/community/groups/${id}`, accessToken!, silentRefresh, { method: "DELETE" });
    if (res.ok || res.status === 204) setGroups(g => g.filter(x => x.id !== id));
    setDeletingGroup(null);
  }

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    setGroupFormError(null);
    if (!groupForm.slug || !groupForm.name) { setGroupFormError("Slug and name are required"); return; }
    if (!/^[a-z0-9-]+$/.test(groupForm.slug)) { setGroupFormError("Slug: lowercase letters, numbers, hyphens only"); return; }
    setSavingGroup(true);
    try {
      const res = await authFetch("/api/community/groups", accessToken!, silentRefresh, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(groupForm),
      });
      const data = await res.json();
      if (!res.ok) { setGroupFormError(data.error || "Failed"); setSavingGroup(false); return; }
      setGroups(g => [data, ...g]);
      setGroupForm({ slug: "", name: "", description: "", iconColor: "#1d4ed8" });
      setShowCreateGroup(false);
    } finally { setSavingGroup(false); }
  }

  const filteredPosts = posts.filter(p =>
    !postSearch ||
    p.title.toLowerCase().includes(postSearch.toLowerCase()) ||
    p.authorName.toLowerCase().includes(postSearch.toLowerCase()) ||
    (p.groupName ?? "").toLowerCase().includes(postSearch.toLowerCase())
  );

  // ── Render ────────────────────────────────────────────────────────────────────

  const card = `rounded-3xl border transition-colors ${isDark ? "border-dark-border bg-dark-card" : "border-light-grey bg-pure-white"}`;
  const muted = isDark ? "text-dark-text-muted" : "text-dark-charcoal/50";
  const text = isDark ? "text-dark-text" : "text-dark-charcoal";
  const inputCls = `w-full rounded-xl border px-4 py-2.5 text-sm outline-none focus:border-primary-blue/60 focus:ring-2 focus:ring-primary-blue/10 ${isDark ? "bg-dark-card border-dark-border text-dark-text placeholder:text-dark-text-muted" : "bg-pure-white border-light-grey text-dark-charcoal"}`;

  const ConfirmDialog = ({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className={`rounded-2xl border p-6 shadow-xl max-w-sm w-full mx-4 ${isDark ? "bg-dark-card border-dark-border" : "bg-pure-white border-light-grey"}`}>
        <p className={`text-sm font-semibold mb-4 ${text}`}>{message}</p>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onCancel}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${isDark ? "border-dark-border text-dark-text hover:bg-dark-border/40" : "border-light-grey text-dark-charcoal hover:bg-very-light-grey"}`}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm}
            className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-pure-white hover:bg-red-700 transition">
            Delete
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <section className="space-y-6">
      {pendingDeletePost && (
        <ConfirmDialog
          message="Permanently remove this post? This action cannot be undone."
          onConfirm={() => executeDeletePost(pendingDeletePost)}
          onCancel={() => setPendingDeletePost(null)}
        />
      )}
      {pendingDeleteGroup && (
        <ConfirmDialog
          message="Delete this group? All posts within it will be unlinked."
          onConfirm={() => executeDeleteGroup(pendingDeleteGroup)}
          onCancel={() => setPendingDeleteGroup(null)}
        />
      )}

      {/* Header */}
      <header>
        <h1 className={`text-3xl font-semibold ${text}`}>Community Management</h1>
        <p className={`text-sm mt-1 ${muted}`}>Moderate user posts and manage community groups.</p>
      </header>

      {fetchError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {fetchError}
        </div>
      )}

      {/* Tabs — Posts, Groups, Comments, Reports (merged from /community/* sub-pages) */}
      <div className={`flex flex-wrap gap-1 p-1 rounded-2xl border w-fit ${isDark ? "border-dark-border bg-dark-bg" : "border-light-grey bg-very-light-grey"}`}>
        {(canModerateComments
          ? (["posts", "groups", "comments", "reports"] as const)
          : (["posts", "groups"] as const)
        ).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`relative px-5 py-2 rounded-xl text-sm font-semibold capitalize transition-colors ${tab === t
              ? "bg-primary-blue text-pure-white shadow-sm"
              : `${muted} hover:${text}`}`}>
            {t === "posts"
              ? `Posts ${posts.length ? `(${posts.length})` : ""}`
              : t === "groups"
                ? `Groups ${groups.length ? `(${groups.length})` : ""}`
                : t === "comments"
                  ? "Comments"
                  : "Reports"}
            {t === "reports" && pendingReports > 0 && tab !== "reports" && (
              <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                {pendingReports > 99 ? "99+" : pendingReports}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── POSTS TAB ── */}
      {tab === "posts" && (
        <div className="space-y-4">
          {/* Sort + search row */}
          <div className="flex flex-wrap gap-3">
            <div className={`flex rounded-xl border overflow-hidden ${isDark ? "border-dark-border" : "border-light-grey"}`}>
              {(["new", "top"] as const).map(s => (
                <button key={s} type="button" onClick={() => setPostSort(s)}
                  className={`px-4 py-2.5 text-sm font-semibold transition capitalize ${
                    postSort === s
                      ? "bg-primary-blue text-pure-white"
                      : isDark ? "bg-dark-card text-dark-text-secondary hover:bg-dark-border/40" : "bg-pure-white text-dark-charcoal/70 hover:bg-very-light-grey"
                  }`}>
                  {s === "new" ? (
                    <span className="flex items-center gap-1.5">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 flex-shrink-0">
                        <circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M12 7v5l3 3" />
                      </svg>
                      New
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 flex-shrink-0">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
                      </svg>
                      Top
                    </span>
                  )}
                </button>
              ))}
            </div>
            <input type="text" value={postSearch} onChange={e => setPostSearch(e.target.value)}
              placeholder="Search by title, author, or group…" className={`${inputCls} flex-1 min-w-[200px]`} />
          </div>

          <div className={card}>
            {postsLoading ? (
              <div className="flex justify-center py-16">
                <div className={`h-10 w-10 animate-spin rounded-full border-4 ${isDark ? "border-dark-border border-t-primary-blue" : "border-light-grey border-t-primary-blue"}`} />
              </div>
            ) : filteredPosts.length === 0 ? (
              <div className="flex flex-col items-center py-16 gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={`h-10 w-10 ${muted}`}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <p className={`text-sm ${muted}`}>No posts found</p>
              </div>
            ) : (
              <div className={`divide-y ${isDark ? "divide-dark-border" : "divide-light-grey"}`}>
                {filteredPosts.map(post => (
                  <div key={post.id} className={`flex items-start gap-4 p-5 transition-colors ${isDark ? "hover:bg-dark-bg" : "hover:bg-very-light-grey"}`}>
                    {/* Image thumbnail */}
                    {post.imageUrl && (
                      <div className="flex-shrink-0 h-14 w-14 rounded-xl overflow-hidden bg-gray-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={post.imageUrl} alt="" className="h-full w-full object-cover"
                          onError={e => (e.target as HTMLImageElement).style.display = "none"} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      {/* Group badge */}
                      {post.groupName && (
                        <span className="inline-block text-[10px] font-bold uppercase tracking-wide text-primary-blue bg-primary-blue/10 px-2 py-0.5 rounded-full mb-1">
                          g/{post.groupSlug}
                        </span>
                      )}
                      <h3 className={`font-semibold text-sm line-clamp-1 ${text}`}>{post.title}</h3>
                      <p className={`text-xs line-clamp-2 mt-0.5 ${muted}`}>{post.content}</p>
                      <div className={`flex items-center gap-3 mt-1.5 text-xs ${muted}`}>
                        <span>{post.authorName}</span>
                        <span>•</span>
                        <span>{timeAgo(post.createdAt)}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3 flex-shrink-0">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75A2.25 2.25 0 0116.5 4.5c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H5.904M14.25 9h2.25M5.904 18.75c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 01-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 10.203 4.167 9.75 5 9.75h1.053c.472 0 .745.556.5.96a8.958 8.958 0 00-1.302 4.665c0 1.194.232 2.333.654 3.375z" />
                          </svg>
                          {post.likesCount}
                        </span>
                        <span className="flex items-center gap-1">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3 flex-shrink-0">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                          </svg>
                          {post.commentsCount}
                        </span>
                      </div>
                    </div>
                    <button type="button" onClick={() => confirmDeletePost(post.id)}
                      disabled={deletingPost === post.id}
                      className="flex-shrink-0 flex items-center gap-1 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-600 hover:text-white transition disabled:opacity-40">
                      {deletingPost === post.id
                        ? <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        : <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                      }
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {postsHasMore && !postsLoading && (
            <button type="button" onClick={() => fetchPosts(postsPage + 1, postSort, false)}
              className="w-full py-3 rounded-2xl border border-primary-blue/30 text-sm font-semibold text-primary-blue hover:bg-primary-blue hover:text-pure-white transition">
              Load more posts
            </button>
          )}
        </div>
      )}

      {/* ── GROUPS TAB ── */}
      {tab === "groups" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" onClick={() => setShowCreateGroup(true)}
              className="flex items-center gap-2 rounded-2xl bg-primary-blue px-5 py-2.5 text-sm font-semibold text-pure-white hover:bg-primary-blue/90 transition">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New Group
            </button>
          </div>

          {/* Create group form */}
          {showCreateGroup && (
            <div className={`${card} p-6`}>
              <h3 className={`font-bold mb-4 ${text}`}>Create Community Group</h3>
              {groupFormError && (
                <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{groupFormError}</div>
              )}
              <form onSubmit={createGroup} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={`block text-xs font-semibold mb-1 ${muted}`}>Slug (URL-safe)*</label>
                  <input value={groupForm.slug} onChange={e => setGroupForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") }))}
                    placeholder="kuching-floods" className={inputCls} />
                  <p className={`text-[10px] mt-1 ${muted}`}>Community URL: /g/{groupForm.slug || "slug"}</p>
                </div>
                <div>
                  <label className={`block text-xs font-semibold mb-1 ${muted}`}>Name*</label>
                  <input value={groupForm.name} onChange={e => setGroupForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Kuching Flood Updates" className={inputCls} />
                </div>
                <div className="md:col-span-2">
                  <label className={`block text-xs font-semibold mb-1 ${muted}`}>Description</label>
                  <textarea value={groupForm.description} onChange={e => setGroupForm(f => ({ ...f, description: e.target.value }))}
                    rows={2} placeholder="What is this community about?"
                    className={`${inputCls} resize-none`} />
                </div>
                <div>
                  <label className={`block text-xs font-semibold mb-1 ${muted}`}>Icon Color</label>
                  <div className="flex items-center gap-3">
                    <input type="color" value={groupForm.iconColor}
                      onChange={e => setGroupForm(f => ({ ...f, iconColor: e.target.value }))}
                      className="h-10 w-16 rounded-lg border border-light-grey cursor-pointer" />
                    <div className="h-10 w-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                      style={{ backgroundColor: groupForm.iconColor }}>
                      {groupForm.name?.[0]?.toUpperCase() || "G"}
                    </div>
                  </div>
                </div>
                <div className="md:col-span-2 flex justify-end gap-3">
                  <button type="button" onClick={() => { setShowCreateGroup(false); setGroupFormError(null); }}
                    className={`rounded-2xl border px-5 py-2.5 text-sm font-semibold transition ${isDark ? "border-dark-border text-dark-text-secondary hover:bg-dark-border/40" : "border-light-grey text-dark-charcoal/70 hover:bg-very-light-grey"}`}>
                    Cancel
                  </button>
                  <button type="submit" disabled={savingGroup}
                    className="rounded-2xl bg-primary-blue px-6 py-2.5 text-sm font-semibold text-pure-white hover:bg-primary-blue/90 transition disabled:opacity-50">
                    {savingGroup ? "Creating…" : "Create Group"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Groups list */}
          <div className={`${card} overflow-hidden`}>
            {groupsLoading ? (
              <div className="flex justify-center py-16">
                <div className={`h-10 w-10 animate-spin rounded-full border-4 ${isDark ? "border-dark-border border-t-primary-blue" : "border-light-grey border-t-primary-blue"}`} />
              </div>
            ) : groups.length === 0 ? (
              <div className="flex flex-col items-center py-16 gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={`h-10 w-10 ${muted}`}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                </svg>
                <p className={`text-sm ${muted}`}>No groups yet. Create the first one!</p>
              </div>
            ) : (
              <div className={`divide-y ${isDark ? "divide-dark-border" : "divide-light-grey"}`}>
                {groups.map(g => (
                  <div key={g.id} className={`flex items-center gap-4 p-5 transition-colors ${isDark ? "hover:bg-dark-bg" : "hover:bg-very-light-grey"}`}>
                    <div className="h-11 w-11 rounded-full flex items-center justify-center text-white font-bold text-base flex-shrink-0"
                      style={{ backgroundColor: g.iconColor }}>
                      {g.iconLetter}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold text-sm ${text}`}>{g.name}</span>
                        <span className={`text-xs ${muted}`}>g/{g.slug}</span>
                      </div>
                      {g.description && <p className={`text-xs line-clamp-1 mt-0.5 ${muted}`}>{g.description}</p>}
                      <div className={`flex gap-3 mt-1 text-xs ${muted}`}>
                        <span className="flex items-center gap-1">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3 flex-shrink-0">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                          </svg>
                          {g.membersCount} members
                        </span>
                        <span className="flex items-center gap-1">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3 flex-shrink-0">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                          </svg>
                          {g.postsCount} posts
                        </span>
                      </div>
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-2">
                      <button type="button" onClick={() => {
                        setEditingGroup(g);
                        setEditGroupForm({
                          name: g.name,
                          description: g.description ?? "",
                          iconColor: g.iconColor,
                        });
                        setEditGroupError(null);
                      }}
                        className="flex items-center gap-1 rounded-xl border border-primary-blue/30 bg-primary-blue/5 px-3 py-2 text-xs font-semibold text-primary-blue hover:bg-primary-blue hover:text-white transition">
                        Edit
                      </button>
                      <button type="button" onClick={() => confirmDeleteGroup(g.id)}
                        disabled={deletingGroup === g.id}
                        className="flex items-center gap-1 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-600 hover:text-white transition disabled:opacity-40" >
                        {deletingGroup === g.id
                          ? <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          : "Delete"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── COMMENTS TAB (merged from /community/comments) ── */}
      {tab === "comments" && canModerateComments && (
        <CommentsModerationPanel />
      )}

      {/* ── REPORTS TAB (merged from /community/content-reports) ── */}
      {tab === "reports" && canModerateComments && (
        <ReportsModerationPanel onPendingCountChange={setPendingReports} />
      )}

      {/* ── Edit Group modal — completes CRUD on Groups ── */}
      {editingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className={`w-full max-w-lg rounded-2xl border shadow-xl ${isDark ? "bg-dark-card border-dark-border" : "bg-pure-white border-light-grey"}`}>
            <div className={`flex items-center justify-between p-5 border-b ${isDark ? "border-dark-border" : "border-light-grey"}`}>
              <h3 className={`text-lg font-bold ${text}`}>Edit Group</h3>
              <button type="button" onClick={() => setEditingGroup(null)}
                className={`rounded-lg p-1.5 hover:bg-[var(--color-hover)] transition ${muted}`}
                aria-label="Close">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              setEditGroupError(null);
              if (!editGroupForm.name.trim()) {
                setEditGroupError("Name is required");
                return;
              }
              setSavingEditGroup(true);
              try {
                const res = await authFetch(`/api/community/groups/${editingGroup.id}`, accessToken!, silentRefresh, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(editGroupForm),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                  setEditGroupError(data.error || "Failed to update group");
                  return;
                }
                // Update local state with new values
                setGroups(g => g.map(x => x.id === editingGroup.id ? { ...x, ...editGroupForm, iconLetter: editGroupForm.name[0]?.toUpperCase() ?? x.iconLetter } : x));
                setEditingGroup(null);
              } catch {
                setEditGroupError("Network error — please try again");
              } finally {
                setSavingEditGroup(false);
              }
            }} className="p-5 space-y-4">
              {editGroupError && (
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{editGroupError}</div>
              )}
              <div>
                <label className={`block text-xs font-semibold mb-1 ${muted}`}>Slug (read-only)</label>
                <input value={editingGroup.slug} disabled
                  className={`${inputCls} opacity-60 cursor-not-allowed`} />
                <p className={`text-[10px] mt-1 ${muted}`}>Slug cannot be changed after creation.</p>
              </div>
              <div>
                <label className={`block text-xs font-semibold mb-1 ${muted}`}>Name*</label>
                <input value={editGroupForm.name}
                  onChange={e => setEditGroupForm(f => ({ ...f, name: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className={`block text-xs font-semibold mb-1 ${muted}`}>Description</label>
                <textarea value={editGroupForm.description}
                  onChange={e => setEditGroupForm(f => ({ ...f, description: e.target.value }))}
                  rows={3} className={`${inputCls} resize-none`} />
              </div>
              <div>
                <label className={`block text-xs font-semibold mb-1 ${muted}`}>Icon Color</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={editGroupForm.iconColor}
                    onChange={e => setEditGroupForm(f => ({ ...f, iconColor: e.target.value }))}
                    className="h-10 w-16 rounded-lg border border-light-grey cursor-pointer" />
                  <div className="h-10 w-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                    style={{ backgroundColor: editGroupForm.iconColor }}>
                    {editGroupForm.name?.[0]?.toUpperCase() || "G"}
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setEditingGroup(null)}
                  className={`rounded-2xl border px-5 py-2.5 text-sm font-semibold transition ${isDark ? "border-dark-border text-dark-text-secondary hover:bg-dark-border/40" : "border-light-grey text-dark-charcoal/70 hover:bg-very-light-grey"}`}>
                  Cancel
                </button>
                <button type="submit" disabled={savingEditGroup}
                  className="rounded-2xl bg-primary-blue px-6 py-2.5 text-sm font-semibold text-pure-white hover:bg-primary-blue/90 transition disabled:opacity-50">
                  {savingEditGroup ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

// useSearchParams() requires a Suspense boundary in Next.js 15+
export default function CommunityManagementPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-dark-charcoal/60 dark:text-dark-text-secondary">Loading…</div>}>
      <CommunityManagementInner />
    </Suspense>
  );
}
