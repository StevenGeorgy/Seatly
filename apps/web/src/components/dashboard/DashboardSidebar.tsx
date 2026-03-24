import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  CalendarDays,
  MapPin,
  Clock,
  UtensilsCrossed,
  BookOpen,
  Users,
  CalendarCheck,
  UserCircle,
  BarChart3,
  Receipt,
  PartyPopper,
  FileDown,
  Settings,
  ChevronDown,
  Menu,
  X,
} from "lucide-react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { useUser } from "@/hooks/useUser";
import {
  DASHBOARD_NAV_ITEMS,
  canAccessDashboardPath,
  getStaffRoleSet,
} from "@/lib/auth/dashboard-access";
import { cn } from "@/lib/utils";
import type { StaffRole } from "@/types/auth";

const ICONS: Record<string, typeof LayoutDashboard> = {
  "/dashboard": LayoutDashboard,
  "/dashboard/reservations": CalendarDays,
  "/dashboard/floor-plan": MapPin,
  "/dashboard/waitlist": Clock,
  "/dashboard/orders": UtensilsCrossed,
  "/dashboard/menu": BookOpen,
  "/dashboard/staff": Users,
  "/dashboard/schedule": CalendarCheck,
  "/dashboard/crm": UserCircle,
  "/dashboard/analytics": BarChart3,
  "/dashboard/expenses": Receipt,
  "/dashboard/events": PartyPopper,
  "/dashboard/export": FileDown,
  "/dashboard/settings": Settings,
};

export function DashboardSidebar() {
  const { t } = useTranslation();
  const { restaurantRoles } = useUser();
  const { selectedRestaurantId, restaurants, setSelectedRestaurantId } =
    useRestaurantScope();
  const [mobileOpen, setMobileOpen] = useState(false);

  const roleSet = useMemo((): Set<StaffRole> => {
    if (!selectedRestaurantId) return new Set();
    return getStaffRoleSet(
      restaurantRoles.filter((r) => r.restaurant_id === selectedRestaurantId),
    );
  }, [restaurantRoles, selectedRestaurantId]);

  const visibleItems = useMemo(
    () => DASHBOARD_NAV_ITEMS.filter((item) => canAccessDashboardPath(item.path, roleSet)),
    [roleSet],
  );

  const settingsItem = visibleItems.find((i) => i.path === "/dashboard/settings");
  const mainItems = visibleItems.filter((i) => i.path !== "/dashboard/settings");

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex h-14 shrink-0 items-center px-5">
        <span className="text-sm font-bold tracking-[0.25em] text-gold">SEATLY</span>
      </div>

      {/* Restaurant switcher — only when multiple */}
      {restaurants.length > 1 && (
        <div className="px-4 pb-3">
          <div className="relative">
            <select
              className="w-full appearance-none rounded-lg border border-border bg-bg-elevated px-3 py-2 pr-8 text-sm font-medium text-foreground outline-none transition-all focus:border-gold/40"
              value={selectedRestaurantId ?? ""}
              onChange={(e) => setSelectedRestaurantId(e.target.value)}
            >
              {restaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name ?? r.slug}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2 scrollbar-thin" aria-label={t("dashboard.shell.navLabel")}>
        {mainItems.map((item, i) => {
          const Icon = ICONS[item.path] ?? LayoutDashboard;
          return (
            <motion.div
              key={item.path}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, delay: i * 0.012, ease: "easeOut" }}
            >
              <NavLink
                to={item.path}
                end={item.path === "/dashboard"}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
                    isActive
                      ? "bg-gold/8 text-gold"
                      : "text-text-muted hover:bg-white/[0.03] hover:text-text-secondary",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.div
                        layoutId="sidebar-indicator"
                        className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gold"
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      />
                    )}
                    <Icon
                      className={cn(
                        "size-[18px] shrink-0 transition-colors duration-150",
                        isActive ? "text-gold" : "text-text-muted group-hover:text-text-secondary",
                      )}
                    />
                    <span className="truncate">{t(item.labelKey)}</span>
                  </>
                )}
              </NavLink>
            </motion.div>
          );
        })}
      </nav>

      {/* Settings pinned at bottom */}
      {settingsItem && (
        <div className="border-t border-border px-3 py-2">
          <NavLink
            to={settingsItem.path}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
                isActive
                  ? "bg-gold/8 text-gold"
                  : "text-text-muted hover:bg-white/[0.03] hover:text-text-secondary",
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.div
                    layoutId="sidebar-indicator"
                    className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gold"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <Settings
                  className={cn(
                    "size-[18px] shrink-0 transition-colors duration-150",
                    isActive ? "text-gold" : "text-text-muted group-hover:text-text-secondary",
                  )}
                />
                <span className="truncate">{t(settingsItem.labelKey)}</span>
              </>
            )}
          </NavLink>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        type="button"
        className="fixed left-3 top-3 z-50 flex size-10 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-lg shadow-black/20 backdrop-blur-sm sm:hidden"
        onClick={() => setMobileOpen((v) => !v)}
        aria-label="Toggle menu"
      >
        {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>

      {/* Mobile overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm sm:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Mobile sidebar */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.aside
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-card sm:hidden"
          >
            {sidebarContent}
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-card sm:flex">
        {sidebarContent}
      </aside>
    </>
  );
}
