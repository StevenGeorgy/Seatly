import {
  canAccessDashboardPath,
  getStaffDefaultPath,
  getStaffRoleSet,
} from "@/lib/auth/dashboard-access";
import type { LoadUserContextResult } from "@/lib/supabase/load-user-context";
import { isProfileComplete } from "@/lib/validation/profile-schemas";

export function isSafeRedirectPath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (path.includes(":")) return false;
  const lower = path.toLowerCase();
  if (lower.includes("javascript")) return false;
  return true;
}

type OkContext = Extract<LoadUserContextResult, { ok: true }>;

/**
 * After sign-in / OAuth, pick a safe internal path. Staff cannot land on customer-only URLs.
 *
 * Phase 11 (2026-05-15): when a non-staff diner finishes signing in but
 * still has missing profile fields (full_name / email / phone), route
 * them to `/onboarding` so we collect the second contact channel before
 * they hit the booking checkout (where `RequireCompleteProfile` would
 * redirect anyway). Carries the intended `from` through `?from=...` so
 * the onboarding submit lands them back where they wanted to go.
 */
export function resolvePostLoginPath(from: unknown, result: OkContext): string {
  const fromStr = typeof from === "string" ? from : undefined;
  const roleSet = getStaffRoleSet(result.restaurantRoles);
  const isStaff = roleSet.size > 0;

  if (fromStr && isSafeRedirectPath(fromStr)) {
    if (isStaff) {
      if (fromStr.startsWith("/dashboard")) {
        return canAccessDashboardPath(fromStr, roleSet, result.restaurantRoles)
          ? fromStr
          : getStaffDefaultPath(roleSet, result.restaurantRoles);
      }
      if (fromStr.startsWith("/discover") || fromStr.startsWith("/account")) {
        return getStaffDefaultPath(roleSet, result.restaurantRoles);
      }
      if (fromStr.startsWith("/setup")) {
        return fromStr;
      }
      if (fromStr.startsWith("/accept-invite")) {
        return fromStr;
      }
      return getStaffDefaultPath(roleSet, result.restaurantRoles);
    }

    // Diner path. If their profile is incomplete (missing name / email /
    // phone), gate them through /onboarding first.
    if (result.profile && !isProfileComplete(result.profile)) {
      return `/onboarding?from=${encodeURIComponent(fromStr)}`;
    }

    if (fromStr.startsWith("/dashboard")) {
      return "/discover";
    }
    return fromStr;
  }

  if (!isStaff && result.profile && !isProfileComplete(result.profile)) {
    return "/onboarding?from=%2Fdiscover";
  }

  return isStaff ? getStaffDefaultPath(roleSet, result.restaurantRoles) : "/discover";
}
