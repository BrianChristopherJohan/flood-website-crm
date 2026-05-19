// QA P1-5 — Branded 404 page for the operator console.

import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-very-light-grey px-6 text-center dark:bg-dark-bg">
      <p className="text-sm font-semibold uppercase tracking-widest text-dark-charcoal/60 dark:text-dark-text-muted">
        404
      </p>
      <h1 className="mt-3 text-3xl font-bold text-dark-charcoal sm:text-4xl dark:text-dark-text">
        Page not found
      </h1>
      <p className="mt-3 max-w-md text-sm text-dark-charcoal/70 sm:text-base dark:text-dark-text-secondary">
        The page may have been moved or you don&apos;t have access to it. Use
        the navigation or jump back to the dashboard.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/dashboard"
          className="rounded-xl bg-primary-blue px-5 py-2.5 text-sm font-semibold text-pure-white shadow-sm hover:bg-primary-blue/90"
        >
          Go to dashboard
        </Link>
        <Link
          href="/alerts"
          className="rounded-xl border border-light-grey px-5 py-2.5 text-sm font-semibold text-dark-charcoal hover:bg-black/5 dark:border-dark-border dark:text-dark-text dark:hover:bg-white/5"
        >
          Alerts
        </Link>
      </div>
    </main>
  );
}
