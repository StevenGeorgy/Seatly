import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useUser } from "@/hooks/useUser";

import { RouteFallback } from "./RouteFallback";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useUser();
  const location = useLocation();

  if (loading) return <RouteFallback />;
  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return children;
}
