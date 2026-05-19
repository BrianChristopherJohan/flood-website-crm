// GET /api/auth/me
//
// Returns the current CRM user — backs the cookie-based auth model.
// The legacy login flow stashed the user blob in localStorage from
// the pre-hydration `auth-callback-init` script; we're removing that
// path. AuthContext now hydrates from this endpoint on mount.
//
// Steps:
//   1. Read the httpOnly access-token cookie. No cookie → 401.
//   2. Verify the JWT signature when JWT_SECRET is configured;
//      otherwise check payload structure + exp. (Matches the
//      defence-in-depth model the middleware uses.)
//   3. Re-validate the role server-side via the canonical RBAC
//      module — a non-operator-class token gets 403 + cookies
//      cleared. (Belt-and-suspenders: middleware would already
//      have bounced them, but /api/auth/me is also reachable from
//      same-origin scripts and we want one source of truth.)
//   4. Fetch displayName / avatarUrl from Java GET /profile. Cache
//      the response in Upstash for 30 s keyed by user id, so we
//      don't pay the Railway warm-up tax on every page hydrate.
//   5. Return { user: { id, email, displayName, avatarUrl, role, roleLabel } }.

import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
} from "@/lib/authCookies";
import {
  decodeJwtPayload,
  verifyJwtSignature,
} from "@/lib/jwtPayload";
import { javaFetch } from "@/lib/javaApi";
import { isOperatorRole, normalizeRoleKey, roleToDisplayLabel } from "@/lib/rbac";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";
// Node runtime — we call Upstash + Java from here. The middleware
// runs on Edge; /api/auth/me does not.
export const runtime = "nodejs";

type JavaProfile = {
  id?: string;
  email?: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  role?: string | null;
  phone?: string | null;
  locationLabel?: string | null;
  avatarUrl?: string | null;
};

type MeResponse = {
  user: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
    /** Canonical role key (ADMIN, OPERATIONS_MANAGER, …). */
    role: string;
    /** Display label (Admin, Operations Manager, …). */
    roleLabel: string;
  };
  /**
   * QA P0-7: when the Java backend is unreachable (Railway cold start,
   * Neon outage, network blip), we synthesise a minimal profile from
   * the JWT claims so the user can still navigate the shell. Setting
   * this flag tells AuthContext to render a yellow "service starting"
   * banner with a retry button instead of silently showing a blank
   * avatar + missing name (which looks like the system is broken).
   *
   * `false` / absent means the response is authoritative.
   */
  synthesized?: boolean;
};

function unauthenticated(reason: string): NextResponse {
  const res = NextResponse.json(
    { error: "not_authenticated", reason },
    { status: 401 },
  );
  // Clear any stale cookies so a forged/expired token can't keep
  // bouncing off the gate forever.
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { error: "not_authenticated", reason: "no_cookie" },
      { status: 401 },
    );
  }

  // ── 1. Verify JWT (QA P0-1 — fail closed without secret) ─────
  const secret = process.env.JWT_SECRET;
  let payload: ReturnType<typeof decodeJwtPayload> = null;
  if (secret) {
    const verified = await verifyJwtSignature(token, secret);
    if (!verified.ok) {
      // Distinct codes so the client knows whether to clear cookies
      // (invalid signature) or just retry (expired during cold start).
      return unauthenticated(
        verified.reason === "expired"
          ? "expired"
          : verified.reason === "invalid-signature"
            ? "invalid_signature"
            : "malformed",
      );
    }
    payload = verified.payload;
  } else if (
    process.env.ALLOW_PAYLOAD_ONLY_AUTH === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    // Opt-in dev fallback. Java's signature verification on /profile
    // is still the final wall against forgery — this just lets local
    // dev work without copying the secret around.
    payload = decodeJwtPayload(token);
    if (!payload) return unauthenticated("malformed");
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) {
      return unauthenticated("expired");
    }
  } else {
    // No secret AND not opted-in: refuse rather than silently bypass.
    // Logs the misconfig so ops can fix it.
    console.error(
      "[auth/me] JWT_SECRET is not set; refusing the request. " +
        "Set it on the Vercel project (Production + Preview) to match " +
        "the Java backend's JWT_SECRET. To enable a dev-only payload-" +
        "only fallback, set ALLOW_PAYLOAD_ONLY_AUTH=true with NODE_ENV!=production.",
    );
    return NextResponse.json(
      { error: "misconfigured", reason: "missing_jwt_secret" },
      { status: 503 },
    );
  }

  // ── 2. Role gate ──────────────────────────────────────────────
  const rawRole = typeof payload?.role === "string" ? payload.role : null;
  if (!isOperatorRole(rawRole)) {
    const res = NextResponse.json(
      { error: "not_authorised", reason: "role" },
      { status: 403 },
    );
    res.cookies.delete(ACCESS_COOKIE);
    res.cookies.delete(REFRESH_COOKIE);
    return res;
  }

  // ── 3. Profile cache lookup ───────────────────────────────────
  const sub = typeof payload?.sub === "string" ? payload.sub : null;
  if (!sub) return unauthenticated("malformed_sub");

  const cacheKey = `me:${sub}`;
  let profile: JavaProfile | null = null;
  let synthesized = false;
  try {
    profile = await redis.get<JavaProfile>(cacheKey);
  } catch {
    // Upstash transient; fall through and hit Java directly.
  }

  if (!profile) {
    try {
      profile = await javaFetch<JavaProfile>("/profile", { token });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401 || status === 403) {
        // Java rejected the token — treat as unauthenticated.
        return unauthenticated("java_rejected");
      }
      // QA P0-7: synthesise a minimal profile from the JWT claims so
      // the user can still navigate while Java is warming up. Mark
      // the response so AuthContext shows a "service starting" banner
      // and a retry button instead of leaving the operator with a
      // blank avatar + no name (which looks like the system is broken).
      profile = {
        id: sub,
        email: typeof payload?.email === "string" ? payload.email : "",
        displayName: null,
        avatarUrl: null,
      };
      synthesized = true;
    }
    // Best-effort cache write — but don't poison the cache with a
    // synthesised profile or future requests would keep getting the
    // half-baked response even after Java recovers.
    if (!synthesized) {
      try {
        await redis.set(cacheKey, JSON.stringify(profile), { ex: 30 });
      } catch {
        // ignore
      }
    }
  }

  // ── 4. Compose response ───────────────────────────────────────
  const roleKey = normalizeRoleKey(rawRole) ?? "CUSTOMER";
  const roleLabel = roleToDisplayLabel(rawRole);

  const fromNames = [profile?.firstName, profile?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const displayName =
    profile?.displayName || fromNames || profile?.email || "";

  const body: MeResponse = {
    user: {
      id: profile?.id ?? sub,
      email: profile?.email ?? (typeof payload?.email === "string" ? payload.email : ""),
      displayName,
      avatarUrl: profile?.avatarUrl ?? null,
      role: roleKey,
      roleLabel,
    },
    ...(synthesized ? { synthesized: true as const } : {}),
  };
  return NextResponse.json(body);
}
