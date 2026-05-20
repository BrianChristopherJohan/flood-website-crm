/**
 * lib/redis.ts — Redis client (server-only, Node runtime)
 *
 * Backed by `ioredis` (TCP) against a Railway Redis plugin. Replaces
 * the earlier `@upstash/redis` REST client.
 *
 * Why TCP / ioredis: every caller (cache-aside helpers, SSO redeem,
 * `/api/auth/me` cached profile lookup) runs in Vercel Node functions
 * — TCP is fine here. The CRM Edge middleware does NOT touch Redis,
 * so the Edge-incompatibility of TCP is a non-issue.
 *
 * Why we moved off Upstash REST: the project consolidated all
 * persistent infra on Railway (Postgres + Redis on the same plugin
 * dashboard), which removes a vendor + the manual env-var copying
 * that drifted twice this session (an extra `A` in the token survived
 * one paste and produced WRONGPASS 401s for an hour). With Railway,
 * services reference the plugin via `${{Redis.REDIS_URL}}` template
 * syntax — the URL substitutes at deploy time and follows credential
 * rotation automatically.
 *
 * Usage (unchanged from the previous Upstash-backed shape):
 *   import { redis, CACHE_TTL, withCache } from '@/lib/redis';
 *
 *   await redis.set('key', JSON.stringify(data), { ex: CACHE_TTL.nodes });
 *   const cached = await redis.get<string>('key');
 *   const oneShot = await redis.getdel<MyShape>('sso:abc');   // SSO redeem
 */

import IORedis, { type Redis as IORedisClient } from "ioredis";

let _client: IORedisClient | null = null;

/**
 * Returns the singleton ioredis client. Lazily instantiated so that
 * importing this module never throws — important during the Next.js
 * build phase where env vars may not be present in every step.
 */
function getClient(): IORedisClient {
  if (_client) return _client;
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      "REDIS_URL env var missing. Set it to the Railway Redis plugin " +
        "connection URL (use ${{Redis.REDIS_URL}} template ref in " +
        "production, redis://localhost:6379 locally if running a " +
        "self-hosted instance for tests).",
    );
  }
  _client = new IORedis(url, {
    lazyConnect: true,
    // Fail fast — default is 20 retries which would hang a request
    // for 20+ seconds in a transient outage.
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    connectTimeout: 5_000,
    retryStrategy: (attempt: number) => {
      if (attempt > 3) return null;
      return Math.min(attempt * 200, 1000);
    },
  });
  _client.on("error", (err) => {
    // Callers fail-open on cache errors, so we just log here.
    console.warn("[redis] connection error:", err.message);
  });
  return _client;
}

/** Options accepted by `redis.set()` — mirrors the @upstash/redis shape so
 *  existing callers don't need rewriting. */
type SetOptions = { ex?: number; nx?: boolean };

/**
 * Thin adapter that exposes the same method names + signatures as the
 * old `@upstash/redis` client, so every caller in the codebase keeps
 * working without changes. Internally maps to ioredis commands.
 */
export const redis = {
  /**
   * Read a key. Returns `null` if missing. If the stored value is
   * JSON, it's parsed to T; otherwise the raw string is returned
   * (cast to T). Mirrors the @upstash/redis behaviour where `get<T>`
   * auto-deserialises.
   */
  async get<T = unknown>(key: string): Promise<T | null> {
    const raw = await getClient().get(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  },

  /**
   * Set a key. Values are JSON-serialised unless already a string.
   * Supports `{ ex, nx }` exactly like the previous client.
   * Returns "OK" on success, null when an NX precondition fails.
   */
  async set(
    key: string,
    value: unknown,
    opts?: SetOptions,
  ): Promise<"OK" | null> {
    const serialised =
      typeof value === "string" ? value : JSON.stringify(value);
    const args: (string | number)[] = [];
    if (opts?.ex != null) args.push("EX", opts.ex);
    if (opts?.nx) args.push("NX");
    const c = getClient() as unknown as {
      set: (k: string, v: string, ...rest: (string | number)[]) => Promise<string | null>;
    };
    const result = await c.set(key, serialised, ...args);
    return result === "OK" ? "OK" : null;
  },

  /** Delete one or more keys. Returns the count deleted. */
  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return getClient().del(...keys);
  },

  /**
   * Atomic GET + DEL — used by the SSO redeem path. Railway Redis
   * (7.x) supports `GETDEL` natively (Redis 6.2+). Result is JSON-
   * parsed exactly like `get()`.
   */
  async getdel<T = unknown>(key: string): Promise<T | null> {
    const c = getClient() as unknown as {
      call: (cmd: string, ...args: (string | number)[]) => Promise<string | null>;
    };
    const raw = await c.call("GETDEL", key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  },

  /** Liveness probe — returns the literal string "PONG". */
  async ping(): Promise<string> {
    return getClient().ping();
  },
};

/** Backwards-compat shim for callers that use `getRedis()`. */
export function getRedis(): typeof redis {
  return redis;
}

/** Cache TTL constants (seconds). Same keys + values as before so the
 *  CRM callers (`/api/analytics`, `/api/blogs`, `/api/broadcasts`,
 *  `/api/nodes`, `/api/auth/me`) don't need rewriting. */
export const CACHE_TTL = {
  /** Sensor nodes — refresh every 30 s (near real-time) */
  nodes: 30,
  /** Analytics summary — refresh every 5 min */
  analytics: 300,
  /** Broadcasts list — refresh every 2 min */
  broadcasts: 120,
  /** Alert feed — refresh every 60 s */
  alerts: 60,
  /** Reports list — refresh every 2 min */
  reports: 120,
  /** Users list — refresh every 5 min */
  users: 300,
  /** Blogs list — refresh every 10 min */
  blogs: 600,
} as const;

/**
 * Cache-aside helper — tries Redis first, falls back to `fetcher`, then
 * writes the result back to Redis before returning.
 *
 * @example
 *   const nodes = await withCache('nodes:all', CACHE_TTL.nodes, () =>
 *     javaFetch<JavaSensorDto[]>('/sensors', { token })
 *   );
 */
export async function withCache<T>(
  key: string,
  ttl: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  try {
    const cached = await redis.get<T>(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }
  } catch {
    // Redis unavailable — fall through to fetcher (fail-open)
    console.warn(
      `[redis] cache read failed for key "${key}" — falling back to source`,
    );
  }

  const fresh = await fetcher();

  try {
    await redis.set(key, JSON.stringify(fresh), { ex: ttl });
  } catch {
    console.warn(`[redis] cache write failed for key "${key}"`);
  }

  return fresh;
}

/**
 * Invalidate one or more cache keys (e.g. after a mutation).
 *
 * @example
 *   await invalidate('broadcasts:all', 'analytics:summary');
 */
export async function invalidate(...keys: string[]): Promise<void> {
  try {
    if (keys.length > 0) await redis.del(...keys);
  } catch {
    console.warn("[redis] cache invalidation failed for keys:", keys);
  }
}
