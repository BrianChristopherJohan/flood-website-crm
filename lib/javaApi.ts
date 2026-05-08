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

/** flood-service-community — comment threading / moderation APIs when deployed separately from CRM. */
const COMMUNITY_JAVA_API_URL = normaliseJavaApiBase(
  process.env.COMMUNITY_JAVA_API_URL || JAVA_API_URL,
  JAVA_API_URL,
);

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
    const err = new Error(`Java API ${method} ${p} → ${res.status}: ${text}`) as Error & {
      status: number;
    };
    err.status = res.status;
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
