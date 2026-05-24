// FEAT-03 — Broadcasts page loading skeleton.
// Mirrors the compose panel + recent-broadcasts list layout so the
// page doesn't jump when data loads.

import { Skeleton } from "@/components/ui/Skeleton";

export default function BroadcastsLoading() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="mt-2 h-4 w-80" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* Compose panel */}
        <div className="rounded-2xl border border-light-grey bg-pure-white p-5 shadow-sm dark:border-dark-border dark:bg-dark-card">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-4 h-10 w-full" />
          <Skeleton className="mt-3 h-28 w-full" />
          <div className="mt-4 flex gap-2">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>

        {/* Recent broadcasts list */}
        <div className="rounded-2xl border border-light-grey bg-pure-white p-5 shadow-sm dark:border-dark-border dark:bg-dark-card">
          <Skeleton className="h-5 w-36" />
          <div className="mt-4 space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl border border-light-grey p-3 dark:border-dark-border">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="mt-2 h-3 w-1/2" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
