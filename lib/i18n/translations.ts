// ─────────────────────────────────────────────────────────────
// i18n translation dictionaries for the CRM app chrome + Settings.
//
// Scope (incremental rollout): the globally-visible chrome (sidebar
// nav, top bar, footer) and the Settings panel where the Language
// control lives. Page bodies that don't yet have keys fall back to
// the English (en-MY) string via t(), so partial coverage degrades
// gracefully to English instead of showing raw keys.
//
// To extend: add a key to EVERY locale below (en-MY is the source of
// truth + fallback) and call t("your.key") in the component.
// ─────────────────────────────────────────────────────────────

export const LOCALES = ["en-MY", "ms-MY", "zh-CN", "ta-IN"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en-MY";

/** Human-readable label for each locale (used by the settings dropdown). */
export const LOCALE_LABELS: Record<Locale, string> = {
  "en-MY": "English (Malaysia)",
  "ms-MY": "Bahasa Melayu",
  "zh-CN": "中文 (简体)",
  "ta-IN": "தமிழ்",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export type TranslationKey =
  // Navigation
  | "nav.dashboard"
  | "nav.sensors"
  | "nav.map"
  | "nav.analytics"
  | "nav.alerts"
  | "nav.community"
  | "nav.news"
  | "nav.roles"
  | "nav.account"
  | "nav.settings"
  | "nav.management"
  // Top bar
  | "topbar.search"
  | "topbar.subtitle"
  | "topbar.logout"
  // Footer
  | "footer.main"
  | "footer.insights"
  // Settings
  | "settings.subtitle"
  | "settings.unsaved"
  | "settings.export"
  | "settings.save"
  | "settings.saving"
  | "settings.cancel"
  | "settings.reset"
  | "settings.tab.general"
  | "settings.tab.notifications"
  | "settings.tab.data"
  | "settings.tab.integrations"
  | "settings.tab.security"
  | "settings.tab.appearance"
  | "settings.tab.map"
  | "settings.tab.backup"
  | "settings.general.desc"
  | "settings.field.systemName"
  | "settings.field.organizationName"
  | "settings.field.timezone"
  | "settings.field.language"
  | "settings.field.dateFormat";

type Dictionary = Record<TranslationKey, string>;

const en: Dictionary = {
  "nav.dashboard": "Dashboard",
  "nav.sensors": "Sensors",
  "nav.map": "Flood Map",
  "nav.analytics": "Analytics",
  "nav.alerts": "Alerts",
  "nav.community": "Community",
  "nav.news": "News & Blog",
  "nav.roles": "Role Management",
  "nav.account": "Account Settings",
  "nav.settings": "CRM Settings",
  "nav.management": "Management",
  "topbar.search": "Search pages...",
  "topbar.subtitle": "IoT Command Center",
  "topbar.logout": "Logout",
  "footer.main": "Main",
  "footer.insights": "Insights",
  "settings.subtitle": "Configure system preferences, integrations, and security options.",
  "settings.unsaved": "Unsaved changes",
  "settings.export": "Export",
  "settings.save": "Save Changes",
  "settings.saving": "Saving...",
  "settings.cancel": "Cancel",
  "settings.reset": "Reset to Defaults",
  "settings.tab.general": "General",
  "settings.tab.notifications": "Notifications",
  "settings.tab.data": "Data Management",
  "settings.tab.integrations": "Integrations",
  "settings.tab.security": "Security",
  "settings.tab.appearance": "Appearance",
  "settings.tab.map": "Map Settings",
  "settings.tab.backup": "Backup & Restore",
  "settings.general.desc": "Basic system configuration",
  "settings.field.systemName": "System Name",
  "settings.field.organizationName": "Organization Name",
  "settings.field.timezone": "Timezone",
  "settings.field.language": "Language",
  "settings.field.dateFormat": "Date Format",
};

const ms: Dictionary = {
  "nav.dashboard": "Papan Pemuka",
  "nav.sensors": "Penderia",
  "nav.map": "Peta Banjir",
  "nav.analytics": "Analitik",
  "nav.alerts": "Amaran",
  "nav.community": "Komuniti",
  "nav.news": "Berita & Blog",
  "nav.roles": "Pengurusan Peranan",
  "nav.account": "Tetapan Akaun",
  "nav.settings": "Tetapan CRM",
  "nav.management": "Pengurusan",
  "topbar.search": "Cari halaman...",
  "topbar.subtitle": "Pusat Arahan IoT",
  "topbar.logout": "Log Keluar",
  "footer.main": "Utama",
  "footer.insights": "Wawasan",
  "settings.subtitle": "Konfigurasikan keutamaan sistem, integrasi dan pilihan keselamatan.",
  "settings.unsaved": "Perubahan belum disimpan",
  "settings.export": "Eksport",
  "settings.save": "Simpan Perubahan",
  "settings.saving": "Menyimpan...",
  "settings.cancel": "Batal",
  "settings.reset": "Tetapkan Semula kepada Lalai",
  "settings.tab.general": "Umum",
  "settings.tab.notifications": "Pemberitahuan",
  "settings.tab.data": "Pengurusan Data",
  "settings.tab.integrations": "Integrasi",
  "settings.tab.security": "Keselamatan",
  "settings.tab.appearance": "Penampilan",
  "settings.tab.map": "Tetapan Peta",
  "settings.tab.backup": "Sandaran & Pemulihan",
  "settings.general.desc": "Konfigurasi sistem asas",
  "settings.field.systemName": "Nama Sistem",
  "settings.field.organizationName": "Nama Organisasi",
  "settings.field.timezone": "Zon Waktu",
  "settings.field.language": "Bahasa",
  "settings.field.dateFormat": "Format Tarikh",
};

const zh: Dictionary = {
  "nav.dashboard": "仪表板",
  "nav.sensors": "传感器",
  "nav.map": "洪水地图",
  "nav.analytics": "分析",
  "nav.alerts": "警报",
  "nav.community": "社区",
  "nav.news": "新闻与博客",
  "nav.roles": "角色管理",
  "nav.account": "账户设置",
  "nav.settings": "CRM 设置",
  "nav.management": "管理",
  "topbar.search": "搜索页面...",
  "topbar.subtitle": "物联网指挥中心",
  "topbar.logout": "退出登录",
  "footer.main": "主要",
  "footer.insights": "洞察",
  "settings.subtitle": "配置系统首选项、集成和安全选项。",
  "settings.unsaved": "未保存的更改",
  "settings.export": "导出",
  "settings.save": "保存更改",
  "settings.saving": "保存中...",
  "settings.cancel": "取消",
  "settings.reset": "重置为默认值",
  "settings.tab.general": "常规",
  "settings.tab.notifications": "通知",
  "settings.tab.data": "数据管理",
  "settings.tab.integrations": "集成",
  "settings.tab.security": "安全",
  "settings.tab.appearance": "外观",
  "settings.tab.map": "地图设置",
  "settings.tab.backup": "备份与还原",
  "settings.general.desc": "基本系统配置",
  "settings.field.systemName": "系统名称",
  "settings.field.organizationName": "组织名称",
  "settings.field.timezone": "时区",
  "settings.field.language": "语言",
  "settings.field.dateFormat": "日期格式",
};

const ta: Dictionary = {
  "nav.dashboard": "டாஷ்போர்டு",
  "nav.sensors": "உணரிகள்",
  "nav.map": "வெள்ள வரைபடம்",
  "nav.analytics": "பகுப்பாய்வு",
  "nav.alerts": "எச்சரிக்கைகள்",
  "nav.community": "சமூகம்",
  "nav.news": "செய்தி & வலைப்பதிவு",
  "nav.roles": "பங்கு மேலாண்மை",
  "nav.account": "கணக்கு அமைப்புகள்",
  "nav.settings": "CRM அமைப்புகள்",
  "nav.management": "நிர்வாகம்",
  "topbar.search": "பக்கங்களைத் தேடு...",
  "topbar.subtitle": "IoT கட்டளை மையம்",
  "topbar.logout": "வெளியேறு",
  "footer.main": "முதன்மை",
  "footer.insights": "நுண்ணறிவுகள்",
  "settings.subtitle": "கணினி விருப்பங்கள், ஒருங்கிணைப்புகள் மற்றும் பாதுகாப்பு விருப்பங்களை அமைக்கவும்.",
  "settings.unsaved": "சேமிக்கப்படாத மாற்றங்கள்",
  "settings.export": "ஏற்றுமதி",
  "settings.save": "மாற்றங்களைச் சேமி",
  "settings.saving": "சேமிக்கிறது...",
  "settings.cancel": "ரத்து",
  "settings.reset": "இயல்புநிலைக்கு மீட்டமை",
  "settings.tab.general": "பொது",
  "settings.tab.notifications": "அறிவிப்புகள்",
  "settings.tab.data": "தரவு மேலாண்மை",
  "settings.tab.integrations": "ஒருங்கிணைப்புகள்",
  "settings.tab.security": "பாதுகாப்பு",
  "settings.tab.appearance": "தோற்றம்",
  "settings.tab.map": "வரைபட அமைப்புகள்",
  "settings.tab.backup": "காப்புப்பிரதி & மீட்டமை",
  "settings.general.desc": "அடிப்படை கணினி கட்டமைப்பு",
  "settings.field.systemName": "கணினி பெயர்",
  "settings.field.organizationName": "நிறுவனப் பெயர்",
  "settings.field.timezone": "நேர மண்டலம்",
  "settings.field.language": "மொழி",
  "settings.field.dateFormat": "தேதி வடிவம்",
};

export const dictionaries: Record<Locale, Dictionary> = {
  "en-MY": en,
  "ms-MY": ms,
  "zh-CN": zh,
  "ta-IN": ta,
};

/**
 * Translate a key for the given locale. Falls back to en-MY, then to
 * the key string itself, so a missing translation degrades to English
 * rather than rendering a raw key.
 */
export function translate(locale: Locale, key: TranslationKey): string {
  return (
    dictionaries[locale]?.[key] ??
    dictionaries[DEFAULT_LOCALE][key] ??
    key
  );
}
