import type { ReactNode } from "react";
import { useMemo } from "react";
import { Navigate } from "react-router-dom";

import { useUser } from "@/hooks/useUser";
import { getStaffDefaultPath, getStaffRoleSet } from "@/lib/auth/dashboard-access";

import { RouteFallback } from "./RouteFallback";

/** Auth pages: redirect signed-in users to discover (customer) or staff home. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading, isStaff, restaurantRoles } = useUser();
  const roleSet = useMemo(() => getStaffRoleSet(restaurantRoles), [restaurantRoles]);

  if (loading) return <RouteFallback />;
  if (!user) return children;
  if (isStaff) return <Navigate to={getStaffDefaultPath(roleSet)} replace />;
  return <Navigate to="/discover" replace />;
}
