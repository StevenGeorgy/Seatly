import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import {
  Users,
  DollarSign,
  ShoppingBag,
  AlertTriangle,
  CalendarDays,
} from "lucide-react";
import { motion } from "framer-motion";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { StatCard } from "@/components/dashboard/StatCard";
import { SectionCard } from "@/components/dashboard/SectionCard";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useReservations } from "@/hooks/useReservations";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { formatCurrency } from "@/lib/utils/formatCurrency";

export default function OverviewPage() {
  const { t } = useTranslation();
  const { selectedRestaurant } = useRestaurantScope();
  const currency = selectedRestaurant?.currency ?? "cad";

  const today = new Date().toISOString().split("T")[0];
  const { todayRow, loading: analyticsLoading } = useAnalytics({ from: today, to: today });
  const { reservations, loading: resLoading } = useReservations({ date: today });

  const loading = analyticsLoading || resLoading;

  const upcomingReservations = useMemo(
    () =>
      reservations
        .filter((r) => r.status !== "cancelled" && r.status !== "completed")
        .slice(0, 8),
    [reservations],
  );

  const noShowRisks = useMemo(
    () => reservations.filter((r) => (r.no_show_risk_score ?? 0) >= 60).length,
    [reservations],
  );

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader title={t("routes.dashboard.overview.title")} />

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-lg" />
          ))
        ) : (
          <>
            <StatCard
              label={t("dashboard.overview.tonightCovers")}
              value={String(todayRow?.total_covers ?? 0)}
              icon={<Users className="size-5" />}
            />
            <StatCard
              label={t("dashboard.overview.todayRevenue")}
              value={formatCurrency(todayRow?.total_revenue ?? 0, currency)}
              icon={<DollarSign className="size-5" />}
            />
            <StatCard
              label={t("dashboard.overview.openOrders")}
              value={String(todayRow?.total_orders ?? 0)}
              icon={<ShoppingBag className="size-5" />}
            />
            <StatCard
              label={t("dashboard.overview.noShowRisks")}
              value={String(noShowRisks)}
              icon={<AlertTriangle className="size-5" />}
            />
          </>
        )}
      </div>

      {/* Today's Reservations Timeline */}
      <SectionCard title={t("dashboard.overview.todayTimeline")}>
        {loading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : upcomingReservations.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="size-5" />}
            title={t("dashboard.overview.noReservations")}
            description={t("dashboard.overview.noReservationsDesc")}
          />
        ) : (
          <div className="flex flex-col gap-2">
            {upcomingReservations.map((r, i) => {
              const guestName = r.guests?.full_name ?? r.guest_full_name ?? "\u2014";
              const time = format(new Date(r.reserved_at), "h:mm a");

              return (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, delay: i * 0.04 }}
                  className="group flex items-center gap-4 rounded-lg border border-border bg-bg-elevated/50 px-4 py-3 transition-colors hover:border-gold/30"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gold/10 text-xs font-semibold text-gold">
                    {time}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-text-primary">
                      {guestName}
                    </span>
                    <span className="text-xs text-text-muted">
                      {r.party_size} {r.party_size === 1 ? "guest" : "guests"}
                      {r.occasion ? ` \u00b7 ${r.occasion}` : ""}
                    </span>
                  </div>
                  <StatusBadge status={r.status} />
                </motion.div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </AnimatedPage>
  );
}
