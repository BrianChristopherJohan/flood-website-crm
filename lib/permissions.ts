// Role-Based Access Control (RBAC) System
//
// This file hosts CRM-specific permission matrices, page guards, and
// navigation helpers. The CORE role primitives — operator-class
// predicate, role normalisation, display labels, post-login routing —
// live in `lib/rbac.ts`, which is byte-identical between the CRM and
// the community site (see __tests__/lib/rbac-drift.test.ts).
//
// Old call sites import `isOperatorJwtRole`, `OPERATOR_JWT_KEYS`,
// etc. from this file; they still work via the re-exports below.
// New code should import directly from `@/lib/rbac`.

import {
  OPERATOR_JWT_KEYS as RBAC_OPERATOR_JWT_KEYS,
  isOperatorRole as rbacIsOperatorRole,
  normalizeRoleKey,
  roleToDisplayLabel,
} from "@/lib/rbac";

export type Permission =
  | "all"
  | "dashboard.view"
  | "sensors.manage"
  | "sensors.view"
  | "sensors.export"
  | "alerts.manage"
  | "alerts.view"
  | "analytics.view"
  | "map.view"
  | "roles.manage"
  | "users.manage"
  | "settings.manage"
  | "blog.view"
  | "blog.manage"
  | "reports.manage"
  | "community.comments.moderate";

export type RoleName =
  | "Admin"
  | "Operations Manager"
  | "Field Technician"
  | "NGO Volunteer"
  | "Viewer"
  | "Customer";

// Canonical CRM sidebar / mobile — single source for labels, hrefs, and required permission
export type AppNavIconKey =
  | "dashboard"
  | "sensors"
  | "map"
  | "analytics"
  | "alerts"
  | "community"
  | "news"
  | "roles"
  | "account"
  | "settings";

export type AppNavItem = {
  label: string;
  href: string;
  permission: Permission;
  section: "main" | "management";
  iconKey: AppNavIconKey;
  /** If true, item is shown whenever the user is authenticated (e.g. account settings). */
  alwaysShow?: boolean;
};

export const appNavigationItems: AppNavItem[] = [
  { label: "Dashboard", href: "/dashboard", iconKey: "dashboard", section: "main", permission: "dashboard.view" },
  { label: "Sensors", href: "/sensors", iconKey: "sensors", section: "main", permission: "sensors.view" },
  { label: "Flood Map", href: "/map", iconKey: "map", section: "main", permission: "map.view" },
  { label: "Analytics", href: "/analytics", iconKey: "analytics", section: "main", permission: "analytics.view" },
  { label: "Alerts", href: "/alerts", iconKey: "alerts", section: "main", permission: "alerts.view" },
  // Community page now hosts Posts / Groups / Comments / Reports tabs in
  // one place; standalone /community/comments and /community/content-reports
  // routes redirect here.
  { label: "Community", href: "/community", iconKey: "community", section: "main", permission: "blog.view" },
  { label: "News & Blog", href: "/blog", iconKey: "news", section: "main", permission: "blog.manage" },
  { label: "Role Management", href: "/roles", iconKey: "roles", section: "management", permission: "roles.manage" },
  { label: "Account Settings", href: "/admin", iconKey: "account", section: "management", permission: "dashboard.view", alwaysShow: true },
  { label: "CRM Settings", href: "/settings", iconKey: "settings", section: "management", permission: "settings.manage" },
];

// Matrix: Admin, Ops, Field tech, NGO volunteer, Viewer, Customer (CRM)
export const rolePermissions: Record<RoleName, Permission[]> = {
  Admin: ["all"],
  "Operations Manager": [
    "dashboard.view",
    "sensors.manage",
    "sensors.view",
    "sensors.export",
    "alerts.manage",
    "alerts.view",
    "analytics.view",
    "map.view",
    "blog.view",
    "blog.manage",
    "reports.manage",
    "settings.manage",
  ],
  "Field Technician": [
    "dashboard.view",
    "sensors.manage",
    "sensors.view",
    "sensors.export",
    "alerts.view",
    "map.view",
    "analytics.view",
  ],
  "NGO Volunteer": [
    "dashboard.view",
    "sensors.view",
    "map.view",
    "analytics.view",
    "alerts.view",
    "blog.view",
    "blog.manage",
    "reports.manage",
  ],
  Viewer: [
    "dashboard.view",
    "sensors.view",
    "map.view",
    "analytics.view",
    "alerts.view",
  ],
  Customer: [],
};

// ── Operator-class gate ─────────────────────────────────────────────
//
// Thin re-exports of the canonical RBAC primitives from `lib/rbac.ts`.
// Existing call sites continue to import from `@/lib/permissions`; new
// code should import from `@/lib/rbac` directly.

/** CRM display labels of operator-class roles (excludes "Customer"). */
export const OPERATOR_ROLES: ReadonlyArray<RoleName> = [
  "Admin",
  "Operations Manager",
  "Field Technician",
  "NGO Volunteer",
  "Viewer",
];

/**
 * Raw Java-backend role strings that correspond to operator-class.
 * Exposed as a read-only array view for the few call sites that do
 * `.includes(...)` — internally it's a Set in lib/rbac.ts.
 */
export const OPERATOR_JWT_KEYS: ReadonlyArray<string> = Array.from(
  RBAC_OPERATOR_JWT_KEYS,
);

