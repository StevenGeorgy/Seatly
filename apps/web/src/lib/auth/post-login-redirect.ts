import {
  canAccessDashboardPath,
  getStaffDefaultPath,
  getStaffRoleSet,
} from "@/lib/auth/dashboard-access";
import type { LoadUserContextResult } from "@/lib/supabase/load-user-context";

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
 */
export function resolvePostLoginPath(from: unknown, result: OkContext): string {
  const fromStr = typeof from === "string" ? from : undefined;
  const roleSet = getStaffRoleSet(result.restaurantRoles);
  const isStaff = roleSet.size > 0;

  if (fromStr && isSafeRedirectPath(fromStr)) {
    if (isStaff) {
      if (fromStr.startsWith("/dashboard")) {
        return canAccessDashboardPath(fromStr, roleSet)
          ? fromStr
          : getStaffDefaultPath(roleSet);
      }
      if (fromStr.startsWith("/discover") || fromStr.startsWith("/account")) {
        return getStaffDefaultPath(roleSet);
      }
      if (fromStr.startsWith("/setup")) {
        return fromStr;
      }
      return getStaffDefaultPath(roleSet);
    }

    if (fromStr.startsWith("/dashboard")) {
      return "/discover";
    }
    return fromStr;
  }

  return isStaff ? getStaffDefaultPath(roleSet) : "/discover";
}
