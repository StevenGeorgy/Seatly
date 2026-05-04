import { useCallback, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useUser } from "@/hooks/useUser";
import { useAssistant } from "@/components/cenaiva/AssistantProvider";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  to: string;
  /** Pathname prefixes that should mark this link as active. */
  activeWhen: string[];
  onClick?: () => void;
};

/**
 * Top-of-page nav for customer-facing screens.
 * Routes Promotions / Bookings / Loyalty differently for staff so they don't
 * get bounced by RequireCustomer when clicking from a customer-view screen.
 */
export function CustomerNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isStaff, canUseCustomerView, switchToCustomerView } = useUser();
  const assistant = useAssistant();

  const goCustomer = useCallback(
    (to: string) => {
      if (canUseCustomerView) switchToCustomerView();
      void navigate(to);
    },
    [canUseCustomerView, switchToCustomerView, navigate],
  );

  const links: NavItem[] = useMemo(() => {
    const promotionsTo =
      isStaff && !canUseCustomerView ? "/dashboard/promotions" : "/deals";
    const bookingsTo =
      isStaff && !canUseCustomerView ? "/dashboard/reservations" : "/bookings";
    // Loyalty has no dedicated customer page yet — staff CRM is the nearest fit.
    const loyaltyTo = isStaff && !canUseCustomerView ? "/dashboard/crm" : "/loyalty";

    const wrap = (to: string) =>
      isStaff && canUseCustomerView ? () => goCustomer(to) : undefined;

    return [
      {
        label: "Discover",
        to: isStaff && !canUseCustomerView ? "/dashboard" : "/discover",
        activeWhen: ["/discover", "/dashboard"],
        onClick: wrap("/discover"),
      },
      {
        label: "Promotions",
        to: promotionsTo,
        activeWhen: ["/deals", "/dashboard/promotions"],
        onClick: wrap("/deals"),
      },
      {
        label: "Bookings",
        to: bookingsTo,
        activeWhen: ["/bookings", "/dashboard/reservations"],
        onClick: wrap("/bookings"),
      },
      {
        label: "Loyalty",
        to: loyaltyTo,
        activeWhen: ["/loyalty", "/dashboard/crm"],
        onClick: wrap("/loyalty"),
      },
    ];
  }, [isStaff, canUseCustomerView, goCustomer]);

  const isActive = (item: NavItem) =>
    item.activeWhen.some(
      (p) => location.pathname === p || location.pathname.startsWith(`${p}/`),
    );

  return (
    <nav className="hidden flex-1 items-center justify-center gap-1 md:flex" aria-label="Primary">
      {links.map((link) => {
        const active = isActive(link);
        return (
          <Link
            key={link.label}
            to={link.to}
            onClick={(e) => {
              if (link.onClick) {
                e.preventDefault();
                link.onClick();
              }
            }}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "border-b-2 border-gold text-white"
                : "text-text-secondary hover:text-white",
            )}
            aria-current={active ? "page" : undefined}
          >
            {link.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={() => assistant?.open(undefined, undefined, { autoListen: false })}
        className="rounded-md px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:text-white"
      >
        Concierge
      </button>
    </nav>
  );
}
