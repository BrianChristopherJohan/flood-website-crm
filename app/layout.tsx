import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { cookies } from "next/headers";
import "./globals.css";
import AppShellWrapper from "@/components/layout/AppShellWrapper";
import { ThemeProvider } from "@/lib/ThemeContext";
import { AuthProvider } from "@/lib/AuthContext";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import { IoTEventProvider } from "@/components/providers/IoTEventProvider";
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
    // Browser tab favicon. We removed app/favicon.ico (it had a stale,
    // non-brand glyph baked in from an earlier iteration). Next.js
    // auto-serves app/icon.png at /icon.png, which is the proper logo,
    // so we point every icon slot at it and let browsers rasterise it
    // to whatever size they need for the tab.
    icon: [{ url: "/icon.png", type: "image/png" }],
    shortcut: [{ url: "/icon.png" }],
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
          NOTE — `auth-callback-init` Script was removed (2026-05-19).
          It previously mirrored token-handoff URL params into
          localStorage before React hydration. Tokens no longer travel
          in URL params: the new SSO handoff redeems an opaque
          ?code=<32B> server-side in `/auth/callback/page.tsx` and
          sets httpOnly cookies. AuthContext now hydrates from
          GET /api/auth/me on the cookie path. See plan addendum
          "Login + RBAC Redesign (2026-05-19)".
        */}

        <ThemeProvider>
          <LanguageProvider>
            <AuthProvider>
              <IoTEventProvider>
                <AppShellWrapper>{children}</AppShellWrapper>
                <Toaster
                  position="top-right"
                  toastOptions={{
                    duration: 4000,
                    style: { borderRadius: "10px", fontSize: "14px" },
                  }}
                />
              </IoTEventProvider>
            </AuthProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
