// /auth/callback — server-rendered SSO landing.
//
// Two acceptable URL shapes during the migration window:
//
//   NEW   ?code=<opaque 32-byte URL-safe random>
//         The community login mints this code, stashes the token
//         bundle in Upstash for 60 s, and redirects here. We redeem
//         the code server-side (atomic GETDEL), verify the JWT
//         signature + role, set httpOnly cookies, redirect to
//         /dashboard. Tokens never appear in the URL bar.
//
//   LEGACY ?at=<token>&rt=<token>&u=<json>
//         The pre-redesign hand-off. Still accepted so any operator
//         already mid-handoff during a deploy lands safely. Removed
//         in a follow-up commit after a 7-day soak.
//
// Either path ends with a same-origin server-side `redirect()` —
// no client JS, no `useEffect`, no localStorage. The browser sees
// one final URL (`/dashboard` or `/login?error=…`) in history.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  authCookieOptions,
} from "@/lib/authCookies";
import {
  decodeJwtPayload,
  verifyJwtSignature,
} from "@/lib/jwtPayload";
import { isOperatorRole } from "@/lib/rbac";
import { redeemSsoCode } from "@/lib/sso";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SearchParams = {
  code?: string | string[];
  at?: string | string[];
  rt?: string | string[];
  u?: string | string[];
};

function first(v: string | string[] | undefined): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0) return v[0];
  return null;
}

async function setAuthCookies(args: {
  accessToken: string;
  refreshToken: string;
  exp: number | null;
}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const accessMaxAge = Math.max(
    60,
    args.exp !== null ? args.exp - nowSec : 60 * 60,
  );
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, args.accessToken, authCookieOptions(accessMaxAge));
  jar.set(
    REFRESH_COOKIE,
    args.refreshToken,
    authCookieOptions(60 * 60 * 24 * 7),
  );
}

async function verifyAndExtractRole(
  accessToken: string,
): Promise<
  | { ok: true; role: string | null; exp: number | null }
  | { ok: false; reason: "invalid" | "misconfigured" }
> {
  const secret = process.env.JWT_SECRET;
  if (secret) {
    const verified = await verifyJwtSignature(accessToken, secret);
    if (!verified.ok) return { ok: false, reason: "invalid" };
    return {
      ok: true,
      role:
        typeof verified.payload.role === "string"
          ? verified.payload.role
          : null,
      exp:
        typeof verified.payload.exp === "number" ? verified.payload.exp : null,
    };
  }
  // QA P0-1: refuse silent payload-only acceptance. Dev opt-in only.
  if (
    process.env.ALLOW_PAYLOAD_ONLY_AUTH === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    const decoded = decodeJwtPayload(accessToken);
    if (!decoded) return { ok: false, reason: "invalid" };
    return {
      ok: true,
      role: typeof decoded.role === "string" ? decoded.role : null,
      exp: typeof decoded.exp === "number" ? decoded.exp : null,
    };
  }
  console.error(
    "[auth/callback] JWT_SECRET not set; refusing to set cookies. " +
      "Set JWT_SECRET on Vercel to match the Java backend secret.",
  );
  return { ok: false, reason: "misconfigured" };
}

export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  const code = first(params.code);
  const at = first(params.at);
  const rt = first(params.rt);
  // `u` is the legacy URL-encoded user JSON; we no longer rely on it
  // (the JWT carries everything the role gate needs), but we still
  // accept the URL shape so legacy redirects don't 404.

  // ── New path: ?code=<sso code> ─────────────────────────────
  if (code) {
    const payload = await redeemSsoCode(code);
    if (payload === null) {
      // Unknown / expired / already redeemed.
      redirect("/login?error=sso_expired");
    }
    const verified = await verifyAndExtractRole(payload.accessToken);
    if (!verified.ok) {
      // Distinguish the misconfig (JWT_SECRET missing on Vercel) from
      // a genuinely invalid bundle. The community login page shows
      // different banners + the misconfig pings ops via Vercel logs.
      redirect(
        verified.reason === "misconfigured"
          ? "/login?error=misconfigured"
          : "/login?error=sso_failed",
      );
    }
    if (!isOperatorRole(verified.role)) {
      redirect("/login?error=role");
    }
    await setAuthCookies({
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      exp: verified.exp,
    });
    redirect("/dashboard");
  }

  // ── Legacy path: ?at=&rt=&u= ───────────────────────────────
  if (at && rt) {
    const verified = await verifyAndExtractRole(at);
    if (!verified.ok) {
      redirect(
        verified.reason === "misconfigured"
          ? "/login?error=misconfigured"
          : "/login?error=callback",
      );
    }
    if (!isOperatorRole(verified.role)) {
      redirect("/login?error=role");
    }
    await setAuthCookies({
      accessToken: at,
      refreshToken: rt,
      exp: verified.exp,
    });
    redirect("/dashboard");
  }

  // Neither shape provided → back to login.
  redirect("/login?error=callback");
}
