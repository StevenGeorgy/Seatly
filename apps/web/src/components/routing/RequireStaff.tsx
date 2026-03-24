import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { useUser } from "@/hooks/useUser";

import { RouteFallback } from "./RouteFallback";

/** Staff = any row in user_restaurant_roles (Bible). Customers go to customer routes. */
export function RequireStaff({ children }: { children: ReactNode }) {
  const { isStaff, loading } = useUser();

  if (loading) return <RouteFallback />;
  if (!isStaff) return <Navigate to="/discover" replace />;

  return children;
}
