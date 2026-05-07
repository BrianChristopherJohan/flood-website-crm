"use client";

/**
 * Shared UAT survey form rendered on both /feedback (community) and
 * /feedback (CRM). The same questionnaire — the *role* prop selects which
 * sections the user sees:
 *
 *   role="user"   → general + user-specific
 *   role="admin"  → general + admin-specific
 *   role="both"   → general + both (e.g. an admin who's also a community
 *                  member and wants to leave feedback as both)
 *
 * Submissions POST to /api/surveys/uat which forwards to the Java
 * service (community/CRM both proxy to the same backend so all responses
 * land in one Postgres table). The CRM has an additional admin page
 * that reads back from /api/admin/surveys/uat and exports as CSV.
 *
 * NB: this same file is duplicated verbatim in flood-website-crm —
 * keeping it identical so feedback-form questions don't drift between
 * apps. When you change one, change the other.
 */

import { useMemo, useState } from "react";
import toast from "react-hot-toast";

// ── Schema ─────────────────────────────────────────────────────────────────

export type SurveyRole = "user" | "admin" | "both";

type Choice = { value: string; label: string };

const FUTURE_FEATURE_CHOICES: Choice[] = [
  { value: "sms-alerts",          label: "SMS alerts" },
  { value: "whatsapp-bot",        label: "WhatsApp alert bot" },
  { value: "voice-call-alerts",   label: "Automated voice-call alerts" },
  { value: "live-rainfall",       label: "Live rainfall radar" },
  { value: "evac-routing",        label: "Evacuation route suggestions" },
  { value: "ai-forecast",         label: "Multi-day AI flood forecast" },
  { value: "multi-language",      label: "BM / Mandarin / Tamil / Iban UI" },
  { value: "offline-mode",        label: "Offline-first mobile app" },
  { value: "school-mode",         label: "School / kindergarten broadcast" },
  { value: "nps-sharing",         label: "Public dashboards for NGOs" },
];

const BUSINESS_FIT_CHOICES: Choice[] = [
  { value: "meets",   label: "Meets the original requirement" },
  { value: "partial", label: "Partial — some gaps" },
  { value: "misses",  label: "Misses the mark" },
];

// ── Submit payload type ────────────────────────────────────────────────────

export type SurveySubmitPayload = {
  role: SurveyRole;
  source: "community" | "crm";
  satisfactionScore: number;
  recommendScore: number;
  businessFit: string;
  appVersion?: string;
  userAgent?: string;
  answers: Record<string, unknown>;
};

// ── Sub-components ─────────────────────────────────────────────────────────

function Stars({
  value,
  onChange,
  ariaLabel = "satisfaction",
}: {
  value: number;
  onChange: (n: number) => void;
  ariaLabel?: string;
}) {
  const [hover, setHover] = useState(0);
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex items-center gap-1.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = (hover || value) >= n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => onChange(n)}
            className="text-2xl transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:rounded"
          >
            <span style={{ color: filled ? "#f59e0b" : "var(--color-border-strong, #484f58)" }}>
              {filled ? "★" : "☆"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function NpsSlider({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: 11 }, (_, n) => {
          const active = value === n;
          const tone = n <= 6 ? "#dc2626" : n <= 8 ? "#f59e0b" : "#22c55e";
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              className="h-9 w-9 rounded-lg border text-sm font-semibold tabular-nums transition-all focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              style={{
                background: active ? tone : "transparent",
                color: active ? "#fff" : "var(--color-text)",
                borderColor: active ? tone : "var(--color-border)",
              }}
              aria-pressed={active}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[11px]" style={{ color: "var(--color-muted)" }}>
        <span>0 — Not likely</span>
        <span>10 — Extremely likely</span>
      </div>
    </div>
  );
}

