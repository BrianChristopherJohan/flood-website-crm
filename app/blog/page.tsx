"use client";

import { useTheme } from "@/lib/ThemeContext";
import { useAuth } from "@/lib/AuthContext";
import OverviewCard from "@/components/cards/OverviewCard";
import BlogImageUploader from "@/components/BlogImageUploader";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type BlogDto = {
  id: string;
  imageKey: string;
  imageUrl?: string | null;
  category: string;
  title: string;
  body: string;
  isFeatured: boolean;
  createdAt: string;
  updatedAt?: string | null;
};

type PageDto = {
  content: BlogDto[];
  totalElements: number;
  totalPages: number;
  number: number;
  last: boolean;
};

type BlogForm = {
  title: string;
  body: string;
  imageUrl: string;
  imageKey: string;
  category: string;
  isFeatured: boolean;
};

// Canonical list must match flood-website-community & flood-mobile (incl. General).
const CATEGORIES = ["General", "Flood Alert", "Safety Tips", "Community", "Updates", "Research"];

function mergeCategoryTabs(fromApi: string[]): string[] {
  const list = fromApi.filter((c) => c != null && String(c).trim() !== "");
  const set = new Set(list);
  const ordered = CATEGORIES.filter((c) => set.has(c));
  const extras = list
    .filter((c) => !CATEGORIES.includes(c))
    .sort((a, b) => a.localeCompare(b));
  return ["All", ...ordered, ...extras];
}

const EMPTY_FORM: BlogForm = {
  title: "",
  body: "",
  imageUrl: "",
  imageKey: "blog-1",
  category: "General",
  isFeatured: false,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-MY", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function readingTime(body: string): string {
  const words = (body ?? "").trim().split(/\s+/).length;
  return `${Math.max(1, Math.round(words / 200))} min read`;
}

function categoryColor(cat: string): { bg: string; text: string } {
  switch (cat) {
    case "General":     return { bg: "bg-gray-100 dark:bg-dark-bg",        text: "text-gray-700 dark:text-dark-text-secondary" };
    case "Flood Alert": return { bg: "bg-blue-100 dark:bg-blue-900/30",    text: "text-blue-700 dark:text-blue-400" };
    case "Safety Tips": return { bg: "bg-amber-100 dark:bg-amber-900/30",  text: "text-amber-700 dark:text-amber-400" };
    case "Community":   return { bg: "bg-purple-100 dark:bg-purple-900/30", text: "text-purple-700 dark:text-purple-400" };
    case "Updates":     return { bg: "bg-blue-100 dark:bg-blue-900/30",    text: "text-blue-700 dark:text-blue-400" };
    case "Research":    return { bg: "bg-emerald-100 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-400" };
    default:            return { bg: "bg-gray-100 dark:bg-dark-bg",        text: "text-gray-700 dark:text-dark-text-secondary" };
  }
}

