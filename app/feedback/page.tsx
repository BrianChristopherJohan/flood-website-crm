"use client";

/**
 * CRM-side UAT feedback page. Mirrors /feedback on the community site.
 * Same form, same backend, same Postgres table.
 */

import { useAuth } from "@/lib/AuthContext";
import UatSurveyForm, { type SurveyRole } from "@/components/survey/UatSurveyForm";

export default function CrmFeedbackPage() {
  const { user } = useAuth();

  // Role inference for CRM staff. Admins/operators see the full set
  // (admin questions + the user-perspective questions, since they often
  // also use the public site). Pure customers — if they ever land here —
  // see the user set only.
  const role: SurveyRole = (() => {
    const r = (user?.role ?? "").toLowerCase();
    if (r === "admin" || r === "operations manager" || r === "operations_manager")  return "both";
    if (r === "field technician" || r === "ngo volunteer" || r === "viewer")        return "admin";
    return "user";
  })();

  return (
    <section className="space-y-6">
      <header>
        <p
          className="text-[11px] font-semibold uppercase tracking-[0.2em]"
          style={{ color: "var(--color-brand-soft, var(--color-brand))" }}
        >
          UAT Feedback Survey
        </p>
        <h1 className="mt-2 text-3xl font-semibold" style={{ color: "var(--color-text)" }}>
          Help us improve FloodWatch.
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
          As an internal user of the CRM, your feedback shapes which admin
          tools we build next. The same survey is shown to community users —
          we&apos;ll review the responses together and prioritise the highest-
          impact items each sprint.
        </p>
      </header>

      <UatSurveyForm role={role} source="crm" />
    </section>
  );
}
