import type { NextConfig } from "next";

// `output: "standalone"` is required for Docker (copies only runtime files).
// Vercel sets VERCEL=1 and manages its own output format — standalone must be off there.
const nextConfig: NextConfig = {
  output: process.env.VERCEL ? undefined : "standalone",
  turbopack: {
    root: process.cwd(),
  },

  // Local preview tooling (Claude Code preview MCP, some IDE proxies) hits
  // the dev server on 127.0.0.1 rather than `localhost`. Next 16's default
  // cross-origin guard blocks HMR/RSC traffic from those hosts and silently
  // breaks client hydration. Allow the loopback variants explicitly in dev.
  allowedDevOrigins: ["127.0.0.1", "localhost"],

  // Some browsers / PWAs request `/icon` (no extension). Serve the PNG from `public/`.
  async rewrites() {
    return [{ source: "/icon", destination: "/icon.png" }];
  },

  // QA P1-11 — Baseline security headers for the operator console.
  // The CRM is more lockable than the community site (no third-party
  // embeds beyond Google Maps + Recharts), so we can be stricter:
  // - HSTS:              1 year + preload.
  // - X-Frame-Options:   DENY — operators should never embed the CRM
  //                      in another site; eliminates clickjacking surface
  //                      on sensitive actions (role changes, broadcasts).
  // - X-Content-Type-Options: nosniff — same justification as community.
  // - Referrer-Policy:   strict-origin-when-cross-origin — keeps paths
  //                      like `/admin/users/123` out of upstream
  //                      referrer logs when an operator clicks an
  //                      external link.
  // - Permissions-Policy: deny camera + microphone; geolocation `self`
  //                      because /map uses the browser geolocation API
  //                      to centre on the operator.
  // - Cross-Origin-Opener-Policy: same-origin — popup isolation.
  // - CSP:               Not set globally yet (Recharts inline styles
  //                      + Google Maps would need a tuned policy).
  //                      Captured as a follow-up.
  async headers() {
    const securityHeaders = [
      {
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains; preload",
      },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(self), interest-cohort=()",
      },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ];
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
