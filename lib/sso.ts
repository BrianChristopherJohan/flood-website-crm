// ──────────────────────────────────────────────────────────────────────
// lib/sso.ts — SSO handoff helpers (CRM side)
//
// Counterpart to `flood-website-community/lib/sso.ts`. The community
// mints opaque codes; this module redeems them — one-shot,
// server-side, signature-verified.
// ──────────────────────────────────────────────────────────────────────

import { redis } from "@/lib/redis";

/** Same shape the community module stores. */
export type SsoPayload = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl?: string;
    role: string;
  };
  expiresAt: string;
};

const KEY_PREFIX = "sso:";

/**
 * Atomically read + delete the handoff bundle. Returns `null` if the
 * code is unknown, already redeemed, or expired (Redis TTL elapsed).
 *
 * Uses `GETDEL` so the key is gone the instant we read it — replay of
 * the same `?code=` URL gets nothing. This is the only secrecy gate
 * for the handoff itself; the JWT signature check on top is the wall
 * against tampering with the bundle contents.
 */
export async function redeemSsoCode(code: string): Promise<SsoPayload | null> {
  if (!code || typeof code !== "string") return null;
  // Basic sanity: codes from `mintSsoCode` are 43 chars of base64url.
  // Reject anything wildly out of band so we don't waste a Redis
  // round-trip on obviously bad input.
  if (code.length < 16 || code.length > 128) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(code)) return null;

  // The Redis adapter exposes `getdel` matching the Redis 6.2+
  // GETDEL command. Returns the previous value or null.
  let raw: unknown;
  try {
    raw = await redis.getdel(KEY_PREFIX + code);
  } catch (err) {
    console.error("[sso/redeem] redis getdel failed", err);
    return null;
  }
  if (raw == null) return null;

  // The redis adapter JSON-decodes string values back to objects
  // automatically when the stored payload was JSON. Handle both shapes for safety.
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as SsoPayload;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") {
    return raw as SsoPayload;
  }
  return null;
}
