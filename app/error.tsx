"use client";

// QA P1-5 — Top-level error boundary for the operator console.

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[crm/error] unhandled exception", error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-very-light-grey px-6 text-center dark:bg-dark-bg">
      <p className="text-sm font-semibold uppercase tracking-widest text-dark-charcoal/60 dark:text-dark-text-muted">
        Something went wrong
      </p>
      <h1 className="mt-3 text-3xl font-bold text-dark-charcoal sm:text-4xl dark:text-dark-text">
        Unexpected error
      </h1>
      <p className="mt-3 max-w-md text-sm text-dark-charcoal/70 sm:text-base dark:text-dark-text-secondary">
        The page couldn&apos;t be rendered. You can try again, or head back to
        the dashboard. If this keeps happening, escalate to your administrator
        with the reference below.
      </p>
      {error?.digest && (
        <p className="mt-2 font-mono text-xs text-dark-charcoal/60 dark:text-dark-text-muted">
          Reference: {error.digest}
        </p>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-xl bg-primary-blue px-5 py-2.5 text-sm font-semibold text-pure-white shadow-sm hover:bg-primary-blue/90"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="rounded-xl border border-light-grey px-5 py-2.5 text-sm font-semibold text-dark-charcoal hover:bg-black/5 dark:border-dark-border dark:text-dark-text dark:hover:bg-white/5"
        >
          Dashboard
        </Link>
      </div>
    </main>
  );
}
