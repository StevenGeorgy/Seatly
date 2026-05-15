import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useUser } from "@/hooks/useUser";

import { RouteFallback } from "./RouteFallback";

// Phase 3 of diner auth overhaul (2026-05-15): hard gate that fires
// only at the booking-checkout step. A diner can sign in via any
// provider and freely browse Discover / a restaurant's public page,
// but the moment they try to commit a reservation we need full_name +
// email + phone on the profile (phone for SMS confirmation, email for
// receipts, name for the restaurant to greet them).
//
// The Phase 1 DB trigger guarantees that `profile` is non-null for any
// authenticated user, so we only need to check field completeness here.

export function RequireCompleteProfile({ children }: { children: ReactNode }) {
  const { user, profile, loading } = useUser();
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

  const fullName = profile?.full_name?.trim() ?? "";
  const email = profile?.email?.trim() ?? "";
  const phone = profile?.phone?.trim() ?? "";

  if (!fullName || !email || !phone) {
    const from = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={`/onboarding?from=${encodeURIComponent(from)}`}
        replace
      />
    );
  }

  return children;
}
