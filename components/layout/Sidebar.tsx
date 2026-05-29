"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { crmNavIconMap } from "@/components/layout/crmNavIconMap";
import { useTheme } from "@/lib/ThemeContext";
import { usePermissions } from "@/lib/hooks/usePermissions";
import type { AppNavIconKey } from "@/lib/permissions";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { TranslationKey } from "@/lib/i18n/translations";

type SidebarProps = {
  isCollapsed: boolean;
};

// Map each nav icon key to its translation key. Falls back to the
// item's English label if a key isn't listed here.
const NAV_LABEL_KEY: Partial<Record<AppNavIconKey, TranslationKey>> = {
  dashboard: "nav.dashboard",
  sensors: "nav.sensors",
  map: "nav.map",
  analytics: "nav.analytics",
  alerts: "nav.alerts",
  community: "nav.community",
  news: "nav.news",
  roles: "nav.roles",
  account: "nav.account",
  settings: "nav.settings",
};

export default function Sidebar({ isCollapsed }: SidebarProps) {
  const pathname = usePathname();
  const { isDark } = useTheme();
  const { accessibleNavItems } = usePermissions();
  const { t } = useLanguage();

  const mainItems = accessibleNavItems.filter((item) => item.section === "main");
  const managementItems = accessibleNavItems.filter((item) => item.section === "management");

  const renderNavItem = (item: (typeof accessibleNavItems)[number]) => {
    const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
    const ItemIcon = crmNavIconMap[item.iconKey];
    const labelKey = NAV_LABEL_KEY[item.iconKey];
    const label = labelKey ? t(labelKey) : item.label;

    return (
      <Link
        key={item.href + item.label}
        href={item.href}
        className={clsx(
          "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors",
          isCollapsed ? "justify-center" : "justify-start",
          isActive
            ? isDark
              ? "bg-primary-blue/20 text-primary-blue"
              : "bg-light-blue/60 text-primary-blue"
            : isDark
              ? "text-dark-text hover:bg-dark-border/50 hover:text-primary-blue"
              : "text-dark-charcoal hover:bg-light-blue/40 hover:text-primary-blue"
        )}
        aria-current={isActive ? "page" : undefined}
        title={isCollapsed ? label : undefined}
      >
        <ItemIcon
          className={clsx(
            "h-5 w-5 shrink-0",
            isActive
              ? "text-primary-blue"
              : isDark
                ? "text-dark-text-secondary"
                : "text-dark-charcoal"
          )}
        />
        {!isCollapsed && <span>{label}</span>}
      </Link>
    );
  };

  return (
    <aside
      className={clsx(
        "hidden md:flex flex-col border-r shadow-sm transition-all duration-200",
        isCollapsed ? "w-20" : "w-64",
        isDark
          ? "border-dark-border bg-dark-card"
          : "border-light-grey bg-pure-white"
      )}
    >
      <nav className="mt-4 flex flex-1 flex-col px-3">
        <div className="flex flex-col gap-2">
          {mainItems.map(renderNavItem)}
        </div>

        {managementItems.length > 0 && (
          <>
            <div
              className={clsx(
                "my-4 border-t",
                isDark ? "border-dark-border" : "border-light-grey"
              )}
            />

            {!isCollapsed && (
              <p
                className={clsx(
                  "mb-2 px-4 text-[10px] font-bold uppercase tracking-wider",
                  isDark ? "text-dark-text-muted" : "text-dark-charcoal/50"
                )}
              >
                {t("nav.management")}
              </p>
            )}

            <div className="flex flex-col gap-2 pb-6">
              {managementItems.map(renderNavItem)}
            </div>
          </>
        )}
      </nav>
    </aside>
  );
}
