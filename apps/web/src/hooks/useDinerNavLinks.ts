import { useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useUser } from "@/hooks/useUser";

export type DinerNavId =
  | "discover"
  | "promotions"
  | "bookings"
  | "find-reservation"
  | "loyalty"
  | "account";

export type DinerNavItem = {
  id: DinerNavId;
  label: string;
  to: string;
  /** Pathname prefixes that mark this item active. */
  activeWhen: string[];
  /** When set, intercept the click (e.g. staff switching to customer view). */
  onClick?: () => void;
};

/**
 * Single source of truth for the diner primary-navigation destinations, shared
 * by the desktop top nav (`CustomerNav`) and the mobile `DinerBottomNav` so the
 * two can never drift. Staff are routed to their dashboard equivalents (unless
 * they're in customer view) so `RequireCustomer` doesn't bounce them.
 */
export function useDinerNavLinks() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isStaff, canUseCustomerView, switchToCustomerView } = useUser();

  const goCustomer = useCallback(
    (to: string) => {
      if (canUseCustomerView) switchToCustomerView();
      void navigate(to);
    },
    [canUseCustomerView, switchToCustomerView, navigate],
  );

  const items = useMemo(() => {
    const staffOnly = isStaff && !canUseCustomerView;
    const wrap = (to: string) =>
      isStaff && canUseCustomerView ? () => goCustomer(to) : undefined;

    const discover: DinerNavItem = {
      id: "discover",
      label: "Discover",
      to: staffOnly ? "/dashboard" : "/discover",
      activeWhen: ["/discover", "/dashboard"],
      onClick: wrap("/discover"),
    };

    const promotions: DinerNavItem = {
      id: "promotions",
      label: "Promotions",
      to: staffOnly ? "/dashboard/promotions" : "/deals",
      activeWhen: ["/deals", "/dashboard/promotions"],
      onClick: wrap("/deals"),
    };

    const bookings: DinerNavItem = user
      ? {
          id: "bookings",
          label: "Bookings",
          to: staffOnly ? "/dashboard/reservations" : "/bookings",
          activeWhen: ["/bookings", "/dashboard/reservations"],
          onClick: wrap("/bookings"),
        }
      : {
          id: "find-reservation",
          label: "Find my reservation",
          to: "/find-reservation",
          activeWhen: ["/find-reservation"],
        };

    // Loyalty has no dedicated customer page yet — staff CRM is the nearest fit.
    const loyalty: DinerNavItem = {
      id: "loyalty",
      label: "Loyalty",
      to: staffOnly ? "/dashboard/crm" : "/loyalty",
      activeWhen: ["/loyalty", "/dashboard/crm"],
      onClick: wrap("/loyalty"),
    };

    // Logged-out diners get a "Log in" tab in the same slot (tapping Account
    // when signed out would just bounce to the auth gate anyway).
    const account: DinerNavItem = user
      ? {
          id: "account",
          label: "Account",
          to: "/account",
          activeWhen: ["/account"],
          onClick: wrap("/account"),
        }
      : {
          id: "account",
          label: "Log in",
          to: "/login",
          activeWhen: ["/login"],
        };

    return { discover, promotions, bookings, loyalty, account };
  }, [user, isStaff, canUseCustomerView, goCustomer]);

  const isActive = useCallback(
    (item: DinerNavItem) =>
      item.activeWhen.some(
        (p) => location.pathname === p || location.pathname.startsWith(`${p}/`),
      ),
    [location.pathname],
  );

  return { items, isActive };
}
