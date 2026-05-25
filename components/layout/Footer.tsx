"use client";

import Image from "next/image";
import Link from "next/link";

import logo from "@/public/images/logo.png";
import { usePermissions } from "@/lib/hooks/usePermissions";
import type { Permission } from "@/lib/permissions";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { TranslationKey } from "@/lib/i18n/translations";

type FooterLink = {
  label: string;
  href: string;
  /** Omit for links visible to every signed-in user (e.g. account). */
  permission?: Permission;
};

const navigationSections: { titleKey: TranslationKey; links: FooterLink[] }[] = [
  {
    titleKey: "footer.main",
    links: [
      { label: "Dashboard", href: "/dashboard", permission: "dashboard.view" },
      { label: "Sensors", href: "/sensors", permission: "sensors.view" },
      { label: "Flood Map", href: "/map", permission: "map.view" },
    ],
  },
  {
    titleKey: "footer.insights",
    links: [
      { label: "Analytics", href: "/analytics", permission: "analytics.view" },
      { label: "Alerts", href: "/alerts", permission: "alerts.view" },
      { label: "News & Blog", href: "/blog", permission: "blog.manage" },
    ],
  },
  {
    titleKey: "nav.management",
    links: [
      { label: "Role Management", href: "/roles", permission: "roles.manage" },
      { label: "Account Settings", href: "/admin" },
    ],
  },
];

// Footer link href → translation key (falls back to the English label).
const FOOTER_LINK_KEY: Record<string, TranslationKey> = {
  "/dashboard": "nav.dashboard",
  "/sensors": "nav.sensors",
  "/map": "nav.map",
  "/analytics": "nav.analytics",
  "/alerts": "nav.alerts",
  "/blog": "nav.news",
  "/roles": "nav.roles",
  "/admin": "nav.account",
};

const socialLinks = [
  {
    label: "Facebook",
    href: "https://www.facebook.com/",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    ),
  },
  {
    label: "X (Twitter)",
    href: "https://x.com/",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    label: "Instagram",
    href: "https://www.instagram.com/",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
      </svg>
    ),
  },
];

export default function Footer() {
  const { can } = usePermissions();
  const { t } = useLanguage();

  const visibleSections = navigationSections
    .map((section) => ({
      ...section,
      links: section.links.filter((link) => !link.permission || can(link.permission)),
    }))
    .filter((section) => section.links.length > 0);

  // Colour palette references shared FloodWatch footer tokens (defined
  // once in lib/theme/tokens.css). Identical to the community site so
  // the brand bar at the bottom is consistent across both products.
  return (
    <footer style={{ background: "var(--color-footer-bg)", color: "var(--color-footer-fg)" }}>
      {/* Main Footer Content */}
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-10">
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-5">
          {/* Brand Section */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-pure-white p-1.5">
                <Image
                  src={logo}
                  alt="Pop Up Advertising And Information Enterprise"
                  width={44}
                  height={44}
                />
              </div>
              <div>
                <p className="text-base font-bold text-pure-white leading-tight">
                  Pop Up Advertising
                </p>
                <p className="text-[11px] uppercase tracking-wider text-pure-white/70 leading-tight">
                  &amp; Information Enterprise
                </p>
              </div>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-pure-white/80">
              Real-time flood monitoring and early warning system powered by IoT
              sensors across Sabah. Protecting communities through smart
              advertising and information services.
            </p>
            {/* Social Links */}
            <div className="mt-6 flex gap-3">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={social.label}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-pure-white/10 text-pure-white transition hover:bg-pure-white/20"
                >
                  {social.icon}
                </a>
              ))}
            </div>
          </div>

          {/* Navigation Links */}
          {visibleSections.map((section) => (
            <div key={section.titleKey}>
              <h3 className="text-xs font-bold uppercase tracking-wider text-pure-white/50">
                {t(section.titleKey)}
              </h3>
              <ul className="mt-4 space-y-3">
                {section.links.map((link) => {
                  const linkKey = FOOTER_LINK_KEY[link.href];
                  return (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-sm font-medium text-pure-white/90 transition hover:text-pure-white hover:underline"
                      >
                        {linkKey ? t(linkKey) : link.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        {/* Contact Info Bar */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-6 rounded-2xl bg-pure-white/10 px-6 py-4 text-sm text-pure-white/90">
          <div className="flex items-center gap-2">
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-4 w-4 text-pure-white/60"
            >
              <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
            </svg>
            <span>popupadvertisingandinfromation@gmail.com</span>
          </div>
          <div className="flex items-center gap-2">
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-4 w-4 text-pure-white/60"
            >
              <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
            </svg>
            <span>popupadvertisingandinfromation@gmail.com</span>
          </div>
          <div className="flex items-center gap-2">
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-4 w-4 text-pure-white/60"
            >
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
            </svg>
            <span>Lot 71, 3rd Floor, Block H, Asia City, 88000 Kota Kinabalu, Sabah</span>
          </div>
        </div>
      </div>

      {/* Bottom Copyright Bar */}
      <div className="border-t border-pure-white/10 bg-dark-charcoal/20">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-4 sm:flex-row sm:px-6 lg:px-10">
          <div className="flex items-center gap-4 text-xs text-pure-white/60">
            <Link href="#" className="transition hover:text-pure-white">
              Privacy Policy
            </Link>
            <span>•</span>
            <Link href="#" className="transition hover:text-pure-white">
              Terms of Service
            </Link>
            <span>•</span>
            <Link href="#" className="transition hover:text-pure-white">
              Cookie Policy
            </Link>
          </div>
          <p className="text-sm font-medium text-pure-white">
            © {new Date().getFullYear()} Pop Up Advertising And Information Enterprise. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

