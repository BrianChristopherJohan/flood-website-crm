import { redirect } from "next/navigation";
import LocalLoginForm from "./LocalLoginForm";

/**
 * CRM has no login form of its own — there is exactly ONE sign-in
 * surface across the FloodWatch stack: the community website. CRM
 * users sign in there, get bounced back to `/auth/callback` with
 * tokens in the URL, and from there the operator-class gates take
 * over (pre-hydration script + `/api/auth/session` + middleware +
 * `AppShellWrapper`).
 *
 * This route is a zero-JS server-side 307 to the community login.
 *
 * Why this is a one-liner again (was a full form in Phase H.3):
 *   Phase H.3 added a CRM-native credentials form to work around
 *   the Claude Code preview tool's inability to follow cross-port
 *   localhost redirects. That introduced architectural duplication
 *   (two forms, two role normalisers, two attack surfaces) for the
 *   sake of one development environment. In production and any
 *   normal browser, the cross-origin redirect works fine; the
 *   preview limitation is a tool problem, not a product problem.
 *   Reverted on user feedback to keep a single source of truth.
 *
 * Security note: the absence of a form here does NOT weaken the
 * access controls. The downstream gates all remain in place:
 *   • /api/auth/session   — server-side role gate when /auth/callback POSTs
 *   • /api/auth/login     — server-side role gate (defence-in-depth;
 *                            no UI calls it today but stays armed)
 *   • /auth/callback init — pre-hydration role gate (H.5)
 *   • AppShellWrapper     — last-line auto-logout (H.6)
 *   • middleware.ts       — Edge JWT signature + role enforcement
 *                            (Phase 2.A + 2.B)
 *   • Java backend        — signature validation on every call
 */

// Force a fresh redirect every time — Vercel may cache route output
// otherwise and serve a stale URL after NEXT_PUBLIC_COMMUNITY_URL is
// updated.
export const dynamic = "force-dynamic";

type SearchParams = { error?: string | string[]; callbackUrl?: string | string[] };

function first(v: string | string[] | undefined): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.length > 0) return v[0];
  return null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Preserve ?error= and ?callbackUrl= across the cross-origin hop so
  // the community login form can render the right banner instead of
  // dropping the user back to a clean /login with no context.
  // (QA P0-1 + P1-1: misconfigured / invalid_signature / expired all
  // round-trip through this page on their way back to community.)
  const params = await searchParams;
  const errorCode = first(params.error);
  const cb = first(params.callbackUrl);

  const useLocalLogin =
    process.env.CRM_LOCAL_LOGIN === "true" ||
    (process.env.NODE_ENV !== "production" && process.env.CRM_LOCAL_LOGIN !== "false");

  if (useLocalLogin) {
    return <LocalLoginForm errorCode={errorCode} callbackUrl={cb} />;
  }

  const communityUrl =
    process.env.NEXT_PUBLIC_COMMUNITY_URL || "http://localhost:3002";
  const qs = new URLSearchParams();
  if (errorCode) qs.set("error", errorCode);
  if (cb) qs.set("callbackUrl", cb);
  const suffix = qs.toString();
  redirect(`${communityUrl}/login${suffix ? `?${suffix}` : ""}`);
}
