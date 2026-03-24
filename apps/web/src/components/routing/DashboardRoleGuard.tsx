import type { ReactNode } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation } from "react-router-dom";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { useUser } from "@/hooks/useUser";
import {
  canAccessDashboardPath,
  getStaffDefaultPath,
  getStaffRoleSet,
} from "@/lib/auth/dashboard-access";
import type { StaffRole } from "@/types/auth";

import { RouteFallback } from "./RouteFallback";

export function DashboardRoleGuard({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { restaurantRoles } = useUser();
  const { selectedRestaurantId, loading: scopeLoading, restaurants, error } = useRestaurantScope();

  const roleSet = useMemo((): Set<StaffRole> => {
    if (!selectedRestaurantId) {
      return new Set();
    }
    return getStaffRoleSet(
      restaurantRoles.filter((r) => r.restaurant_id === selectedRestaurantId),
    );
  }, [restaurantRoles, selectedRestaurantId]);

  if (scopeLoading) {
    return <RouteFallback />;
  }

  if (error) {
    return (
      <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-8">
        <p className="text-destructive text-sm">{t("dashboard.shell.loadRestaurantsFailed")}</p>
      </main>
    );
  }

  if (restaurants.length === 0) {
    return (
      <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-8">
        <p className="text-muted-foreground text-center text-sm">{t("dashboard.shell.noRestaurants")}</p>
      </main>
    );
  }

  if (!selectedRestaurantId || roleSet.size === 0) {
    return <Navigate to="/discover" replace />;
  }

  if (!canAccessDashboardPath(pathname, roleSet)) {
    return <Navigate to={getStaffDefaultPath(roleSet)} replace />;
  }

  return children;
}
