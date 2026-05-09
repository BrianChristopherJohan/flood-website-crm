// Role-Based Access Control (RBAC) System

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
  // Two feedback entries: every CRM user can submit feedback at /feedback;
  // admins additionally see the read-only viewer at /admin/feedback with
  // CSV export. The viewer's actual auth is enforced server-side.
  { label: "Submit feedback", href: "/feedback", iconKey: "news", section: "main", permission: "dashboard.view", alwaysShow: true },
  { label: "Survey Responses", href: "/admin/feedback", iconKey: "analytics", section: "management", permission: "roles.manage" },
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

/** Maps JWT `role` claim (ADMIN, …) or API display/locale strings to UI {@link RoleName}. */
const JWT_OR_API_ROLE_TO_DISPLAY: Record<string, RoleName> = {
  ADMIN: "Admin",
  OPERATIONS_MANAGER: "Operations Manager",
  FIELD_TECHNICIAN: "Field Technician",
  NGO_VOLUNTEER: "NGO Volunteer",
  VIEWER: "Viewer",
  CUSTOMER: "Customer",
};

export function roleFromJwtOrApiRole(raw: string | undefined | null): RoleName {
  if (raw == null || !String(raw).trim()) return "Customer";
  const key = String(raw).trim().toUpperCase().replace(/\s+/g, "_");
  return JWT_OR_API_ROLE_TO_DISPLAY[key] ?? "Customer";
}
