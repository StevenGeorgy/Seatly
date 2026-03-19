import type { NavItem } from "@seatly/types";
import type { LucideIcon } from "lucide-react";
import {
  LayoutGrid,
  Users,
  BarChart3,
  Settings,
  Sparkles,
  Shield,
} from "lucide-react";

export interface NavSection {
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

/**
 * Single active nav item: longest href that matches pathname (exact or prefix).
 * So /reservations/new highlights "New Reservation", not "Reservations".
 */
export function getActiveNavHref(pathname: string, hrefs: string[]): string | null {
  const normalized = pathname.replace(/\/$/, "") || "/";
  const matches = hrefs.filter(
    (href) => normalized === href || normalized.startsWith(`${href}/`)
  );
  if (matches.length === 0) return null;
  return matches.reduce((a, b) => (a.length >= b.length ? a : b));
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "OPERATIONS",
    icon: LayoutGrid,
    items: [
      { href: "/floor-plan", label: "Floor Plan", roles: ["host", "owner", "admin"] },
      { href: "/reservations", label: "Reservations", roles: ["host", "owner", "admin"] },
      { href: "/reservations/new", label: "New Reservation", roles: ["host", "owner", "admin"] },
      { href: "/waitlist", label: "Waitlist", roles: ["host", "owner"] },
      { href: "/my-tables", label: "My Tables", roles: ["waiter"] },
      { href: "/kitchen", label: "Kitchen Display", roles: ["kitchen"] },
    ],
  },
  {
    label: "GUESTS",
    icon: Users,
    items: [
      { href: "/crm", label: "CRM", roles: ["owner", "admin"] },
      { href: "/guests/search", label: "Guest Search", roles: ["host", "waiter", "owner", "admin"] },
    ],
  },
  {
    label: "BUSINESS",
    icon: BarChart3,
    items: [
      { href: "/dashboard", label: "Dashboard", roles: ["owner", "admin"] },
      { href: "/analytics", label: "Analytics", roles: ["owner", "admin"] },
      { href: "/analytics/menu", label: "Menu Analytics", roles: ["owner", "admin"] },
      { href: "/menu", label: "Menu", roles: ["owner", "admin"] },
      { href: "/events", label: "Events", roles: ["owner", "admin"] },
      { href: "/marketing", label: "Marketing", roles: ["owner", "admin"] },
    ],
  },
  {
    label: "MANAGE",
    icon: Settings,
    items: [
      { href: "/settings/staff", label: "Staff", roles: ["owner", "admin"] },
      { href: "/staff/schedule", label: "Schedule", roles: ["owner", "admin"] },
      { href: "/settings/shifts", label: "Shifts", roles: ["owner", "admin"] },
      { href: "/settings/floor-plan", label: "Floor Plan Editor", roles: ["owner", "admin"] },
      { href: "/settings", label: "Settings", roles: ["owner", "admin"] },
      { href: "/billing", label: "Billing", roles: ["owner", "admin"] },
      { href: "/onboarding", label: "Onboarding", roles: ["owner"] },
    ],
  },
  {
    label: "AI",
    icon: Sparkles,
    items: [{ href: "/assistant", label: "AI Assistant", roles: ["owner", "admin"] }],
  },
  {
    label: "ADMIN",
    icon: Shield,
    items: [{ href: "/admin", label: "Admin", roles: ["admin"] }],
  },
];
