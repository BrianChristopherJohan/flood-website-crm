"use client";

// ─────────────────────────────────────────────────────────────
// LanguageContext — drives UI locale for the CRM.
//
// Source of truth for the chosen locale is `crmSettings.language`
// in localStorage (the CRM Settings → General → Language control).
// This provider:
//   • hydrates the locale from that setting on mount,
//   • exposes a bound `t()` translator + `setLocale()`,
//   • keeps <html lang> in sync (a11y + correct hyphenation),
//   • listens for cross-tab `storage` changes and a same-tab
//     `crm:language-changed` event so a Save in Settings applies
//     immediately, everywhere, without a reload.
//
// Why this exists: the Language dropdown previously wrote the value
// to localStorage but nothing consumed it, so switching language did
// nothing visible. This wires the setting to the actual UI.
// ─────────────────────────────────────────────────────────────

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_LOCALE,
  isLocale,
  translate,
  type Locale,
  type TranslationKey,
} from "./translations";

/** Same key the Settings page persists under. */
const SETTINGS_KEY = "crmSettings";
/** Same-tab broadcast so a Settings save updates the locale live. */
export const LANGUAGE_CHANGED_EVENT = "crm:language-changed";

function readLocaleFromStorage(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_LOCALE;
    const parsed = JSON.parse(raw) as { language?: unknown };
    return isLocale(parsed.language) ? parsed.language : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

type LanguageContextType = {
  locale: Locale;
  /** Apply a locale immediately (does NOT persist — Settings owns persistence). */
  setLocale: (locale: Locale) => void;
  /** Translate a key in the current locale (falls back to English). */
  t: (key: TranslationKey) => string;
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Start at the default so server and first client render agree, then
  // reconcile to the stored value after mount (avoids hydration mismatch).
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    setLocaleState(readLocaleFromStorage());
  }, []);

  // Keep <html lang> aligned with the active locale.
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  // React to a Settings save (same tab) and edits from another tab.
  useEffect(() => {
    const sync = () => setLocaleState(readLocaleFromStorage());
    const onStorage = (e: StorageEvent) => {
      if (e.key === SETTINGS_KEY) sync();
    };
    window.addEventListener(LANGUAGE_CHANGED_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(LANGUAGE_CHANGED_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
  }, []);

  const t = useCallback(
    (key: TranslationKey) => translate(locale, key),
    [locale],
  );

  const value = useMemo<LanguageContextType>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextType {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
