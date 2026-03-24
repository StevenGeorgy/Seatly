import type { ReactNode } from "react";
import { useMemo } from "react";
import { Navigate } from "react-router-dom";

import { useUser } from "@/hooks/useUser";
import { getStaffDefaultPath, getStaffRoleSet } from "@/lib/auth/dashboard-access";

import { RouteFallback } from "./RouteFallback";

/** Logged-in customer only (no user_restaurant_roles). Staff redirected to dashboard. */
export function RequireCustomer({ children }: { children: ReactNode }) {
  const { isStaff, loading, restaurantRoles } = useUser();
  const roleSet = useMemo(() => getStaffRoleSet(restaurantRoles), [restaurantRoles]);

  if (loading) return <RouteFallback />;
  if (isStaff) return <Navigate to={getStaffDefaultPath(roleSet)} replace />;

  return children;
}
