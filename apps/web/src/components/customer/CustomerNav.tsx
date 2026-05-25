import { useCallback, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUser } from "@/hooks/useUser";
import { useAssistant } from "@/components/cenaiva/AssistantProvider";
import { buildWakeGreeting } from "@/lib/cenaiva/buildWakeGreeting";
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
  const { user, isStaff, canUseCustomerView, switchToCustomerView } = useUser();
  const assistant = useAssistant();
  const [signInDialogOpen, setSignInDialogOpen] = useState(false);

  const handleConciergeClick = () => {
    if (!user) {
      setSignInDialogOpen(true);
      return;
    }
    const greetingText = buildWakeGreeting(user);
    assistant?.open(undefined, undefined, { autoListen: true, greetingText });
  };

  const handleSignInRedirect = () => {
    setSignInDialogOpen(false);
    // Round-trip back to /discover with ?concierge=1 so the auto-open
    // useEffect on DiscoverPage fires after login.
    void navigate(`/login?from=${encodeURIComponent("/discover?concierge=1")}`);
  };

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
      user
        ? {
            label: "Bookings",
            to: bookingsTo,
            activeWhen: ["/bookings", "/dashboard/reservations"],
            onClick: wrap("/bookings"),
          }
        : {
            label: "Find my reservation",
            to: "/find-reservation",
            activeWhen: ["/find-reservation"],
          },
      {
        label: "Loyalty",
        to: loyaltyTo,
        activeWhen: ["/loyalty", "/dashboard/crm"],
        onClick: wrap("/loyalty"),
      },
    ];
  }, [user, isStaff, canUseCustomerView, goCustomer]);

  const isActive = (item: NavItem) =>
    item.activeWhen.some(
      (p) => location.pathname === p || location.pathname.startsWith(`${p}/`),
    );

  return (
    <nav className="hidden flex-1 items-center justify-center gap-2 md:flex" aria-label="Primary">
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
              "rounded-md px-4 py-2.5 text-base font-medium transition-colors md:px-5 md:py-3",
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
      {import.meta.env.VITE_CENAIVA_AI_DISABLED !== "true" && (
        <button
          type="button"
          onClick={handleConciergeClick}
          className="rounded-md px-4 py-2.5 text-base font-medium text-text-secondary transition-colors hover:text-white md:px-5 md:py-3"
        >
          Concierge
        </button>
      )}
      <Dialog open={signInDialogOpen} onOpenChange={setSignInDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl text-white">
              Sign in to use Hey Cenaiva
            </DialogTitle>
            <DialogDescription className="text-text-secondary">
              Hey Cenaiva is our voice concierge — it books tables, finds you
              deals, and answers questions about restaurants. Sign in or
              create a free account to start chatting.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSignInDialogOpen(false)}
            >
              Maybe later
            </Button>
            <Button type="button" onClick={handleSignInRedirect}>
              Sign in
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </nav>
  );
}
