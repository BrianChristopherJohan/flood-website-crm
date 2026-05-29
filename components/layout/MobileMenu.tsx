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

type MobileMenuProps = {
  isOpen: boolean;
  onClose: () => void;
};

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

function CloseIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      {...props}
    >
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
    </svg>
  );
}

export default function MobileMenu({ isOpen, onClose }: MobileMenuProps) {
  const pathname = usePathname();
  const { isDark } = useTheme();
  const { accessibleNavItems } = usePermissions();
  const { t } = useLanguage();

  const mainItems = accessibleNavItems.filter((item) => item.section === "main");
  const managementItems = accessibleNavItems.filter((item) => item.section === "management");

  if (!isOpen) return null;

  return (
    <>
      <div
        className={clsx(
          "fixed inset-0 z-40 backdrop-blur-sm md:hidden",
          isDark ? "bg-dark-bg/70" : "bg-dark-charcoal/50"
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className={clsx(
          "fixed inset-x-0 top-0 z-50 md:hidden",
          "transform transition-transform duration-300 ease-out",
          isOpen ? "translate-y-0" : "-translate-y-full"
        )}
      >
        <div
          className={clsx(
            "shadow-xl",
            isDark ? "bg-dark-card" : "bg-pure-white"
          )}
        >
          <div
            className={clsx(
              "flex items-center justify-between border-b px-4 py-4",
              isDark ? "border-dark-border" : "border-light-grey"
            )}
          >
            <p
              className={clsx(
                "text-lg font-semibold",
                isDark ? "text-dark-text" : "text-dark-charcoal"
              )}
            >
              Menu
            </p>
            <button
              type="button"
              onClick={onClose}
              className={clsx(
                "flex h-10 w-10 items-center justify-center rounded-xl transition",
                isDark
                  ? "text-dark-text hover:bg-dark-border hover:text-primary-blue"
                  : "text-dark-charcoal hover:bg-light-blue/40 hover:text-primary-blue"
              )}
              aria-label="Close menu"
            >
              <CloseIcon className="h-6 w-6" />
            </button>
          </div>

          <nav className="max-h-[70vh] overflow-y-auto px-4 py-4">
            <p
              className={clsx(
                "mb-2 text-[10px] font-bold uppercase tracking-wider",
                isDark ? "text-dark-text-muted" : "text-dark-charcoal/50"
              )}
            >
              {t("footer.main")}
            </p>
            <div className="space-y-1">
              {mainItems.map((item) => {
                const isActive =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
                const ItemIcon = crmNavIconMap[item.iconKey];

                return (
                  <Link
                    key={item.href + item.label}
                    href={item.href}
                    onClick={onClose}
                    className={clsx(
                      "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-colors",
                      isActive
                        ? isDark
                          ? "bg-primary-blue/20 text-primary-blue"
                          : "bg-light-blue/60 text-primary-blue"
                        : isDark
                          ? "text-dark-text hover:bg-dark-border/50 hover:text-primary-blue"
                          : "text-dark-charcoal hover:bg-light-blue/40 hover:text-primary-blue"
                    )}
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
                    <span>
                      {NAV_LABEL_KEY[item.iconKey]
                        ? t(NAV_LABEL_KEY[item.iconKey] as TranslationKey)
                        : item.label}
                    </span>
                  </Link>
                );
              })}
            </div>

            {managementItems.length > 0 && (
              <>
                <div
                  className={clsx(
                    "my-4 border-t",
                    isDark ? "border-dark-border" : "border-light-grey"
                  )}
                />
                <p
                  className={clsx(
                    "mb-2 text-[10px] font-bold uppercase tracking-wider",
                    isDark ? "text-dark-text-muted" : "text-dark-charcoal/50"
                  )}
                >
                  {t("nav.management")}
                </p>
                <div className="space-y-1">
                  {managementItems.map((item) => {
                    const isActive =
                      pathname === item.href ||
                      pathname.startsWith(`${item.href}/`);
                    const ItemIcon = crmNavIconMap[item.iconKey];

                    return (
                      <Link
                        key={item.href + item.label}
                        href={item.href}
                        onClick={onClose}
                        className={clsx(
                          "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-colors",
                          isActive
                            ? isDark
                              ? "bg-primary-blue/20 text-primary-blue"
                              : "bg-light-blue/60 text-primary-blue"
                            : isDark
                              ? "text-dark-text hover:bg-dark-border/50 hover:text-primary-blue"
                              : "text-dark-charcoal hover:bg-light-blue/40 hover:text-primary-blue"
                        )}
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
                        <span>
                      {NAV_LABEL_KEY[item.iconKey]
                        ? t(NAV_LABEL_KEY[item.iconKey] as TranslationKey)
                        : item.label}
                    </span>
                      </Link>
                    );
                  })}
                </div>
              </>
            )}
          </nav>

          <div
            className={clsx(
              "border-t px-4 py-3",
              isDark
                ? "border-dark-border bg-dark-bg"
                : "border-light-grey bg-very-light-grey"
            )}
          >
            <p
              className={clsx(
                "text-center text-xs",
                isDark ? "text-dark-text-muted" : "text-dark-charcoal/60"
              )}
            >
              © {new Date().getFullYear()} Pop Up Advertising &amp; Information Ent.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
