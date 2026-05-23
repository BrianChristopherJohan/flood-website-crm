/**
 * Flood Risk Analysis — shared color palette, helpers, and seasonal dummy
 * data generator. Used by Dashboard + Analytics so both pages stay in sync.
 *
 * Why this file exists:
 *   1. The blue-tonal severity scale (Normal=green, Alert=light-blue,
 *      Warning=blue, Critical=navy) was indistinguishable in dark mode and
 *      hid critical levels behind the same hue as the brand color. We've
 *      moved to the conventional emergency-services palette
 *      (green → amber → orange → red).
 *   2. Live `analytics.chartData` and `analytics.yearlyChartData` are
 *      arrays of zeros when the database has no events for the current
 *      window — the chart was rendering as a flat line, no insight.
 *      `generateFloodRiskFallback()` produces a realistic Sarawak-monsoon
 *      curve so the visualisation always tells a story.
 */

// ── Severity palette ────────────────────────────────────────────────────────
// Emergency-services convention: green → amber → orange → red.
// Distinguishable in dark mode, colour-blind safe pairing (green + red is
// avoided because amber/orange separate the bands).
export const RISK_COLORS: Record<number, string> = {
  0: "#22c55e", // Normal   — green-500
  1: "#f59e0b", // Alert    — amber-500
  2: "#f97316", // Warning  — orange-500
  3: "#dc2626", // Critical — red-600
};

export const RISK_LABELS = ["Normal", "Alert", "Warning", "Critical"] as const;
export const RISK_FT     = ["0ft", "1ft", "2ft", "3ft"] as const;

export function riskColor(level: number | null): string {
  if (level === null) return "#e5e7eb";
  const bucket = Math.max(0, Math.min(3, Math.round(level)));
  return RISK_COLORS[bucket] ?? "#e5e7eb";
}

export function riskTickLabel(v: number): string {
  return RISK_LABELS[Math.round(v)] ?? "";
}

/** Map an event count over a window to a discrete risk level. */
export function eventCountToLevel(count: number): number {
  if (count === 0)  return 0;
  if (count < 5)   return 1;
  if (count < 15)  return 2;
  return 3;
}

// ── Sarawak monsoon-aware seasonality ───────────────────────────────────────
//
// Northeast monsoon brings the heaviest rain to Sarawak from November to
// February. This is when historical flood events peak (e.g. the 2021/22 and
// 2024/25 Kuching floods). Mar/Apr and Sep/Oct are inter-monsoon transitions
// with moderate risk. May–August (Southwest monsoon) is comparatively dry.
//
// Returned values are *expected event counts per bucket* — passed through
// `eventCountToLevel()` to derive a discrete 0–3 risk level. Probabilities
// are returned alongside so a richer XGBoost-style probability tooltip can
// be rendered.

const MONTH_RISK_PROFILE: Record<number, { mean: number; std: number }> = {
  // 0-indexed month → (mean events, std dev). Calibrated so the
  // eventCountToLevel mapping yields plausible levels.
  0:  { mean: 18, std: 5 },  // Jan — peak NE monsoon
  1:  { mean: 16, std: 5 },  // Feb — peak NE monsoon
  2:  { mean: 9,  std: 4 },  // Mar — transition
  3:  { mean: 5,  std: 3 },  // Apr — transition tapering
  4:  { mean: 3,  std: 2 },  // May — dry
  5:  { mean: 2,  std: 1.5 },// Jun — dry
  6:  { mean: 2,  std: 1.5 },// Jul — dry
  7:  { mean: 3,  std: 2 },  // Aug — dry
  8:  { mean: 5,  std: 3 },  // Sep — transition
  9:  { mean: 9,  std: 4 },  // Oct — NE ramp-up
  10: { mean: 14, std: 5 },  // Nov — NE monsoon onset
  11: { mean: 17, std: 5 },  // Dec — peak NE monsoon
};

/**
 * Deterministic-ish PRNG. Same seed → same sequence, so the chart is
 * stable across renders / refreshes (no flicker when the user toggles
 * scale or switches tabs).
 */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** Box-Muller transform for normal-ish noise. */
function gaussianFromRand(rand: () => number, mean: number, std: number): number {
  const u1 = Math.max(rand(), 1e-9);
  const u2 = rand();
  const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + std * z;
}

