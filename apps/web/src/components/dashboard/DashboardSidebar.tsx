import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { useUser } from "@/hooks/useUser";
import {
  DASHBOARD_NAV_ITEMS,
  canAccessDashboardPath,
  getStaffRoleSet,
} from "@/lib/auth/dashboard-access";
import { cn } from "@/lib/utils";
import type { StaffRole } from "@/types/auth";

export function DashboardSidebar() {
  const { t } = useTranslation();
  const { restaurantRoles } = useUser();
  const { selectedRestaurantId, restaurants, setSelectedRestaurantId } = useRestaurantScope();

  const roleSet = useMemo((): Set<StaffRole> => {
    if (!selectedRestaurantId) {
      return new Set();
    }
    return getStaffRoleSet(
      restaurantRoles.filter((r) => r.restaurant_id === selectedRestaurantId),
    );
  }, [restaurantRoles, selectedRestaurantId]);

  const visibleItems = useMemo(
    () => DASHBOARD_NAV_ITEMS.filter((item) => canAccessDashboardPath(item.path, roleSet)),
    [roleSet],
  );

  return (
    <aside className="border-border bg-card flex w-full shrink-0 flex-col gap-4 border-b p-4 sm:w-56 sm:border-r sm:border-b-0">
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {t("dashboard.shell.restaurant")}
        </p>
        {restaurants.length > 1 ? (
          <select
            className="border-input bg-background text-foreground focus-visible:border-ring h-12 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            value={selectedRestaurantId ?? ""}
            onChange={(e) => setSelectedRestaurantId(e.target.value)}
          >
            {restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name ?? r.slug}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-foreground text-sm font-medium">
            {restaurants[0]?.name ?? restaurants[0]?.slug ?? "—"}
          </p>
        )}
      </div>

      <nav className="flex flex-col gap-1" aria-label={t("dashboard.shell.navLabel")}>
        {visibleItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/dashboard"}
            className={({ isActive }) =>
              cn(
                "text-muted-foreground rounded-md px-3 py-2 text-sm font-medium transition-colors",
                "hover:bg-muted hover:text-foreground",
                isActive && "bg-muted text-foreground",
              )
            }
          >
            {t(item.labelKey)}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
