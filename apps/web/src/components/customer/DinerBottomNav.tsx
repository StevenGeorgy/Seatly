import { Link } from "react-router-dom";
import {
  CalendarDays,
  Compass,
  Tag,
  User,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  useDinerNavLinks,
  type DinerNavId,
  type DinerNavItem,
} from "@/hooks/useDinerNavLinks";

// Icon per destination. `find-reservation` only appears for logged-out users,
// but the bottom bar mounts for authenticated diners only — fall back anyway.
const ICONS: Record<DinerNavId, LucideIcon> = {
  discover: Compass,
  promotions: Tag,
  bookings: CalendarDays,
  "find-reservation": CalendarDays,
  loyalty: Tag,
  account: User,
};

/**
 * Mobile-only bottom tab bar for the diner app (Apple HIG / Material 3: 4
 * persistent destinations, icon + label). Hidden at `md+`, where the desktop
 * `CustomerNav` takes over. Loyalty intentionally lives inside the Account
 * section rather than as a 5th tab.
 */
export function DinerBottomNav() {
  const { items, isActive } = useDinerNavLinks();
  // Explicit short labels keep tabs compact at 390px (the hook's logged-out
  // "Bookings" label is the longer "Find my reservation"). Account adapts to
  // "Log in" for signed-out users via the hook.
  const tabs: { item: DinerNavItem; label: string }[] = [
    { item: items.discover, label: "Discover" },
    { item: items.promotions, label: "Promotions" },
    { item: items.bookings, label: "Bookings" },
    { item: items.account, label: items.account.label },
  ];

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 flex border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      {tabs.map(({ item, label }) => {
        const active = isActive(item);
        const Icon = ICONS[item.id];
        return (
          <Link
            key={item.id}
            to={item.to}
            onClick={(e) => {
              if (item.onClick) {
                e.preventDefault();
                item.onClick();
              }
            }}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-[3.5rem] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
              active ? "text-gold" : "text-text-secondary hover:text-white",
            )}
          >
            <Icon className="size-5" aria-hidden />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