function CategoryBadge({ category }: { category: string }) {
  const { bg, text } = categoryColor(category);
  return (
    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${bg} ${text}`}>
      {category}
    </span>
  );
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function parseJsonResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

// Call a same-origin BFF route with the httpOnly auth cookie, retrying
// once via silentRefresh() on 401/403 (it rotates the cookie). Decoupled
// from the in-memory accessToken, which is null on the cookie-based CRM
// session (SSO handoff / fresh login) — that null previously gated the
// blog list AND every mutation shut, so the page showed "No articles
// found" and clicking Publish silently did nothing.
async function cookieFetch(
  url: string,
  silentRefresh: () => Promise<string | null>,
  options: RequestInit = {},
): Promise<Response> {
  const doFetch = () =>
    fetch(url, { ...options, cache: "no-store", credentials: "include" });
  let res = await doFetch();
  if (res.status === 401 || res.status === 403) {
    await silentRefresh();
    res = await doFetch();
  }
  return res;
}

// ─── Blog Form Modal ──────────────────────────────────────────────────────────

function BlogFormModal({
  show,
  initial,
  onClose,
  onSave,
}: {
  show: boolean;
  initial: BlogForm;
  onClose: () => void;
  onSave: (form: BlogForm) => Promise<void>;
}) {
  const { isDark } = useTheme();
  const [form, setForm] = useState<BlogForm>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (show) setForm(initial); }, [show]);

  const set = (key: keyof BlogForm, val: string | boolean) =>
    setForm(prev => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    if (!form.title.trim()) { setError("Title is required."); return; }
    if (!form.body.trim())  { setError("Content is required."); return; }
    // The uploader emits a `data:image/jpeg;base64,...` URL which is
    // already validated against the allowed image types client-side.
    // Empty is fine — the blog uses a bundled imageKey as fallback.
    setError(""); setSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  if (!show) return null;

  const text = isDark ? "text-dark-text" : "text-dark-charcoal";
  const muted = isDark ? "text-dark-text-muted" : "text-dark-charcoal/50";
  const inputCls = `w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition focus:border-primary-blue/60 focus:ring-2 focus:ring-primary-blue/10 ${
    isDark ? "bg-dark-bg border-dark-border text-dark-text placeholder:text-dark-text-muted" : "bg-pure-white border-light-grey text-dark-charcoal placeholder:text-dark-charcoal/40"
  }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className={`w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border shadow-2xl ${isDark ? "bg-dark-card border-dark-border" : "bg-pure-white border-light-grey"}`}>

        {/* Modal header */}
        <div className={`flex items-center justify-between p-6 border-b ${isDark ? "border-dark-border" : "border-light-grey"}`}>
          <h2 className={`text-xl font-bold ${text}`}>
            {initial.title ? "Edit Article" : "New Article"}
          </h2>
          <button onClick={onClose} className={`rounded-full p-2 transition ${isDark ? "hover:bg-dark-bg" : "hover:bg-very-light-grey"}`}>
            <svg className={`h-5 w-5 ${muted}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal body */}
        <div className="p-6 space-y-5">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Title */}
          <div>
            <label className={`mb-1.5 block text-sm font-semibold ${text}`}>
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.title}
              onChange={e => set("title", e.target.value)}
              placeholder="Enter article title..."
              className={inputCls}
            />
          </div>

          {/* Category */}
          <div>
            <label className={`mb-1.5 block text-sm font-semibold ${text}`}>Category</label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => set("category", cat)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    form.category === cat
                      ? "border-primary-blue bg-primary-blue text-pure-white"
                      : isDark
                        ? "border-dark-border text-dark-text-muted hover:border-primary-blue/60"
                        : "border-light-grey text-dark-charcoal/60 hover:border-primary-blue/60"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Hero image — file upload replaces the legacy URL paste field */}
          <div>
            <label className={`mb-1.5 block text-sm font-semibold ${text}`}>
              Hero image <span className={`text-xs font-normal ${muted}`}>(optional)</span>
            </label>
            <BlogImageUploader
              value={form.imageUrl || null}
              onChange={(dataUrl) => set("imageUrl", dataUrl)}
              onClear={() => set("imageUrl", "")}
            />
          </div>

          {/* Featured toggle */}
          <div className={`flex items-center justify-between rounded-2xl border p-4 ${isDark ? "border-dark-border bg-dark-bg" : "border-light-grey bg-very-light-grey"}`}>
            <div>
              <p className={`text-sm font-semibold ${text}`}>Featured Article</p>
              <p className={`mt-0.5 text-xs ${muted}`}>Show this article in the Featured section</p>
            </div>
            <button
              onClick={() => set("isFeatured", !form.isFeatured)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.isFeatured ? "bg-primary-blue" : isDark ? "bg-dark-border" : "bg-light-grey"}`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${form.isFeatured ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>

          {/* Body */}
          <div>
            <label className={`mb-1.5 block text-sm font-semibold ${text}`}>
              Content <span className="text-red-500">*</span>
            </label>
            <textarea
              value={form.body}
              onChange={e => set("body", e.target.value)}
              rows={10}
              placeholder={"Write your article content here...\n\nUse double line breaks to separate paragraphs.\nUse **Heading** for section headings."}
              className={`${inputCls} resize-none`}
            />
            <p className={`mt-1 text-xs ${muted}`}>{(form.body.trim().split(/\s+/).filter(Boolean).length)} words · {readingTime(form.body)}</p>
          </div>
        </div>

        {/* Modal footer */}
        <div className={`flex items-center justify-end gap-3 p-6 border-t ${isDark ? "border-dark-border" : "border-light-grey"}`}>
          <button
            onClick={onClose}
            className={`rounded-2xl border px-5 py-2.5 text-sm font-semibold transition ${isDark ? "border-dark-border text-dark-text-secondary hover:bg-dark-bg" : "border-light-grey text-dark-charcoal/70 hover:bg-very-light-grey"}`}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-2xl bg-primary-blue px-6 py-2.5 text-sm font-semibold text-pure-white transition hover:bg-primary-blue/90 disabled:opacity-60"
          >
            {saving && <span className="inline-block h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
            {initial.title ? "Save Changes" : "Publish Article"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Blog Card ────────────────────────────────────────────────────────────────

function BlogCard({
  blog,
  onEdit,
  onDelete,
  onToggle,
}: {
  blog: BlogDto;
  onEdit: (blog: BlogDto) => void;
  onDelete: (blog: BlogDto) => void;
  onToggle: (blog: BlogDto) => void;
}) {
  const { isDark } = useTheme();
  const text = isDark ? "text-dark-text" : "text-dark-charcoal";
  const muted = isDark ? "text-dark-text-muted" : "text-dark-charcoal/50";

  return (
    <div className={`overflow-hidden rounded-3xl border shadow-sm transition hover:shadow-md ${isDark ? "border-dark-border bg-dark-card" : "border-light-grey bg-pure-white"}`}>
      <div className="flex">
        {/* Thumbnail */}
        <div className={`flex w-36 shrink-0 items-center justify-center ${isDark ? "bg-dark-bg" : "bg-very-light-grey"}`}>
          {blog.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={blog.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-1 p-4">
              <svg className={`h-8 w-8 ${muted}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className={`text-xs ${muted}`}>{blog.imageKey}</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col gap-2 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <CategoryBadge category={blog.category} />
              {blog.isFeatured && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  Featured
                </span>
              )}
            </div>
            <span className={`shrink-0 text-xs ${muted}`}>{readingTime(blog.body)}</span>
          </div>

          <h3 className={`line-clamp-2 text-sm font-bold leading-snug ${text}`}>
            {blog.title}
          </h3>

          <p className={`line-clamp-2 text-xs ${muted}`}>
            {blog.body}
          </p>

          <div className={`mt-auto flex items-center gap-1 text-xs ${muted}`}>
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {formatDate(blog.createdAt)}
          </div>

          {/* Action row */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={() => onToggle(blog)}
              className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                blog.isFeatured
                  ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                  : isDark
                    ? "border-dark-border text-dark-text-muted hover:bg-dark-bg"
                    : "border-light-grey text-dark-charcoal/60 hover:bg-very-light-grey"
              }`}
            >
              {blog.isFeatured ? "Unfeature" : "Feature"}
            </button>
            <button
              onClick={() => onEdit(blog)}
              className="rounded-xl border border-primary-blue/30 bg-primary-blue/5 px-3 py-1.5 text-xs font-semibold text-primary-blue transition hover:bg-primary-blue hover:text-pure-white"
            >
              Edit
            </button>
            <button
              onClick={() => onDelete(blog)}
              className="rounded-xl border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-600 hover:text-white dark:bg-red-900/20"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BlogPage() {
  const { isDark } = useTheme();
  const { silentRefresh } = useAuth();
  const [blogs, setBlogs] = useState<BlogDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filterCat, setFilterCat] = useState("All");
  const [filterTabs, setFilterTabs] = useState<string[]>(() => ["All", ...CATEGORIES]);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<BlogDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BlogDto | null>(null);

  const text = isDark ? "text-dark-text" : "text-dark-charcoal";
  const muted = isDark ? "text-dark-text-muted" : "text-dark-charcoal/50";
  const card = `rounded-3xl border transition-colors ${isDark ? "border-dark-border bg-dark-card" : "border-light-grey bg-pure-white"}`;

  const showToast = useCallback((msg: string, ok = true) => {
    if (ok) toast.success(msg);
    else toast.error(msg);
  }, []);

  const loadBlogs = useCallback(async (category = "All") => {
    setLoading(true); setError("");
    try {
      const catParam = category !== "All" ? `&category=${encodeURIComponent(category)}` : "";
      const res = await cookieFetch(`/api/blogs?size=100${catParam}`, silentRefresh);
      const data = await parseJsonResponse<PageDto>(res);
      setBlogs(data.content ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load articles");
    } finally {
      setLoading(false);
    }
  }, [silentRefresh]);

  useEffect(() => { void loadBlogs(); }, [loadBlogs]);

  const handleFilterCat = (cat: string) => {
    setFilterCat(cat);
    void loadBlogs(cat);
  };

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/blogs/categories", { cache: "no-store" });
        if (!res.ok) return;
        const data: unknown = await res.json();
        if (Array.isArray(data)) setFilterTabs(mergeCategoryTabs(data as string[]));
      } catch {
        /* keep defaults */
      }
    })();
  }, []);

  useEffect(() => {
    if (filterCat !== "All" && !filterTabs.includes(filterCat)) setFilterCat("All");
  }, [filterTabs, filterCat]);

  const displayed = blogs.filter(b => {
    if (!search.trim()) return true;
    return (
      b.title.toLowerCase().includes(search.toLowerCase()) ||
      b.body.toLowerCase().includes(search.toLowerCase())
    );
  });

  const handleSave = async (form: BlogForm) => {
    const payload = {
      title: form.title,
      body: form.body,
      imageUrl: form.imageUrl || undefined,
      imageKey: form.imageKey,
      category: form.category,
      isFeatured: form.isFeatured,
    };
    const headers = { "Content-Type": "application/json" };
    if (editTarget) {
      const res = await cookieFetch(`/api/blogs/${editTarget.id}`, silentRefresh, {
        method: "PUT",
        headers,
        body: JSON.stringify(payload),
      });
      const updated = await parseJsonResponse<BlogDto>(res);
      // Reflect the server's returned entity in place — the response IS
      // the source of truth, so no full refetch is needed.
      setBlogs((prev) =>
        prev.map((b) => (b.id === editTarget.id ? { ...b, ...updated } : b)),
      );
      showToast("Article updated successfully");
    } else {
      const res = await cookieFetch("/api/blogs", silentRefresh, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const created = await parseJsonResponse<BlogDto>(res);
      if (!created || !created.id) {
        throw new Error("The server did not return the created article. Please refresh.");
      }
      // Show the new article immediately from the POST response and clear
      // any active filter/search so it can't be hidden. We deliberately
      // do NOT refetch-and-replace here: a read-after-write lag could
      // briefly return a stale list and wipe the row the user just
      // created. Stats/visibility derive from `blogs`, so this is enough.
      setBlogs((prev) => [created, ...prev.filter((b) => b.id !== created.id)]);
      setFilterCat("All");
      setSearch("");
      showToast("Article published successfully");
    }
  };

  const handleDelete = async (blog: BlogDto) => {
    if (deleteTarget?.id !== blog.id) { setDeleteTarget(blog); return; }
    setDeleteTarget(null);
    try {
      const res = await cookieFetch(`/api/blogs/${blog.id}`, silentRefresh, { method: "DELETE" });
      await parseJsonResponse(res);
      setBlogs(prev => prev.filter(b => b.id !== blog.id));
      showToast("Article deleted");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Delete failed", false);
    }
  };

  const handleToggleFeatured = async (blog: BlogDto) => {
    try {
      const res = await cookieFetch(`/api/blogs/${blog.id}/featured`, silentRefresh, { method: "PATCH" });
      const updated = await parseJsonResponse<BlogDto>(res);
      setBlogs(prev => prev.map(b => b.id === blog.id ? updated : b));
      showToast(updated.isFeatured ? "Marked as featured" : "Removed from featured");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed", false);
    }
  };

  const formInitial: BlogForm = editTarget
    ? { title: editTarget.title, body: editTarget.body, imageUrl: editTarget.imageUrl ?? "", imageKey: editTarget.imageKey ?? "blog-1", category: editTarget.category, isFeatured: editTarget.isFeatured }
    : EMPTY_FORM;

  const featuredCount = blogs.filter(b => b.isFeatured).length;
  const categoryCount = new Set(blogs.map(b => b.category)).size;

  return (
    <section className="space-y-6">
      {/* Inline delete confirmation bar */}
      {deleteTarget && (
        <div className={`fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-2xl border border-red-200 px-5 py-3 shadow-xl ${isDark ? "bg-dark-card" : "bg-pure-white"}`}>
          <span className={`max-w-xs truncate text-sm font-medium ${text}`}>
            Delete &ldquo;{deleteTarget.title}&rdquo;?
          </span>
          <button
            type="button"
            onClick={() => handleDelete(deleteTarget)}
            className="text-sm font-bold text-red-600 transition-colors hover:text-red-700"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setDeleteTarget(null)}
            className={`text-sm font-medium transition-colors ${muted} hover:${text}`}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Page header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className={`text-3xl font-semibold ${text}`}>Blog Management</h1>
          <p className={`mt-1 text-sm ${muted}`}>
            Manage public blog articles and featured content
          </p>
        </div>
        <button
          onClick={() => { setEditTarget(null); setShowModal(true); }}
          className="inline-flex items-center gap-2 rounded-2xl bg-primary-blue px-5 py-2.5 text-sm font-semibold text-pure-white shadow-sm transition hover:bg-primary-blue/90"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Article
        </button>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <OverviewCard title="Total Articles" value={String(blogs.length)} />
        <OverviewCard title="Featured" value={String(featuredCount)} />
        <OverviewCard title="Categories" value={String(categoryCount)} />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className={`flex flex-1 items-center gap-2 rounded-2xl border px-4 py-2.5 transition-colors ${isDark ? "border-dark-border bg-dark-card" : "border-light-grey bg-pure-white"}`}>
          <svg className={`h-4 w-4 ${muted}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search articles..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`flex-1 bg-transparent text-sm outline-none ${text} placeholder:${muted}`}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {filterTabs.map(cat => (
            <button
              key={cat}
              onClick={() => handleFilterCat(cat)}
              className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                filterCat === cat
                  ? "bg-primary-blue text-pure-white"
                  : isDark
                    ? "border border-dark-border bg-dark-card text-dark-text-muted hover:bg-dark-bg"
                    : "border border-light-grey bg-pure-white text-dark-charcoal/60 hover:bg-very-light-grey"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className={`h-10 w-10 animate-spin rounded-full border-4 ${isDark ? "border-dark-border border-t-primary-blue" : "border-light-grey border-t-primary-blue"}`} />
        </div>
      ) : error ? (
        <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-center dark:border-red-800 dark:bg-red-900/20">
          <p className="font-semibold text-red-700 dark:text-red-300">{error}</p>
          <button onClick={() => void loadBlogs()} className="mt-3 text-sm text-red-600 underline">Retry</button>
        </div>
      ) : displayed.length === 0 ? (
        <div className={`${card} p-16 text-center`}>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-blue/15 text-primary-blue">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
            </svg>
          </div>
          <p className={`text-lg font-semibold ${text}`}>No articles found</p>
          <p className={`mt-1 text-sm ${muted}`}>
            {blogs.length === 0 ? "Create your first article to get started." : "Try adjusting your filters."}
          </p>
          {blogs.length === 0 && (
            <button
              onClick={() => { setEditTarget(null); setShowModal(true); }}
              className="mt-4 rounded-2xl bg-primary-blue px-5 py-2.5 text-sm font-semibold text-pure-white transition hover:bg-primary-blue/90"
            >
              Create First Article
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <p className={`text-sm ${muted}`}>
            Showing {displayed.length} of {blogs.length} articles
          </p>
          {displayed.map(blog => (
            <BlogCard
              key={blog.id}
              blog={blog}
              onEdit={b => { setEditTarget(b); setShowModal(true); }}
              onDelete={handleDelete}
              onToggle={handleToggleFeatured}
            />
          ))}
        </div>
      )}

      {/* Form modal */}
      <BlogFormModal
        show={showModal}
        initial={formInitial}
        onClose={() => setShowModal(false)}
        onSave={handleSave}
      />
    </section>
  );
}
