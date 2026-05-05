import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  CalendarDays,
  MapPin,
  ClipboardList,
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
  Tag,
  ChevronDown,
  Check,
  Menu,
  Plus,
  X,
  User,
  Eye,
  Bell,
  LogOut,
  Store,
  UserPlus,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RestaurantPreviewModal, type RestaurantPreviewSummary } from "@/components/customer/RestaurantPreviewModal";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { usePublicRestaurants } from "@/hooks/useRestaurant";
import { useRestaurantPreviewStats } from "@/hooks/useRestaurantPreviewStats";
import { useUser } from "@/hooks/useUser";
import { useNotifications } from "@/hooks/useNotifications";
import { restaurantPriceLabelFromRange } from "@/lib/restaurant-price-level";
import {
  DASHBOARD_NAV_ITEMS,
  canAccessDashboardPath,
  getStaffRoleSet,
} from "@/lib/auth/dashboard-access";
import { cn } from "@/lib/utils";
import { formatCompactTimeLabel } from "@/lib/utils/time";
import type { StaffRole } from "@/types/auth";

function RestaurantLogoBadge({
  logoUrl,
  fallback,
  className,
}: {
  logoUrl: string | null | undefined;
  fallback: string;
  className: string;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gold/30 bg-gold/10 font-mono font-semibold text-gold",
        className,
      )}
    >
      {logoUrl ? <img src={logoUrl} alt="" className="size-full object-cover" /> : fallback}
    </span>
  );
}

const ICONS: Record<string, typeof LayoutDashboard> = {
  "/dashboard": LayoutDashboard,
  "/dashboard/reservations": CalendarDays,
  "/dashboard/floor-plan": MapPin,
  "/dashboard/host-view": ClipboardList,
  "/dashboard/staff-invites": UserPlus,
  "/dashboard/host": UserPlus,
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
  "/dashboard/restaurant": Store,
  "/dashboard/settings": Settings,
  "/dashboard/promotions": Tag,
};

