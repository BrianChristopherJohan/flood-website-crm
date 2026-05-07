import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { cookies } from "next/headers";
import "./globals.css";
import AppShellWrapper from "@/components/layout/AppShellWrapper";
import { ThemeProvider } from "@/lib/ThemeContext";
import { AuthProvider } from "@/lib/AuthContext";
import { Toaster } from "react-hot-toast";
import { getThemeInitScript } from "@/lib/theme/themeScript";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Flood Management CRM",
  description:
    "Command center for IoT flood sensors, live alerts, and predictive analytics.",
  icons: {
    // Browser tab favicon — Next.js auto-serves app/favicon.ico at /favicon.ico,
    // app/icon.png at /icon.png, app/apple-icon.png at /apple-icon.png.
    // We also list them explicitly so legacy crawlers and older browsers that
    // ignore the auto metadata still find them.
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png" },
    ],
    shortcut: [{ url: "/favicon.ico" }],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const t = cookieStore.get("flood-theme")?.value;
  const htmlClassName =
    t === "dark" ? "dark" : t === "light" ? "" : undefined;

  return (
    <html lang="en" suppressHydrationWarning className={htmlClassName}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Script
          id="flood-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: getThemeInitScript() }}
        />
        {/*
          Runs SYNCHRONOUSLY before React hydration.
          On /auth/callback, reads ?at=&rt=&u= from the URL and writes the
          correct CRM-shaped user into localStorage before AuthContext mounts.
        */}
        <Script id="auth-callback-init" strategy="beforeInteractive">{`
          (function() {
            try {
              if (window.location.pathname !== '/auth/callback') return;
              var params = new URLSearchParams(window.location.search);
              var at = params.get('at');
              var rt = params.get('rt');
              var u  = params.get('u');
              if (!at || !rt || !u || at === 'undefined' || rt === 'undefined') return;
              var raw = JSON.parse(decodeURIComponent(u));
              // Normalize JWT/API role string → canonical CRM display label.
              // Mirrors lib/permissions.ts → roleFromJwtOrApiRole. Inlined here
              // because this script runs before React hydration.
              var ROLE_MAP = {
                'ADMIN': 'Admin',
                'OPERATIONS_MANAGER': 'Operations Manager',
                'OPERATIONSMANAGER': 'Operations Manager',
                'FIELD_TECHNICIAN': 'Field Technician',
                'FIELDTECHNICIAN': 'Field Technician',
                'NGO_VOLUNTEER': 'NGO Volunteer',
                'NGOVOLUNTEER': 'NGO Volunteer',
                'VIEWER': 'Viewer',
                'CUSTOMER': 'Customer'
              };
              var roleKey = String(raw.role || 'CUSTOMER').trim().toUpperCase().replace(/\\s+/g, '_');
              var crmUser = {
                id: raw.id,
                name: raw.displayName || raw.name || raw.email,
                email: raw.email,
                role: ROLE_MAP[roleKey] || 'Customer',
                status: 'active',
                twoFactorEnabled: false,
                passwordLastChanged: new Date().toISOString(),
                notifications: true,
                emailAlerts: true,
                smsAlerts: false
              };
              localStorage.setItem('flood_access_token',  decodeURIComponent(at));
              localStorage.setItem('flood_refresh_token', decodeURIComponent(rt));
              localStorage.setItem('flood_auth_user',     JSON.stringify(crmUser));
              // Strip tokens from the URL bar so they don't linger in history.
              window.history.replaceState({}, '', '/auth/callback');
            } catch(e) {
              if (process.env.NODE_ENV !== 'production') console.error('[auth-callback] token init failed', e);
            }
          })();
        `}</Script>

        <ThemeProvider>
          <AuthProvider>
            <AppShellWrapper>{children}</AppShellWrapper>
            <Toaster
              position="top-right"
              toastOptions={{
                duration: 4000,
                style: { borderRadius: "10px", fontSize: "14px" },
              }}
            />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
