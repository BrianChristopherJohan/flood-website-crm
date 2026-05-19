"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";

import { useAuth } from "@/lib/AuthContext";
import { useTheme } from "@/lib/ThemeContext";
import { canAccessPage, isOperatorRole } from "@/lib/permissions";
import { SensorStreamProvider } from "@/components/providers/SensorStreamProvider";

// Dynamically import AppShell with no SSR to prevent prerender issues
const AppShell = dynamic(() => import("./AppShell"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center bg-very-light-grey">
      <div className="flex flex-col items-center gap-4">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-light-grey border-t-primary-blue" />
        <p className="text-sm font-medium text-dark-charcoal/70">Loading...</p>
      </div>
    </div>
  ),
});

type AppShellWrapperProps = {
  children: React.ReactNode;
};

// Public routes that don't require authentication
const publicRoutes = [
  "/login",
  "/auth/callback",
];

// Access Denied component
function AccessDenied() {
  const router = useRouter();
  
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6">
      <div className="rounded-3xl border border-primary-blue/30 bg-light-blue/20 p-8 text-center dark:border-primary-blue/20 dark:bg-primary-blue/10">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary-blue/20">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-8 w-8 text-primary-blue"
          >
            <path
              fillRule="evenodd"
              d="M12 1.5a5.25 5.25 0 00-5.25 5.25v3a3 3 0 00-3 3v6.75a3 3 0 003 3h10.5a3 3 0 003-3v-6.75a3 3 0 00-3-3v-3c0-2.9-2.35-5.25-5.25-5.25zm3.75 8.25v-3a3.75 3.75 0 10-7.5 0v3h7.5z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-dark-charcoal dark:text-dark-text">
          Access Denied
        </h2>
        <p className="mt-2 text-sm text-dark-charcoal/70 dark:text-dark-text-secondary">
          You do not have permission to access this page.
        </p>
        <p className="mt-1 text-xs text-dark-charcoal/50 dark:text-dark-text-muted">
          Contact your administrator if you believe this is an error.
        </p>
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          className="mt-6 rounded-xl bg-primary-blue px-6 py-2.5 text-sm font-semibold text-pure-white transition hover:bg-primary-blue/90"
        >
          Go to Dashboard
        </button>
      </div>
    </div>
  );
}

/**
 * Yellow "service starting" banner shown when AuthContext hydrated
 * with a synthesised profile (Java was unreachable, displayName +
 * avatarUrl missing). Surfaces the cold-start state to the operator
 * instead of leaving them with a blank-avatar shell that looks like
 * the system is broken. (QA P0-7.)
 */
function ServiceWarmingBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <span>
        Backend is starting up. Your name and avatar may take a few seconds
        to load.
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg border border-amber-400 bg-white/60 px-2.5 py-1 text-xs font-semibold hover:bg-white dark:border-amber-600 dark:bg-amber-900/40 dark:hover:bg-amber-900/60"
      >
        Retry
      </button>
    </div>
  );
}

export default function AppShellWrapper({ children }: AppShellWrapperProps) {
  const {
    user,
    isAuthenticated,
    isLoading,
    logout,
    isProfileSynthesized,
    refreshProfile,
  } = useAuth();
  const { isDark } = useTheme();
  const pathname = usePathname();
  const router = useRouter();

  const isPublicRoute = publicRoutes.includes(pathname);

  // Check if user has access to the current page
  const hasPageAccess = useMemo(() => {
    if (!user?.role) return false;
    return canAccessPage(user.role, pathname);
  }, [user?.role, pathname]);

  // Last-line operator-class gate (H.6 in the hardening plan).
  //
  // The /api/auth/login proxy (H.4) and the /auth/callback init script
  // (H.5) reject Customer + unknown roles before tokens ever reach
  // this component. This is the defence-in-depth catch for any path
  // they could miss — e.g. someone who manually writes localStorage
  // via DevTools, or a Customer-role token left in localStorage from
  // a prior install that pre-dates H.5. We log them out hard.
  const isNonOperator =
    !!user && !!user.role && !isOperatorRole(user.role);

  useEffect(() => {
    if (isLoading) return;
    if (isNonOperator) {
      // Wipe the session and bounce to /login with a friendly code.
      // logout() clears localStorage, cancels the silent-refresh timer,
      // and resets AuthContext state.
      logout();
      router.replace("/login?error=role");
      return;
    }
    if (!isAuthenticated && !isPublicRoute) {
      router.push("/login");
    } else if (isAuthenticated && isPublicRoute) {
      // Only redirect operators — non-operator authenticated users
      // are already evicted by the isNonOperator branch above.
      const role = user?.role?.toLowerCase();
      if (role === "admin") {
        router.push("/dashboard");
      }
    }
  }, [
    isAuthenticated,
    isLoading,
    isPublicRoute,
    isNonOperator,
    logout,
    router,
    pathname,
    user,
  ]);

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-very-light-grey dark:bg-dark-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-light-grey border-t-primary-blue dark:border-dark-border" />
          <p className="text-sm font-medium text-dark-charcoal/70 dark:text-dark-text-secondary">Loading...</p>
        </div>
      </div>
    );
  }

  // Don't show AppShell for public routes (login)
  if (isPublicRoute) {
    return <>{children}</>;
  }

  // Will redirect to login
  if (!isAuthenticated) {
    return null;
  }

  // Will be evicted to /login?error=role by the effect above. Render
  // a placeholder so we don't flash the AccessDenied page or the
  // full AppShell to a Customer (or unknown-role) account before
  // the logout completes.
  if (isNonOperator) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-very-light-grey dark:bg-dark-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-light-grey border-t-primary-blue dark:border-dark-border" />
          <p className="text-sm font-medium text-dark-charcoal/70 dark:text-dark-text-secondary">
            Redirecting…
          </p>
        </div>
      </div>
    );
  }

  // Show AppShell with access denied message if user doesn't have permission
  if (!hasPageAccess) {
    return (
      <SensorStreamProvider isDark={isDark}>
        <AppShell>
          <AccessDenied />
        </AppShell>
      </SensorStreamProvider>
    );
  }

  // Wrap the authed shell with the real-time flood-alert stream so the
  // top-right notification dock + audio chime + browser Notification
  // surface flood alerts on every CRM page (Dashboard, Sensors, Map, etc.)
  return (
    <SensorStreamProvider isDark={isDark}>
      <AppShell>
        {isProfileSynthesized && (
          <ServiceWarmingBanner onRetry={refreshProfile} />
        )}
        {children}
      </AppShell>
    </SensorStreamProvider>
  );
}