export function DashboardSidebar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isFloorPlanRoute = pathname.includes("/floor-plan");
  const { profile, restaurantRoles, canUseCustomerView, switchToCustomerView, signOut } = useUser();
  const { notifications, unreadCount, markRead } = useNotifications();
  const { selectedRestaurantId, restaurants, setSelectedRestaurantId } =
    useRestaurantScope();
  const { restaurants: publicRestaurants } = usePublicRestaurants();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFavorite, setPreviewFavorite] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

  const roleSet = useMemo((): Set<StaffRole> => {
    if (!selectedRestaurantId) return new Set();
    return getStaffRoleSet(
      restaurantRoles.filter((r) => r.restaurant_id === selectedRestaurantId),
    );
  }, [restaurantRoles, selectedRestaurantId]);

  const scopedRoles = useMemo(
    () => restaurantRoles.filter((r) => r.restaurant_id === selectedRestaurantId),
    [restaurantRoles, selectedRestaurantId],
  );

  const visibleItems = useMemo(
    () => DASHBOARD_NAV_ITEMS.filter((item) => canAccessDashboardPath(item.path, roleSet, scopedRoles)),
    [roleSet, scopedRoles],
  );

  const settingsItem = visibleItems.find((i) => i.path === "/dashboard/settings");
  const mainItems = visibleItems.filter((i) => i.path !== "/dashboard/settings");

  const selectedRestaurant = restaurants.find((r) => r.id === selectedRestaurantId) ?? restaurants[0];
  const publicRestaurant =
    publicRestaurants.find((r) => r.id === selectedRestaurant?.id || r.slug === selectedRestaurant?.slug) ?? null;
  const { stats: previewStats } = useRestaurantPreviewStats(selectedRestaurant?.id);
  const ROLE_PRIORITY: StaffRole[] = ["owner", "manager", "host", "server", "kitchen", "bar", "staff"];
  const primaryRole = ROLE_PRIORITY.find((r) => roleSet.has(r));
  const roleLabel = primaryRole ? t(`dashboard.shell.staffRole.${primaryRole}`) : null;
  const restaurantInitials = (selectedRestaurant?.name ?? selectedRestaurant?.slug ?? "??")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const restaurantRoleLabel = (restaurantId: string) => {
    const roles = getStaffRoleSet(restaurantRoles.filter((r) => r.restaurant_id === restaurantId));
    const role = ROLE_PRIORITY.find((r) => roles.has(r));
    return role ? t(`dashboard.shell.staffRole.${role}`) : null;
  };
  const restaurantInitialsFor = (name: string | null | undefined, slug: string) =>
    (name ?? slug ?? "??")
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  const profileLabel = profile?.full_name ?? profile?.email ?? t("routes.account.title");
  const profileInitials = profileLabel
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const previewRestaurant = selectedRestaurant
    ? ({
        id: selectedRestaurant.id,
        name: publicRestaurant?.name ?? selectedRestaurant.name ?? selectedRestaurant.slug,
        cuisine: publicRestaurant?.cuisine_type ?? "",
        price: restaurantPriceLabelFromRange(publicRestaurant?.price_range),
        area: publicRestaurant?.city ?? publicRestaurant?.address ?? "",
        bookedToday: previewStats.bookedToday,
        slots: [],
        initials: (publicRestaurant?.name ?? selectedRestaurant.name ?? selectedRestaurant.slug)
          .split(/\s+/)
          .slice(0, 2)
          .join(" ")
          .toUpperCase(),
        badge: publicRestaurant?.business_type ?? "",
        city: publicRestaurant?.city ?? "",
        distanceKm: 0,
        features: [
          publicRestaurant?.cuisine_type,
          publicRestaurant?.business_type,
          publicRestaurant?.city,
        ].filter(Boolean) as string[],
        logoUrl: selectedRestaurant.logo_url,
        coverPhotoUrl: publicRestaurant?.cover_photo_url ?? selectedRestaurant.cover_photo_url,
      } satisfies RestaurantPreviewSummary)
    : null;

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex h-14 shrink-0 items-center px-5">
        <span className="text-sm font-bold tracking-[0.25em] text-gold">CENAIVA</span>
      </div>

      {/* Restaurant switcher card */}
      <div className="px-4 pb-2 pt-1">
        <Popover open={workspaceOpen} onOpenChange={setWorkspaceOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t("dashboard.shell.switchRestaurant")}
              className="relative w-full rounded-xl border border-border bg-bg-elevated/60 px-3 py-2.5 text-left transition-colors hover:border-gold/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
            >
              <div className="flex items-center gap-3">
                <RestaurantLogoBadge
                  logoUrl={selectedRestaurant?.logo_url}
                  fallback={restaurantInitials}
                  className="size-10 border-gold/40 text-xs"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-text-primary">
                    {selectedRestaurant?.name ?? selectedRestaurant?.slug ?? "—"}
                  </p>
                  {roleLabel && (
                    <p className="truncate text-xs text-text-muted">{roleLabel}</p>
                  )}
                </div>
                <ChevronDown
                  className={cn(
                    "size-4 shrink-0 text-text-muted transition-transform",
                    workspaceOpen && "rotate-180 text-gold",
                  )}
                />
              </div>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="right" sideOffset={10} className="w-72 p-0">
            <div className="border-b border-border px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold">
                {t("dashboard.shell.workspaces")}
              </p>
              <p className="mt-1 text-xs text-text-muted">{t("dashboard.shell.switchRestaurant")}</p>
            </div>
            <div className="max-h-72 overflow-y-auto p-2">
              {restaurants.length === 0 ? (
                <p className="px-2 py-4 text-sm text-text-muted">{t("dashboard.shell.noRestaurants")}</p>
              ) : (
                restaurants.map((restaurant) => {
                  const isSelected = restaurant.id === selectedRestaurantId;
                  const restaurantName = restaurant.name ?? restaurant.slug;
                  const restaurantRole = restaurantRoleLabel(restaurant.id);

                  return (
                    <button
                      key={restaurant.id}
                      type="button"
                      onClick={() => {
                        setSelectedRestaurantId(restaurant.id);
                        setWorkspaceOpen(false);
                        setMobileOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                        isSelected ? "bg-gold/10 text-text-primary" : "text-text-secondary hover:bg-bg-elevated",
                      )}
                    >
                      <RestaurantLogoBadge
                        logoUrl={restaurant.logo_url}
                        fallback={restaurantInitialsFor(restaurant.name, restaurant.slug)}
                        className="size-9 text-[11px]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{restaurantName}</span>
                        {restaurantRole ? (
                          <span className="block truncate text-xs text-text-muted">{restaurantRole}</span>
                        ) : null}
                      </span>
                      {isSelected ? <Check className="size-4 shrink-0 text-gold" /> : null}
                    </button>
                  );
                })
              )}
            </div>
            <div className="border-t border-border p-2">
              <button
                type="button"
                onClick={() => {
                  setWorkspaceOpen(false);
                  setMobileOpen(false);
                  void navigate("/setup");
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-gold transition-colors hover:bg-gold/10"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-gold/10">
                  <Plus className="size-4" />
                </span>
                <span>{t("dashboard.shell.addRestaurant")}</span>
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Navigation */}
      <p className="px-5 pb-2 pt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-gold">
        Tonight
      </p>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-1 scrollbar-thin" aria-label={t("dashboard.shell.navLabel")}>
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
                    <span className="truncate">
                      {item.path === "/dashboard/orders" ? t("dashboard.orders.preordersTitle") : t(item.labelKey)}
                    </span>
                  </>
                )}
              </NavLink>
            </motion.div>
          );
        })}
      </nav>

      {/* Account actions pinned at bottom */}
      <div className="border-t border-border px-3 py-2">
        <div className="mb-2 flex items-center gap-2 border-b border-border px-2 pb-2 pt-2">
          <span className="flex min-w-0 flex-1 items-center">
            <button
              type="button"
              className="flex size-9 items-center justify-center rounded-full bg-gold/15 font-mono text-xs font-semibold text-gold transition-colors hover:bg-gold/25"
              aria-label={t("routes.account.title")}
              title={profileLabel}
              onClick={() => {
                void navigate("/account");
                setMobileOpen(false);
              }}
            >
              {profileInitials || <User className="size-4" />}
            </button>
          </span>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="relative flex size-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-elevated/60 hover:text-text-primary"
                aria-label="Notifications"
              >
                <Bell className="size-4" />
                {unreadCount > 0 && (
                  <span className="absolute right-1 top-1 size-1.5 rounded-full bg-danger" />
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="top" className="w-80 p-0">
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-semibold text-text-primary">Notifications</p>
                {unreadCount > 0 && (
                  <p className="text-xs text-text-muted">{unreadCount} unread</p>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-text-muted">No notifications yet.</p>
                ) : (
                  notifications.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => {
                        void markRead(n.id);
                        if (n.data?.route && typeof n.data.route === "string") {
                          navigate(n.data.route);
                        }
                      }}
                      className={cn(
                        "flex w-full flex-col gap-0.5 border-b border-border px-4 py-3 text-left transition-colors last:border-0 hover:bg-bg-elevated/60",
                        !n.is_read && "bg-gold/5",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={cn("text-xs font-medium", !n.is_read ? "text-text-primary" : "text-text-secondary")}>
                          {n.title}
                        </span>
                        {!n.is_read && (
                          <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-gold" />
                        )}
                      </div>
                      {n.body ? (
                        <span className="line-clamp-2 text-xs text-text-muted">{n.body}</span>
                      ) : null}
                      <span className="text-[10px] text-text-muted">
                        {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>
          <span className="h-4 w-px bg-border" />
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex size-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-elevated/60 hover:text-danger"
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>

        {canUseCustomerView && (
          <button
            type="button"
            onClick={() => {
              switchToCustomerView();
              void navigate("/discover");
              setMobileOpen(false);
            }}
            className="group relative mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gold transition-all duration-150 hover:bg-gold/10"
          >
            <User className="size-[18px] shrink-0 text-gold" />
            <span className="truncate">{t("dashboard.shell.switchToCustomerView")}</span>
          </button>
        )}

        {settingsItem && (
          <>
          {(selectedRestaurant?.slug ?? selectedRestaurant?.id) && (
            <button
              type="button"
              onClick={() => {
                setPreviewOpen(true);
                setMobileOpen(false);
              }}
              className="group relative mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gold transition-all duration-150 hover:bg-gold/10"
            >
              <Eye className="size-[18px] shrink-0 text-gold" />
              <span className="truncate">{t("dashboard.shell.previewRestaurant")}</span>
            </button>
          )}
          <NavLink
            to={settingsItem.path}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gold transition-all duration-150 hover:bg-gold/10",
                isActive && "bg-gold/10",
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
                <Settings className="size-[18px] shrink-0 text-gold" />
                <span className="truncate">{t(settingsItem.labelKey)}</span>
              </>
            )}
          </NavLink>
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        type="button"
        className={cn(
          "fixed left-3 top-3 z-50 flex size-10 items-center justify-center rounded-lg border border-border text-foreground shadow-lg shadow-black/20 backdrop-blur-sm sm:hidden",
          isFloorPlanRoute ? "bg-bg-surface" : "bg-card",
        )}
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
            className="fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-bg-base sm:hidden"
          >
            {sidebarContent}
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      <aside
        className="hidden w-56 shrink-0 flex-col border-r border-border bg-bg-base sm:flex"
      >
        {sidebarContent}
      </aside>
      <RestaurantPreviewModal
        restaurant={previewOpen ? previewRestaurant : null}
        favorite={previewFavorite}
        partySize="2"
        currencyCode={selectedRestaurant?.currency ?? "cad"}
        onClose={() => setPreviewOpen(false)}
        onToggleFavorite={() => setPreviewFavorite((value) => !value)}
        onReserve={(slot, selectedPartySize, shiftId, displayTime) => {
          if (!selectedRestaurant) return;
          const publicPath = `/${selectedRestaurant.slug ?? selectedRestaurant.id}`;
          const shiftQuery = shiftId ? `&shift_id=${encodeURIComponent(shiftId)}` : "";
          const timeParam = displayTime ? formatCompactTimeLabel(displayTime) : formatCompactTimeLabel(slot);
          const query =
            slot === "waitlist"
              ? "back=dashboard"
              : `slot=${encodeURIComponent(slot)}&time=${encodeURIComponent(timeParam)}&people=${selectedPartySize}${shiftQuery}&back=dashboard`;
          setPreviewOpen(false);
          void navigate(`${publicPath}?${query}`);
        }}
      />
    </>
  );
}
