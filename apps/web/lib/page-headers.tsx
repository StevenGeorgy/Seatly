/**
 * Page header configs for premium layout across the app.
 * Import and spread into PageHeader: <PageHeader {...PAGE_HEADERS.analytics} />
 */

import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  BarChart3,
  CreditCard,
  Search,
  UtensilsCrossed,
  Settings,
  Users,
  Calendar,
  ClipboardList,
  ChefHat,
  User,
  Megaphone,
  CalendarPlus,
  Clock,
  LayoutGrid,
  Sparkles,
  Table2,
} from "lucide-react";

export type PageHeaderConfig = {
  title: string;
  label: string;
  subtitle: string;
  icon: LucideIcon;
};

export const PAGE_HEADERS: Record<string, PageHeaderConfig> = {
  dashboard: {
    title: "Dashboard",
    label: "Business",
    subtitle: "Today's metrics and service overview",
    icon: LayoutDashboard,
  },
  analytics: {
    title: "Analytics Dashboard",
    label: "Insights",
    subtitle: "Revenue, operations, and performance metrics",
    icon: BarChart3,
  },
  analyticsMenu: {
    title: "Most Ordered Items",
    label: "Analytics",
    subtitle: "Top dishes by orders and revenue",
    icon: BarChart3,
  },
  billing: {
    title: "Billing",
    label: "Account",
    subtitle: "Plans, invoices, and payment methods",
    icon: CreditCard,
  },
  guestSearch: {
    title: "Guest Search",
    label: "CRM",
    subtitle: "Find guests by name, phone, or email",
    icon: Search,
  },
  myTables: {
    title: "My Tables",
    label: "Service",
    subtitle: "Your assigned tables and orders",
    icon: Table2,
  },
  settings: {
    title: "Settings",
    label: "Account",
    subtitle: "Restaurant profile and preferences",
    icon: Settings,
  },
  staff: {
    title: "Staff Management",
    label: "Settings",
    subtitle: "Team members and roles",
    icon: Users,
  },
  shifts: {
    title: "Shift Management",
    label: "Settings",
    subtitle: "Shifts and schedules",
    icon: Clock,
  },
  reservations: {
    title: "Today's Reservations",
    label: "Service",
    subtitle: "Bookings and seating",
    icon: Calendar,
  },
  newReservation: {
    title: "New Reservation",
    label: "Reservations",
    subtitle: "Create a new booking",
    icon: CalendarPlus,
  },
  waitlist: {
    title: "Waitlist",
    label: "Service",
    subtitle: "Manage walk-in guests",
    icon: ClipboardList,
  },
  kitchen: {
    title: "Kitchen Display",
    label: "Operations",
    subtitle: "Orders and tickets",
    icon: ChefHat,
  },
  crm: {
    title: "Guest CRM",
    label: "Guests",
    subtitle: "Customer relationships and history",
    icon: Users,
  },
  guestProfile: {
    title: "Guest Profile",
    label: "CRM",
    subtitle: "Guest details and visit history",
    icon: User,
  },
  menu: {
    title: "Menu Management",
    label: "Operations",
    subtitle: "Items, categories, and pricing",
    icon: UtensilsCrossed,
  },
  marketing: {
    title: "Marketing Messages",
    label: "Marketing",
    subtitle: "SMS and email campaigns",
    icon: Megaphone,
  },
  staffSchedule: {
    title: "Staff Scheduling",
    label: "Staff",
    subtitle: "Weekly schedules and shifts",
    icon: Calendar,
  },
  floorPlan: {
    title: "Live Floor Plan",
    label: "Service",
    subtitle: "Real-time table status and layout",
    icon: LayoutGrid,
  },
  floorPlanEditor: {
    title: "Floor Plan Editor",
    label: "Layout",
    subtitle: "Design tables, walls, and your restaurant layout",
    icon: LayoutGrid,
  },
  events: {
    title: "Events Management",
    label: "Operations",
    subtitle: "Private events and group bookings",
    icon: Calendar,
  },
  onboarding: {
    title: "Restaurant Onboarding Wizard",
    label: "Setup",
    subtitle: "Configure your restaurant",
    icon: Sparkles,
  },
};
