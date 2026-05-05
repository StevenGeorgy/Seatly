import type { DashboardPermissionKey, StaffRole, UserRestaurantRole } from "@/types/auth";

const DASHBOARD_PERMISSION_KEYS: readonly DashboardPermissionKey[] = [
  "overview",
  "reservations",
  "floorPlan",
  "hostView",
  "staffInvites",
  "orders",
  "menu",
  "crm",
  "analytics",
  "expenses",
  "events",
  "promotions",
  "export",
  "restaurant",
  "settings",
];

const DASHBOARD_PATH_PERMISSIONS: Record<string, DashboardPermissionKey> = {
  "/dashboard": "overview",
  "/dashboard/reservations": "reservations",
  "/dashboard/floor-plan": "floorPlan",
  "/dashboard/host-view": "hostView",
  "/dashboard/staff-invites": "staffInvites",
  "/dashboard/host": "staffInvites",
  "/dashboard/orders": "orders",
  "/dashboard/menu": "menu",
  "/dashboard/crm": "crm",
  "/dashboard/analytics": "analytics",
  "/dashboard/expenses": "expenses",
  "/dashboard/events": "events",
  "/dashboard/promotions": "promotions",
  "/dashboard/export": "export",
  "/dashboard/restaurant": "restaurant",
  "/dashboard/settings": "settings",
};

/**
 * Dashboard route → roles allowed (CENAIVA-MASTER-BIBLE.md — Web Dashboard matrix).
 */
export const DASHBOARD_PATH_ROLES: Record<string, readonly StaffRole[]> = {
  "/dashboard": ["owner", "manager"],
  "/dashboard/reservations": ["owner", "manager", "server", "host"],
  "/dashboard/floor-plan": ["owner", "manager", "server", "host"],
  "/dashboard/host-view": ["owner", "manager", "server", "host"],
  "/dashboard/staff-invites": ["owner", "manager"],
  "/dashboard/host": ["owner", "manager"],
  "/dashboard/orders": ["owner", "manager", "server", "kitchen", "bar"],
  "/dashboard/menu": ["owner", "manager"],
  "/dashboard/crm": ["owner", "manager"],
  "/dashboard/analytics": ["owner", "manager"],
  "/dashboard/expenses": ["owner", "manager"],
  "/dashboard/events": ["owner", "manager"],
  "/dashboard/promotions": ["owner", "manager"],
  "/dashboard/export": ["owner"],
  "/dashboard/restaurant": ["owner", "manager"],
  "/dashboard/settings": ["owner", "manager"],
};

/** Sidebar order — must match keys in `DASHBOARD_PATH_ROLES`. */
export const DASHBOARD_NAV_ITEMS: readonly { path: string; labelKey: string }[] = [
  { path: "/dashboard", labelKey: "routes.dashboard.overview.title" },
  { path: "/dashboard/reservations", labelKey: "routes.dashboard.reservations.title" },
  { path: "/dashboard/floor-plan", labelKey: "routes.dashboard.floorPlan.title" },
  { path: "/dashboard/host-view", labelKey: "routes.dashboard.hostView.title" },
  { path: "/dashboard/staff-invites", labelKey: "routes.dashboard.staffInvites.title" },
  { path: "/dashboard/orders", labelKey: "routes.dashboard.orders.title" },
  { path: "/dashboard/menu", labelKey: "routes.dashboard.menu.title" },
  { path: "/dashboard/crm", labelKey: "routes.dashboard.crm.title" },
  { path: "/dashboard/analytics", labelKey: "routes.dashboard.analytics.title" },
  { path: "/dashboard/expenses", labelKey: "routes.dashboard.expenses.title" },
  { path: "/dashboard/events", labelKey: "routes.dashboard.events.title" },
  { path: "/dashboard/promotions", labelKey: "routes.dashboard.promotions.title" },
  { path: "/dashboard/export", labelKey: "routes.dashboard.export.title" },
  { path: "/dashboard/restaurant", labelKey: "routes.dashboard.restaurantInfo.title" },
  { path: "/dashboard/settings", labelKey: "routes.dashboard.settings.title" },
];

export function normalizeDashboardPath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export function resolveDashboardPageLabelKey(pathname: string): string {
  const norm = normalizeDashboardPath(pathname);
  const exact = DASHBOARD_NAV_ITEMS.find((item) => item.path === norm);
  if (exact) return exact.labelKey;
  const byPrefix = [...DASHBOARD_NAV_ITEMS]
    .filter((item) => item.path !== "/dashboard" && norm.startsWith(`${item.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return byPrefix?.labelKey ?? DASHBOARD_NAV_ITEMS[0].labelKey;
}

export function getStaffRoleSet(roles: UserRestaurantRole[]): Set<StaffRole> {
  return new Set(roles.map((r) => r.role));
}

function isPermissionKey(value: unknown): value is DashboardPermissionKey {
  return (
    typeof value === "string" &&
    (DASHBOARD_PERMISSION_KEYS as readonly string[]).includes(value)
  );
}

function getRolePresetPermissions(roleSet: ReadonlySet<StaffRole>): Set<DashboardPermissionKey> {
  const permissions = new Set<DashboardPermissionKey>();
  Object.entries(DASHBOARD_PATH_ROLES).forEach(([path, allowedRoles]) => {
    if (allowedRoles.some((role) => roleSet.has(role))) {
      permissions.add(DASHBOARD_PATH_PERMISSIONS[path]);
    }
  });
  return permissions;
}

export function getDashboardPermissionSet(
  roles: UserRestaurantRole[],
): Set<DashboardPermissionKey> {
  const roleSet = getStaffRoleSet(roles);
  const permissions = getRolePresetPermissions(roleSet);

  roles.forEach((role) => {
    const overrides = role.permission_overrides_json ?? {};
    const allow = Array.isArray(overrides.allow) ? overrides.allow : [];
    const deny = Array.isArray(overrides.deny) ? overrides.deny : [];

    allow.filter(isPermissionKey).forEach((key) => permissions.add(key));
    deny.filter(isPermissionKey).forEach((key) => permissions.delete(key));
  });

  return permissions;
}

export function canAccessDashboardPath(
  pathname: string,
  roleSet: ReadonlySet<StaffRole>,
  roles: UserRestaurantRole[] = [],
): boolean {
  const path = normalizeDashboardPath(pathname);
  const allowed = DASHBOARD_PATH_ROLES[path];
  if (!allowed) return false;
  const permissionKey = DASHBOARD_PATH_PERMISSIONS[path];
  if (roles.length > 0 && permissionKey) {
    return getDashboardPermissionSet(roles).has(permissionKey);
  }
  return allowed.some((role) => roleSet.has(role));
}

/** First permitted screen after login / unauthorised redirect. */
export function getStaffDefaultPath(
  roleSet: ReadonlySet<StaffRole>,
  roles: UserRestaurantRole[] = [],
): string {
  if (roles.length > 0) {
    return (
      DASHBOARD_NAV_ITEMS.find((item) => canAccessDashboardPath(item.path, roleSet, roles))
        ?.path ?? "/dashboard/reservations"
    );
  }
  if (roleSet.has("owner") || roleSet.has("manager")) return "/dashboard";
  if (roleSet.has("kitchen") || roleSet.has("bar")) return "/dashboard/orders";
  if (roleSet.has("server") || roleSet.has("host")) return "/dashboard/reservations";
  return "/dashboard/reservations";
}