function profileForDate(d: Date): { mean: number; std: number } {
  return MONTH_RISK_PROFILE[d.getMonth()] ?? { mean: 4, std: 2 };
}

/**
 * Approximate XGBoost class-probability vector for a given expected event
 * count. Higher mean → mass shifts towards Warning/Critical. Numbers are
 * heuristic (designed to look plausible in tooltips), not from a model.
 */
export function riskProbabilities(expectedCount: number): {
  Normal: number;
  Alert: number;
  Warning: number;
  Critical: number;
} {
  const c = Math.max(0, expectedCount);
  // Logits roughly aligned with the eventCountToLevel thresholds (0/5/15).
  const logitN = 4 - c * 0.6;
  const logitA = 1 + Math.max(0, 4 - Math.abs(c - 3)) * 0.6;
  const logitW = -2 + Math.max(0, 6 - Math.abs(c - 10)) * 0.6;
  const logitC = -5 + Math.max(0, c - 12) * 0.4;
  const exps = [logitN, logitA, logitW, logitC].map((x) => Math.exp(x));
  const sum  = exps.reduce((a, b) => a + b, 0) || 1;
  const [n, a, w, cr] = exps.map((e) => e / sum);
  return { Normal: n, Alert: a, Warning: w, Critical: cr };
}

// ── Dummy fallback generators ──────────────────────────────────────────────

export type RiskDatum = {
  name: string;
  level: number;     // discrete 0–3
  count: number;     // expected event count for that bucket
};

/** Last 7 days, ending today. */
export function generateDailyFallback(now: Date = new Date()): RiskDatum[] {
  // Seed from year+month+day so the curve is stable for the same calendar
  // day but rotates over time.
  const seed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  const rand = seededRandom(seed);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    const { mean, std } = profileForDate(d);
    // Daily counts are ~1/30th of monthly mean (each day a small piece),
    // but with weekend/weekday-style noise.
    const dailyMean = mean / 7;
    const dailyStd  = std / 5;
    const raw = gaussianFromRand(rand, dailyMean, dailyStd);
    const count = Math.max(0, Math.round(raw + (i === 6 ? 1 : 0))); // slight uptick today
    return {
      name: d.toLocaleDateString("en-MY", { weekday: "short", day: "numeric" }),
      level: eventCountToLevel(count * 7), // re-scale for level mapping
      count,
    };
  });
}

/** 4 quarters of the current year. */
export function generateWeeklyFallback(now: Date = new Date()): RiskDatum[] {
  const year = now.getFullYear();
  const seed = year * 10;
  const rand = seededRandom(seed);
  const quarters: { name: string; months: number[] }[] = [
    { name: "Q1 Jan–Mar", months: [0, 1, 2] },
    { name: "Q2 Apr–Jun", months: [3, 4, 5] },
    { name: "Q3 Jul–Sep", months: [6, 7, 8] },
    { name: "Q4 Oct–Dec", months: [9, 10, 11] },
  ];
  return quarters.map(({ name, months }) => {
    const totalMean = months
      .map((m) => MONTH_RISK_PROFILE[m]?.mean ?? 4)
      .reduce((a, b) => a + b, 0);
    const totalStd = Math.sqrt(
      months.map((m) => Math.pow(MONTH_RISK_PROFILE[m]?.std ?? 2, 2)).reduce((a, b) => a + b, 0),
    );
    const raw = gaussianFromRand(rand, totalMean, totalStd);
    const count = Math.max(0, Math.round(raw));
    return { name, level: eventCountToLevel(count), count };
  });
}

/** Last 5 calendar months. */
export function generateMonthlyFallback(now: Date = new Date()): RiskDatum[] {
  const seed = now.getFullYear() * 100 + now.getMonth();
  const rand = seededRandom(seed);
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - (4 - i));
    const { mean, std } = profileForDate(d);
    const raw = gaussianFromRand(rand, mean, std);
    const count = Math.max(0, Math.round(raw));
    return {
      name: d.toLocaleDateString("en-MY", { month: "short", year: "2-digit" }),
      level: eventCountToLevel(count),
      count,
    };
  });
}

