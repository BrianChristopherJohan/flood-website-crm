/**
 * Shared CRM surface tokens. Both /dashboard and /analytics render the
 * same kind of rounded card with a bordered light/dark variant, and the
 * same kind of section heading. Centralising these here keeps the two
 * pages visually identical so a future tweak only has to happen once.
 *
 * Rule: any new card or panel on a CRM page MUST use crmCardClass and
 * crmHeadingClass. If you need a variant, extend it here, not inline.
 */

/** Outer wrapper for every dashboard / analytics panel. */
export function crmCardClass(isDark: boolean, extra = ""): string {
  return [
    "rounded-3xl border p-5 shadow-sm transition-colors",
    isDark ? "border-dark-border bg-dark-card" : "border-light-grey bg-pure-white",
    extra,
  ].filter(Boolean).join(" ");
}

/** Primary section heading inside a panel. */
export function crmHeadingClass(isDark: boolean): string {
  return [
    "text-lg font-semibold tracking-tight transition-colors",
    isDark ? "text-dark-text" : "text-dark-charcoal",
  ].join(" ");
}

/** Small uppercase subtitle that sits under a heading. */
export function crmSubheadingClass(isDark: boolean): string {
  return [
    "text-xs uppercase tracking-wide transition-colors",
    isDark ? "text-dark-text-muted" : "text-dark-charcoal/60",
  ].join(" ");
}

/** Inner ash card used for stats and nested rows. */
export function crmInnerCardClass(isDark: boolean): string {
  return [
    "rounded-2xl border transition-colors",
    isDark ? "border-dark-border bg-dark-bg" : "border-light-grey bg-pure-white",
  ].join(" ");
}