/**
 * Accepts either a display label ("Admin") or a JWT enum
 * ("ADMIN" / "ROLE_ADMIN" / "Operations Manager"). Always
 * normalises before testing — call sites can be sloppy.
 */
export function isOperatorRole(role: string | null | undefined): boolean {
  return rbacIsOperatorRole(role);
}

/** @deprecated — use `isOperatorRole` from `@/lib/rbac`. Kept for back-compat. */
export function isOperatorJwtRole(jwtRole: string | null | undefined): boolean {
  return rbacIsOperatorRole(jwtRole);
}

// Permission descriptions for UI
export const permissionDescriptions: Record<Permission, string> = {
  all: "Full system access with all permissions",
  "dashboard.view": "View dashboard and statistics",
  "sensors.manage": "Add, edit, and delete sensors",
  "sensors.view": "View sensor data and status",
  "sensors.export": "Export sensor data to CSV/Excel",
  "alerts.manage": "Acknowledge and manage alerts",
  "alerts.view": "View alerts and notifications",
  "analytics.view": "View analytics and reports",
  "map.view": "View flood map and locations",
  "roles.manage": "Manage user roles and permissions",
  "users.manage": "Add, edit, and remove users",
  "settings.manage": "Manage system settings",
  "blog.view": "Moderate community posts and groups",
  "blog.manage": "Create and manage news and blog articles",
  "reports.manage": "Review and update incident reports",
  "community.comments.moderate": "Hide, restore, or remove community post comments (admin)",
};

// Check if a role has a specific permission
export function hasPermission(role: string, permission: Permission): boolean {
  const rolePerms = rolePermissions[role as RoleName];

  if (!rolePerms) return false;

  if (rolePerms.includes("all")) return true;

  return rolePerms.includes(permission);
}

// Check if a role has any of the specified permissions
export function hasAnyPermission(role: string, permissions: Permission[]): boolean {
  return permissions.some((perm) => hasPermission(role, perm));
}

// Check if a role has all of the specified permissions
export function hasAllPermissions(role: string, permissions: Permission[]): boolean {
  return permissions.every((perm) => hasPermission(role, perm));
}

// Get all permissions for a role
export function getRolePermissions(role: string): Permission[] {
  const rolePerms = rolePermissions[role as RoleName];

  if (!rolePerms) return [];

  if (rolePerms.includes("all")) {
    return Object.keys(permissionDescriptions) as Permission[];
  }

  return rolePerms;
}

// Legacy shape — href + permission only (used where icon/section not needed)
export type NavItem = {
  label: string;
  href: string;
  permission: Permission;
};

/** Flat list derived from `appNavigationItems` for search / simple filters */
export const navigationItems: NavItem[] = appNavigationItems.map(({ label, href, permission }) => ({
  label,
  href,
  permission,
}));

// Filter navigation items based on user role
export function getAccessibleNavItems(role: string): AppNavItem[] {
  return appNavigationItems.filter(
    (item) => item.alwaysShow || hasPermission(role, item.permission),
  );
}

// Page access control
export const pagePermissions: Record<string, Permission> = {
  "/dashboard": "dashboard.view",
  "/sensors": "sensors.view",
  "/map": "map.view",
  "/analytics": "analytics.view",
  "/alerts": "alerts.view",
  "/roles": "roles.manage",
  "/admin": "dashboard.view",
  "/settings": "settings.manage",
  "/blog": "blog.manage",
  "/community": "blog.view",
  "/community/comments": "community.comments.moderate",
  "/community/content-reports": "community.comments.moderate",
  "/reports": "reports.manage",
  "/broadcasts": "alerts.manage",
  "/portal": "dashboard.view",
  "/portal/community": "blog.view",
};

// Check if user can access a specific page
export function canAccessPage(role: string, pathname: string): boolean {
  if (pathname === "/admin") return true;

  const requiredPermission = pagePermissions[pathname];

  if (!requiredPermission) return true;

  return hasPermission(role, requiredPermission);
}

// Feature flags based on permissions
export function canExportData(role: string): boolean {
  return hasPermission(role, "sensors.export") || hasPermission(role, "all");
}

export function canManageSensors(role: string): boolean {
  return hasPermission(role, "sensors.manage");
}

export function canManageAlerts(role: string): boolean {
  return hasPermission(role, "alerts.manage");
}

export function canManageRoles(role: string): boolean {
  return hasPermission(role, "roles.manage");
}

export function canManageUsers(role: string): boolean {
  return hasPermission(role, "users.manage") || hasPermission(role, "all");
}

/**
 * Maps any role string (JWT enum `ADMIN`, API display `Admin`, locale
 * variants) to the canonical CRM {@link RoleName}. Thin wrapper around
 * `roleToDisplayLabel` in `lib/rbac.ts` — the underlying normalisation
 * already handles `ROLE_` prefix, whitespace, no-underscore variants.
 */
export function roleFromJwtOrApiRole(raw: string | undefined | null): RoleName {
  // `roleToDisplayLabel` returns one of the six display labels which
  // happen to BE the `RoleName` union — safe widening.
  return roleToDisplayLabel(raw) as RoleName;
}

// Re-export rbac primitives so call sites can stay on @/lib/permissions
// during the migration window.
export { normalizeRoleKey } from "@/lib/rbac";
export type { RoleKey, RoleLabel, RouteTarget } from "@/lib/rbac";
export { routeForRole } from "@/lib/rbac";