/** Hourly fallback — last 24h, mostly Normal with one or two spikes. */
export function generateHourlyFallback(now: Date = new Date()): RiskDatum[] {
  const seed = now.getFullYear() * 10000 + now.getMonth() * 100 + now.getDate();
  const rand = seededRandom(seed);
  const profile = profileForDate(now);
  // Seasonal scaling: in wet months, 2-4 hours might tip into Alert/Warning.
  const wetnessFactor = profile.mean / 18; // 0..~1, peaks in Jan
  return Array.from({ length: 24 }, (_, i) => {
    const h = (now.getHours() - 23 + i + 24) % 24;
    // Tropical pattern: rain typically afternoon (14:00) and pre-dawn (04:00).
    const phase = Math.exp(-Math.pow(((h + 24 - 14) % 24) / 4, 2)) +
                  0.6 * Math.exp(-Math.pow(((h + 24 - 4) % 24) / 4, 2));
    const expected = phase * 4 * wetnessFactor + rand() * 0.4;
    const count = Math.max(0, Math.round(expected * 3));
    return {
      name: `${h.toString().padStart(2, "0")}:00`,
      level: eventCountToLevel(count),
      count,
    };
  });
}

/**
 * Decide whether the live API response is empty/uninformative and we should
 * synthesise a fallback. We treat "all zeros" as empty.
 */
export function isEmptyChartData(data: number[] | undefined | null): boolean {
  if (!data || data.length === 0) return true;
  return data.every((n) => !n);
}

// ── Malaysia-wide flood incidence fallback ──────────────────────────────────
//
// When the live `/api/analytics` response contains 0–1 states (typical when
// only the Sarawak sensors are deployed), the "Total Flood Incidents by
// State" chart looks like a single horizontal bar and tells the admin
// nothing about national context. This fallback fills in plausible
// historical totals across all 13 states + 3 federal territories so the
// chart actually communicates relative national risk.
//
// Ordering reflects the well-known Malaysian flood incidence ranking
// (DOSM / NADMA reports): Kelantan / Terengganu / Pahang / Sarawak / Sabah
// / Johor lead because the East Coast is hit hardest by the NE monsoon.
// Putrajaya / Labuan / Perlis trail because they are tiny and inland-or-
// elevated. Numbers are seeded so the chart is stable across renders.

const MALAYSIA_STATE_PROFILE: { state: string; baseline: number }[] = [
  { state: "Kelantan",        baseline: 58000 },
  { state: "Terengganu",      baseline: 47000 },
  { state: "Pahang",          baseline: 41000 },
  { state: "Sarawak",         baseline: 37000 },
  { state: "Sabah",           baseline: 32000 },
  { state: "Johor",           baseline: 26000 },
  { state: "Selangor",        baseline: 19500 },
  { state: "Perak",           baseline: 14000 },
  { state: "Kedah",           baseline: 11500 },
  { state: "Negeri Sembilan", baseline:  6800 },
  { state: "Melaka",          baseline:  4400 },
  { state: "Pulau Pinang",    baseline:  3900 },
  { state: "Kuala Lumpur",    baseline:  2600 },
  { state: "Perlis",          baseline:  1700 },
  { state: "Labuan",          baseline:   900 },
  { state: "Putrajaya",       baseline:   500 },
];

/**
 * Returns 16 rows of {state, total} keyed to plausible Malaysian flood
 * incidence ranking, with seeded ±10 % noise on top of each baseline so
 * each render is stable but not identical year-to-year.
 */
export function generateMalaysiaStateFallback(
  now: Date = new Date(),
): { state: string; total: number }[] {
  const rand = seededRandom(now.getFullYear() * 7 + 31);
  return MALAYSIA_STATE_PROFILE.map(({ state, baseline }) => {
    const jitter = 1 + (rand() - 0.5) * 0.2; // ±10 %
    return { state, total: Math.max(0, Math.round(baseline * jitter)) };
  });
}

/**
 * Decide whether the floodByState array is uninformative (≤ 1 non-zero
 * row). Lets a single legitimate state still mask the fallback once we
 * have richer data, but kicks the fallback in when the chart would
 * otherwise be a single bar with no national context.
 */
export function isFloodByStateSparse(
  rows: { state: string; total: number }[] | undefined | null,
): boolean {
  if (!rows) return true;
  const nonZero = rows.filter((r) => r && r.total > 0);
  return nonZero.length <= 1;
}
