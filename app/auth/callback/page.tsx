"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { roleFromJwtOrApiRole } from "@/lib/permissions";

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const at = params.get("at");
    const rt = params.get("rt");
    const u = params.get("u");

    if (!at || !rt || !u) {
      router.replace("/login");
      return;
    }

    try {
      const raw = JSON.parse(decodeURIComponent(u));

      // Transform community AuthUser → CRM User shape so AuthContext
      // reads it correctly. Critical: role must be capitalized ("Admin")
      // to match rolePermissions keys in lib/permissions.ts.
      const crmUser = {
        id: raw.id,
        name: raw.displayName || raw.name || raw.email,
        email: raw.email,
        role: roleFromJwtOrApiRole(String(raw.role ?? "CUSTOMER")),
        status: "active",
        twoFactorEnabled: false,
        passwordLastChanged: new Date().toISOString(),
        notifications: true,
        emailAlerts: true,
        smsAlerts: false,
      };

      localStorage.setItem("flood_access_token", decodeURIComponent(at));
      localStorage.setItem("flood_refresh_token", decodeURIComponent(rt));
      localStorage.setItem("flood_auth_user", JSON.stringify(crmUser));
      router.replace("/dashboard");
    } catch {
      router.replace("/login");
    }
  }, [params, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
      <div className="text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600 mx-auto mb-4" />
        <p className="text-sm text-gray-500">Setting up your session…</p>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}><p>Loading...</p></div>}>
      <CallbackInner />
    </Suspense>
  );
}
