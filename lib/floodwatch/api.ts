// FloodWatch IoT API — server-side fetch helper.
//
// The IoT API is read-only, public, and CORS-permissive, but we still
// proxy through Next.js BFF routes (under /api/iot/*) for consistency
// with the existing javaFetch pattern. This module owns the upstream
// HTTP call.
//
// Kept in lockstep with `flood-website-community/lib/floodwatch/api.ts`.
// The two copies are intentionally duplicated — a shared package is a
// later refactor (see plan addendum).

import type { Dataset } from "@/lib/floodwatch/types";

/**
 * Production IoT API base. Falls back if FLOODWATCH_API_BASE is unset
 * so a fresh checkout works without local env config. Override via
 * FLOODWATCH_API_BASE in Vercel / .env.local.
 */
export const FLOODWATCH_API_BASE = (
  process.env.FLOODWATCH_API_BASE ?? "http://159.223.70.28/api/v1"
).replace(/\/$/, "");

/**
 * Default dataset selector — `real`.
 *
 * Per FloodWatch API docs: `dataset=real` returns "Live sensor data
 * only — documents without `is_sample` flag". This is the canonical
 * production data the CRM is supposed to show operators.
 *
 * If your hardware triggers but no fresh data appears here, the issue
 * is upstream — the website only renders what the FastAPI returns.
 */
export const DEFAULT_DATASET: Dataset =
  (process.env.FLOODWATCH_DATASET as Dataset) ?? "real";

type Params = Record<string, string | number | boolean | undefined>;

type Opts = {
  /** Query parameters; undefined values are dropped. `dataset` auto-injected unless provided. */
  params?: Params;
  /** Forward an AbortSignal from the route handler so the upstream call is cancellable. */
  signal?: AbortSignal;
  /** Hard timeout in ms. Defaults to 10 s — the IoT API can be slow on cold start. */
  timeoutMs?: number;
  /** Whether to auto-inject the default dataset query param. Set false for endpoints that don't accept it. */
  injectDataset?: boolean;
};

/** Error thrown by floodwatchFetch when the upstream returns non-OK. */
export class FloodwatchFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly rawBody: string,
    public readonly url: string,
  ) {
    super(message);
    this.name = "FloodwatchFetchError";
  }
}

function buildUrl(path: string, params: Params | undefined, injectDataset: boolean): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const merged: Params = { ...params };
  if (injectDataset && merged.dataset === undefined) {
    merged.dataset = DEFAULT_DATASET;
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return `${FLOODWATCH_API_BASE}${p}${qs ? `?${qs}` : ""}`;
}

/**
 * Fetch a typed JSON resource from the FloodWatch IoT API.
 *
 * - GET only (the API is read-only).
 * - No auth headers.
 * - `dataset` query param auto-injected from `FLOODWATCH_DATASET` unless `injectDataset: false`.
 * - 10 s timeout by default; supply `signal` to override or chain.
 * - Throws `FloodwatchFetchError` on non-OK responses.
 */
export async function floodwatchFetch<T>(path: string, opts: Opts = {}): Promise<T> {
  const { params, signal, timeoutMs = 10_000, injectDataset = true } = opts;
  const url = buildUrl(path, params, injectDataset);

  // Compose caller's signal with our own timeout signal so either can abort.
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const finalSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: finalSignal,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    throw new FloodwatchFetchError(`Failed to reach FloodWatch IoT API: ${reason}`, 0, "", url);
  }

  if (res.status === 204) {
    return undefined as unknown as T;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // FastAPI returns { detail: ... } or { error: ... } on failure.
    let message: string | undefined;
    try {
      const json = JSON.parse(text);
      message = json.detail ?? json.error ?? json.message;
    } catch {
      /* not JSON — fall through */
    }
    throw new FloodwatchFetchError(
      message ?? `GET ${path} → ${res.status}`,
      res.status,
      text,
      url,
    );
  }

  return res.json() as Promise<T>;
}

/**
 * Build the upstream SSE URL for the FloodWatch event stream. The SSE
 * proxy route handler uses this to know where to connect to.
 *
 * @param types Comma-separated event names. Defaults to the union the
 *              CRM map needs (no node_announce).
 * @param dataset Override the default dataset for this stream.
 */
export function buildStreamUrl(opts: { types?: string; dataset?: Dataset } = {}): string {
  const types =
    opts.types ??
    "heartbeat,flood_level,alert,node_online,node_offline,weather_update";
  const dataset = opts.dataset ?? DEFAULT_DATASET;
  const qs = new URLSearchParams({ types, dataset });
  return `${FLOODWATCH_API_BASE}/events/stream?${qs.toString()}`;
}
