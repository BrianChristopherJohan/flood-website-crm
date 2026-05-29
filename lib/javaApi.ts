// ─────────────────────────────────────────────────────────────
// lib/javaApi.ts — Server-side proxy to Java Spring Boot API
//
// Used ONLY in Next.js API routes (server-side).
// Never import this in client components.
//
// Environment:
//   JAVA_API_URL  — CRM Spring Boot (`flood-service-crm`, default port 4002).
//                   Docker + Kong: http://kong-gateway:8000/crm (see deploy/docker-compose.yml)
//                   Local direct:  http://localhost:4002
//                   Vercel + Railway: https://…railway.app (direct; no Kong)
//   COMMUNITY_JAVA_API_URL — flood-service-community (threaded comments + admin
//                   moderation). Defaults to JAVA_API_URL when omitted.
//                   Docker + Kong: http://kong-gateway:8000/community
// ─────────────────────────────────────────────────────────────

import { normaliseJavaApiBase } from "@/lib/normaliseJavaApiBase";

const JAVA_API_URL = normaliseJavaApiBase(
  process.env.JAVA_API_URL ||
    process.env.NEXT_PUBLIC_JAVA_API_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL,
  "http://localhost:4002",
);

/**
 * flood-service-community — hosts threaded comments, content reports,
 * admin moderation and the live sensor SSE stream. The CRM Java service
 * does NOT mirror these endpoints, so falling back to JAVA_API_URL when
 * COMMUNITY_JAVA_API_URL is unset leaves /community/admin/comments etc.
 * dead in production (the panel just shows "Failed to load comments").
 *
 * Resolution order:
 *   1. COMMUNITY_JAVA_API_URL explicit env (preferred for local dev to
 *      point at http://localhost:4001).
 *   2. JAVA_API_URL when it points at localhost (developer running both
 *      services locally and only set the CRM port — they usually also
 *      have community on 4001; we still prefer COMMUNITY_JAVA_API_URL).
 *   3. The hosted community Railway URL — guarantees production never
 *      misroutes community-only endpoints to the CRM service.
 */
function resolveCommunityJavaApiUrl(): string {
  const explicit = process.env.COMMUNITY_JAVA_API_URL;
  if (explicit && explicit.length > 0) {
    return normaliseJavaApiBase(explicit, explicit);
  }
  const sibling = process.env.JAVA_API_URL || "";
  if (sibling.includes("localhost") || sibling.includes("127.0.0.1")) {
    return normaliseJavaApiBase(sibling, sibling);
  }
  return "https://flood-service-community-production.up.railway.app";
}

const COMMUNITY_JAVA_API_URL = resolveCommunityJavaApiUrl();

/** Exposed for routes that proxy long-lived streams (SSE) to the community
 *  service and need to build the upstream URL themselves. */
export const COMMUNITY_JAVA_API_BASE = COMMUNITY_JAVA_API_URL;

type FetchOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string; // Bearer token from the incoming CRM request
  revalidate?: number; // Next.js ISR revalidation in seconds (default: 0)
  /** Hard timeout in ms. Defaults to 10 s — prevents hanging on Railway cold starts. */
  timeoutMs?: number;
};

async function javaFetchWithBase<T>(
  base: string,
  path: string,
  { method = "GET", body, token, revalidate = 0, timeoutMs = 10_000 }: FetchOptions = {},
): Promise<T> {
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = `${base}${p}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    next: { revalidate },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Extract only a human-readable message from the JSON body — never
    // embed the raw upstream body in the thrown Error's message (it can
    // contain stack traces / internal detail that would leak to the
    // client). Spring Boot returns { message } or { error }. The raw
    // body is kept on `err.rawBody` for server-side logging only.
    let parsed: string | undefined;
    try {
      const json = JSON.parse(text);
      parsed = json.message || json.error;
    } catch {
      /* not JSON — fall back to a generic, body-free message */
    }
    const err = new Error(parsed || `Java API ${method} ${p} → ${res.status}`) as Error & {
      status: number;
      rawBody: string;
    };
    err.status = res.status;
    err.rawBody = text;
    throw err;
  }

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;

  return res.json() as Promise<T>;
}

export async function javaFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  return javaFetchWithBase<T>(JAVA_API_URL, path, opts);
}

/**
 * Calls {@link COMMUNITY_JAVA_API_URL} (defaults to {@link JAVA_API_URL}).
 * Use for community comment admin routes backed by `flood-service-community`.
 */
export async function communityJavaFetch<T>(
  path: string,
  opts: FetchOptions = {},
): Promise<T> {
  return javaFetchWithBase<T>(COMMUNITY_JAVA_API_URL, path, opts);
}

// ── Typed helpers ──────────────────────────────────────────────

export type JavaSensorDto = {
  id: string;
  nodeId: string;
  name: string;
  status: "active" | "warning" | "inactive";
  distance: string;
  coordinate: [number, number]; // [longitude, latitude]
  area: string;
  location: string;
  state: string;
  currentLevel: 0 | 1 | 2 | 3;
  isDead: boolean;
  lastUpdated: string;
  createdAt: string;
};

export type JavaDashboardNode = {
  id: string;
  nodeId: string;
  name: string;
  area: string;
  level: string;
  status: "Normal" | "Watch" | "Warning" | "Critical" | "Offline";
  update: string;
  timestamp: string;
};
