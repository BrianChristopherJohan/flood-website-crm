"use client";

import { useState } from "react";

import { roleFromJwtOrApiRole } from "@/lib/permissions";

type LocalLoginFormProps = {
  errorCode: string | null;
  callbackUrl: string | null;
};

type LoginResponse = {
  session?: {
    accessToken?: string;
    refreshToken?: string;
  };
  user?: {
    id?: string;
    displayName?: string;
    email?: string;
    role?: string;
    avatarUrl?: string | null;
  };
  error?: string;
};

const ERROR_COPY: Record<string, string> = {
  expired: "Your session expired. Please sign in again.",
  role: "This account is not authorised for CRM access.",
  invalid_signature: "Your session could not be verified. Please sign in again.",
  malformed: "Your session was invalid. Please sign in again.",
  misconfigured: "Local auth needs JWT_SECRET or ALLOW_PAYLOAD_ONLY_AUTH=true.",
  callback: "The sign-in callback failed. Please try again.",
  sso_expired: "The sign-in link expired. Please sign in again.",
};

function storeLocalSession(data: LoginResponse) {
  const accessToken = data.session?.accessToken;
  const refreshToken = data.session?.refreshToken;
  const email = data.user?.email ?? "";
  const id = data.user?.id ?? email;

  if (accessToken) localStorage.setItem("flood_access_token", accessToken);
  if (refreshToken) localStorage.setItem("flood_refresh_token", refreshToken);

  const localUser = {
    id,
    name: data.user?.displayName || email,
    email,
    role: roleFromJwtOrApiRole(data.user?.role ?? "CUSTOMER"),
    status: "active",
    avatarUrl: data.user?.avatarUrl ?? undefined,
    twoFactorEnabled: false,
    passwordLastChanged: new Date().toISOString(),
    notifications: true,
    emailAlerts: true,
    smsAlerts: false,
  };
  localStorage.setItem("flood_auth_user", JSON.stringify(localUser));

  const session = {
    id: `session-${Date.now()}`,
    device: "Local development",
    browser: navigator.userAgent.includes("Chrome") ? "Chrome" : "Browser",
    location: "Localhost",
    lastActive: new Date().toISOString(),
    isCurrent: true,
  };
  localStorage.setItem(`flood_sessions_${id}`, JSON.stringify([session]));
}

export default function LocalLoginForm({
  errorCode,
  callbackUrl,
}: LocalLoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    errorCode ? ERROR_COPY[errorCode] ?? "Please sign in again." : null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json().catch(() => ({}))) as LoginResponse;
      if (!res.ok) {
        setError(data.error ?? `Login failed (${res.status})`);
        return;
      }

      storeLocalSession(data);
      window.location.assign(callbackUrl || "/dashboard");
    } catch {
      setError("Could not reach the CRM auth API. Check that the backend is running.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-very-light-grey px-4 py-10 dark:bg-dark-bg">
      <section className="w-full max-w-md rounded-3xl border border-light-grey bg-pure-white p-6 shadow-sm dark:border-dark-border dark:bg-dark-card">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary-blue">
            Local CRM Login
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-dark-charcoal dark:text-dark-text">
            Flood Management
          </h1>
          <p className="mt-2 text-sm text-dark-charcoal/65 dark:text-dark-text-secondary">
            Development fallback for running the CRM on localhost without the community app.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-2xl border border-status-warning-1/40 bg-status-warning-1/10 px-4 py-3 text-sm font-medium text-status-warning-2">
            {error}
          </div>
        )}

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="text-sm font-semibold text-dark-charcoal dark:text-dark-text">
              Email
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-xl border border-light-grey bg-pure-white px-4 py-2.5 text-sm text-dark-charcoal outline-none transition focus:border-primary-blue dark:border-dark-border dark:bg-dark-bg dark:text-dark-text"
              autoComplete="email"
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-dark-charcoal dark:text-dark-text">
              Password
            </span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-xl border border-light-grey bg-pure-white px-4 py-2.5 text-sm text-dark-charcoal outline-none transition focus:border-primary-blue dark:border-dark-border dark:bg-dark-bg dark:text-dark-text"
              autoComplete="current-password"
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-primary-blue px-4 py-2.5 text-sm font-semibold text-pure-white transition hover:bg-primary-blue/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-xs leading-relaxed text-dark-charcoal/55 dark:text-dark-text-muted">
          Production still uses the community login. This screen only appears when
          {" "}CRM_LOCAL_LOGIN=true.
        </p>
      </section>
    </main>
  );
}
