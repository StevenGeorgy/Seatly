import type { StaffRole, UserRestaurantRole } from "@/types/auth";

/**
 * Dashboard route → roles allowed (SEATLY-MASTER-BIBLE.md — Web Dashboard matrix).
 * `/dashboard/schedule` includes all staff roles for clock / hours (product rule).
 */
export const DASHBOARD_PATH_ROLES: Record<string, readonly StaffRole[]> = {
  "/dashboard": ["owner", "manager"],
  "/dashboard/reservations": ["owner", "manager", "server", "host"],
  "/dashboard/floor-plan": ["owner", "manager", "server", "host"],
  "/dashboard/waitlist": ["owner", "manager", "host"],
  "/dashboard/orders": ["owner", "manager", "server", "kitchen", "bar"],
  "/dashboard/menu": ["owner", "manager"],
  "/dashboard/staff": ["owner", "manager"],
  "/dashboard/schedule": [
    "owner",
    "manager",
    "server",
    "host",
    "kitchen",
    "bar",
    "staff",
  ],
  "/dashboard/crm": ["owner", "manager"],
  "/dashboard/analytics": ["owner", "manager"],
  "/dashboard/expenses": ["owner", "manager"],
  "/dashboard/events": ["owner", "manager"],
  "/dashboard/export": ["owner"],
  "/dashboard/settings": ["owner"],
};

/** Sidebar order — must match keys in `DASHBOARD_PATH_ROLES`. */
export const DASHBOARD_NAV_ITEMS: readonly { path: string; labelKey: string }[] = [
  { path: "/dashboard", labelKey: "routes.dashboard.overview.title" },
  { path: "/dashboard/reservations", labelKey: "routes.dashboard.reservations.title" },
  { path: "/dashboard/floor-plan", labelKey: "routes.dashboard.floorPlan.title" },
  { path: "/dashboard/waitlist", labelKey: "routes.dashboard.waitlist.title" },
  { path: "/dashboard/orders", labelKey: "routes.dashboard.orders.title" },
  { path: "/dashboard/menu", labelKey: "routes.dashboard.menu.title" },
  { path: "/dashboard/staff", labelKey: "routes.dashboard.staff.title" },
  { path: "/dashboard/schedule", labelKey: "routes.dashboard.schedule.title" },
  { path: "/dashboard/crm", labelKey: "routes.dashboard.crm.title" },
  { path: "/dashboard/analytics", labelKey: "routes.dashboard.analytics.title" },
  { path: "/dashboard/expenses", labelKey: "routes.dashboard.expenses.title" },
  { path: "/dashboard/events", labelKey: "routes.dashboard.events.title" },
  { path: "/dashboard/export", labelKey: "routes.dashboard.export.title" },
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

export function canAccessDashboardPath(
  pathname: string,
  roleSet: ReadonlySet<StaffRole>,
): boolean {
  const path = normalizeDashboardPath(pathname);
  const allowed = DASHBOARD_PATH_ROLES[path];
  if (!allowed) return false;
  return allowed.some((role) => roleSet.has(role));
}

/** First permitted screen after login / unauthorised redirect (Bible + staff clock default). */
export function getStaffDefaultPath(roleSet: ReadonlySet<StaffRole>): string {
  if (roleSet.has("owner") || roleSet.has("manager")) return "/dashboard";
  if (roleSet.has("kitchen") || roleSet.has("bar")) return "/dashboard/orders";
  if (roleSet.has("server") || roleSet.has("host")) return "/dashboard/reservations";
  if (roleSet.has("staff")) return "/dashboard/schedule";
  return "/dashboard/schedule";
}