function PillRadio({
  options,
  value,
  onChange,
  name,
}: {
  options: Choice[];
  value: string;
  onChange: (v: string) => void;
  name: string;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className="rounded-full border px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            style={{
              background: active ? "var(--color-brand)" : "var(--color-card)",
              color: active ? "#fff" : "var(--color-text)",
              borderColor: active ? "var(--color-brand)" : "var(--color-border)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function PillCheckbox({
  options,
  values,
  onChange,
}: {
  options: Choice[];
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (v: string) => {
    if (values.includes(v)) onChange(values.filter((x) => x !== v));
    else onChange([...values, v]);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = values.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            aria-pressed={active}
            className="rounded-full border px-3.5 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            style={{
              background: active ? "var(--color-brand-soft, var(--color-brand))" : "var(--color-card)",
              color: active ? "#fff" : "var(--color-text-secondary)",
              borderColor: active ? "var(--color-brand-soft, var(--color-brand))" : "var(--color-border)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Form section wrapper ───────────────────────────────────────────────────

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-2xl border p-6 shadow-sm"
      style={{
        background: "var(--color-card)",
        borderColor: "var(--color-border)",
      }}
    >
      <h3 className="text-base font-semibold" style={{ color: "var(--color-text)" }}>
        {title}
      </h3>
      {hint && (
        <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
          {hint}
        </p>
      )}
      <div className="mt-5 space-y-6">{children}</div>
    </section>
  );
}

function Question({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium" style={{ color: "var(--color-text)" }}>
        {label}
        {required && <span style={{ color: "#dc2626" }}> *</span>}
      </label>
      <div className="mt-3">{children}</div>
    </div>
  );
}

const TEXTAREA_STYLE: React.CSSProperties = {
  width: "100%",
  minHeight: 88,
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid var(--color-border)",
  background: "var(--color-input-bg, var(--color-card))",
  color: "var(--color-text)",
  fontSize: 14,
  lineHeight: 1.55,
  resize: "vertical",
  fontFamily: "inherit",
};

// ── Main form ──────────────────────────────────────────────────────────────

export interface UatSurveyFormProps {
  role: SurveyRole;
  source: "community" | "crm";
  /** Optional override for where the form POSTs to (defaults to /api/surveys/uat). */
  endpoint?: string;
  onSuccess?: () => void;
}

export default function UatSurveyForm({
  role,
  source,
  endpoint = "/api/surveys/uat",
  onSuccess,
}: UatSurveyFormProps) {
  // ── Top-level required fields ───────────────────────────────────────────
  const [satisfaction, setSatisfaction] = useState(0);
  const [recommend, setRecommend]       = useState(-1);
  const [businessFit, setBusinessFit]   = useState("");

  // ── Open-ended (everyone) ────────────────────────────────────────────────
  const [worksWell, setWorksWell]       = useState("");
  const [needsImprove, setNeedsImprove] = useState("");
  const [bugsSeen, setBugsSeen]         = useState("");
  const [futureFeatures, setFutureFeatures] = useState<string[]>([]);
  const [futureOther, setFutureOther]       = useState("");
  const [finalThoughts, setFinalThoughts]   = useState("");

  // ── User-specific ───────────────────────────────────────────────────────
  const [usageFreq,   setUsageFreq]   = useState("");
  const [alertSpeed,  setAlertSpeed]  = useState("");
  const [feedHelped,  setFeedHelped]  = useState("");

  // ── Admin-specific ──────────────────────────────────────────────────────
  const [dataAccurate, setDataAccurate] = useState("");
  const [modWorkflow,  setModWorkflow]  = useState("");
  const [missingAdmin, setMissingAdmin] = useState("");
  const [securityCx,   setSecurityCx]   = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const showUser  = role === "user"  || role === "both";
  const showAdmin = role === "admin" || role === "both";

  const canSubmit = useMemo(
    () => satisfaction >= 1 && recommend >= 0 && businessFit !== "",
    [satisfaction, recommend, businessFit],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) {
      toast.error("Please answer the required questions (★ marked).");
      return;
    }
    setSubmitting(true);
    try {
      const payload: SurveySubmitPayload = {
        role,
        source,
        satisfactionScore: satisfaction,
        recommendScore: recommend,
        businessFit,
        appVersion: typeof process !== "undefined" ? process.env.NEXT_PUBLIC_APP_VERSION : undefined,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        answers: {
          // Flat, JSON-friendly keys — same shape we agreed on with the
          // backend. New questions just add new keys; the JSONB column
          // tolerates schema drift.
          satisfaction,
          recommend,
          businessFit,
          worksWell,
          needsImprove,
          bugsSeen,
          futureFeatures,
          futureOther,
          finalThoughts,
          ...(showUser ? {
            usageFreq, alertSpeed, feedHelped,
          } : {}),
          ...(showAdmin ? {
            dataAccurate, modWorkflow, missingAdmin, securityCx,
          } : {}),
        },
      };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Submit failed (${res.status})`);
      }
      toast.success("Thank you! Your feedback was recorded.");
      setDone(true);
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div
        className="rounded-3xl border p-10 text-center shadow-sm"
        style={{ background: "var(--color-card)", borderColor: "var(--color-border)" }}
      >
        <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "rgba(34,197,94,0.18)", color: "#22c55e" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-7 w-7">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="text-xl font-bold" style={{ color: "var(--color-text)" }}>Thank you for your feedback.</h2>
        <p className="mt-2 text-sm" style={{ color: "var(--color-text-secondary)" }}>
          Your responses help us prioritise improvements before we deploy more
          sensors across Malaysia.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* ── Overall ── */}
      <Section
        title="Overall experience"
        hint="A quick read on how the product feels right now."
      >
        <Question label="How satisfied are you with FloodWatch overall?" required>
          <Stars value={satisfaction} onChange={setSatisfaction} />
        </Question>
        <Question label="How likely are you to recommend us to a friend or colleague?" required>
          <NpsSlider value={recommend} onChange={setRecommend} />
        </Question>
        <Question label="Does the product meet the original business requirement?" required>
          <PillRadio
            options={BUSINESS_FIT_CHOICES}
            value={businessFit}
            onChange={setBusinessFit}
            name="business-fit"
          />
        </Question>
      </Section>

      {/* ── User-specific ── */}
      {showUser && (
        <Section
          title="As an end-user"
          hint="Resident / community member experience."
        >
          <Question label="How often do you check FloodWatch?">
            <PillRadio
              options={[
                { value: "daily",      label: "Daily" },
                { value: "weekly",     label: "Weekly" },
                { value: "alerts",     label: "Only when alerted" },
                { value: "rarely",     label: "Rarely" },
              ]}
              value={usageFreq}
              onChange={setUsageFreq}
              name="usage-freq"
            />
          </Question>
          <Question label="When an alert was issued, how quickly did it reach you?">
            <PillRadio
              options={[
                { value: "<30s",   label: "Under 30 seconds" },
                { value: "1-5m",   label: "1–5 minutes" },
                { value: "5-30m",  label: "5–30 minutes" },
                { value: ">30m",   label: "Over 30 minutes" },
                { value: "missed", label: "I never received it" },
                { value: "n/a",    label: "I haven't seen one yet" },
              ]}
              value={alertSpeed}
              onChange={setAlertSpeed}
              name="alert-speed"
            />
          </Question>
          <Question label="Did the community feed help you make a decision (evacuate, divert, prepare)?">
            <PillRadio
              options={[
                { value: "yes",       label: "Yes, clearly" },
                { value: "sometimes", label: "Sometimes" },
                { value: "no",        label: "No" },
              ]}
              value={feedHelped}
              onChange={setFeedHelped}
              name="feed-helped"
            />
          </Question>
        </Section>
      )}

      {/* ── Admin-specific ── */}
      {showAdmin && (
        <Section
          title="As an admin / staff"
          hint="CRM operator / NGO coordinator experience."
        >
          <Question label="Is the dashboard data accurate enough to act on?">
            <PillRadio
              options={[
                { value: "yes",     label: "Yes" },
                { value: "mostly",  label: "Mostly" },
                { value: "no",      label: "No — too noisy" },
              ]}
              value={dataAccurate}
              onChange={setDataAccurate}
              name="data-accurate"
            />
          </Question>
          <Question label="Is the moderation workflow (posts, comments, broadcasts) efficient?">
            <PillRadio
              options={[
                { value: "yes",         label: "Yes" },
                { value: "needs-work",  label: "Could be better" },
                { value: "no",          label: "No — too many clicks" },
              ]}
              value={modWorkflow}
              onChange={setModWorkflow}
              name="mod-workflow"
            />
          </Question>
          <Question label="What admin features are missing for your day-to-day?">
            <textarea
              value={missingAdmin}
              onChange={(e) => setMissingAdmin(e.target.value)}
              placeholder="e.g. bulk-deactivate stale nodes, role-based broadcast templates…"
              style={TEXTAREA_STYLE}
            />
          </Question>
          <Question label="Any data security or privacy concerns?">
            <textarea
              value={securityCx}
              onChange={(e) => setSecurityCx(e.target.value)}
              placeholder="Optional. Sensitive concerns can be flagged privately to security@floodwatch.my."
              style={TEXTAREA_STYLE}
            />
          </Question>
        </Section>
      )}

      {/* ── Open-ended (everyone) ── */}
      <Section title="What works, what doesn't, what's next">
        <Question label="What's working well for you?">
          <textarea
            value={worksWell}
            onChange={(e) => setWorksWell(e.target.value)}
            placeholder="Be specific — &quot;the daily-digest email is the best part&quot;."
            style={TEXTAREA_STYLE}
          />
        </Question>
        <Question label="What needs the most improvement?">
          <textarea
            value={needsImprove}
            onChange={(e) => setNeedsImprove(e.target.value)}
            placeholder="Slow page loads, confusing copy, broken links — anything specific."
            style={TEXTAREA_STYLE}
          />
        </Question>
        <Question label="Did you encounter any bugs?">
          <textarea
            value={bugsSeen}
            onChange={(e) => setBugsSeen(e.target.value)}
            placeholder="Please include the page / browser / approximate time if you can."
            style={TEXTAREA_STYLE}
          />
        </Question>
        <Question label="Which features should we add next?">
          <PillCheckbox
            options={FUTURE_FEATURE_CHOICES}
            values={futureFeatures}
            onChange={setFutureFeatures}
          />
          <input
            type="text"
            value={futureOther}
            onChange={(e) => setFutureOther(e.target.value)}
            placeholder="Other — type your own"
            className="mt-3 w-full rounded-xl border px-4 py-2.5 text-sm"
            style={{
              background: "var(--color-input-bg, var(--color-card))",
              borderColor: "var(--color-border)",
              color: "var(--color-text)",
            }}
          />
        </Question>
        <Question label="Any final thoughts?">
          <textarea
            value={finalThoughts}
            onChange={(e) => setFinalThoughts(e.target.value)}
            placeholder="Optional — anything else you'd like the team to know."
            style={TEXTAREA_STYLE}
          />
        </Question>
      </Section>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          Required fields marked with <span style={{ color: "#dc2626" }}>*</span>.
          Submissions are stored in our Postgres database and reviewed by the
          product team.
        </p>
        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="inline-flex items-center gap-2 rounded-full px-7 py-3 text-sm font-semibold text-white transition disabled:opacity-50"
          style={{
            background: canSubmit ? "var(--color-brand)" : "var(--color-border-strong, var(--color-border))",
          }}
        >
          {submitting ? "Submitting…" : "Submit feedback"}
          {!submitting && <span aria-hidden>→</span>}
        </button>
      </div>
    </form>
  );
}
