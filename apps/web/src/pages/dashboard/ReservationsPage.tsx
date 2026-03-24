import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { CalendarDays, Plus, Search } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { SectionCard } from "@/components/dashboard/SectionCard";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useReservations, type ReservationFilters } from "@/hooks/useReservations";

const STATUS_TABS = ["all", "pending", "confirmed", "seated", "completed", "cancelled"] as const;

export default function ReservationsPage() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const filters = useMemo((): ReservationFilters => ({
    status: statusFilter === "all" ? undefined : statusFilter,
    search: search || undefined,
  }), [statusFilter, search]);

  const { reservations, loading } = useReservations(filters);

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader
        title={t("dashboard.reservations.title")}
        actions={
          <Button size="default" className="gap-2">
            <Plus className="size-4" />
            {t("dashboard.reservations.newReservation")}
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList>
            {STATUS_TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab} className="capitalize">
                {t(`dashboard.reservations.${tab === "all" ? "all" : tab}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input
            placeholder={t("dashboard.reservations.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Reservation List */}
      <SectionCard noPadding>
        {loading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : reservations.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="size-5" />}
            title={t("dashboard.reservations.noReservations")}
            description={t("dashboard.reservations.noReservationsDesc")}
          />
        ) : (
          <div className="divide-y divide-border">
            <AnimatePresence mode="popLayout">
              {reservations.map((r, i) => {
                const guestName = r.guests?.full_name ?? r.guest_full_name ?? "\u2014";
                const time = format(new Date(r.reserved_at), "MMM d, h:mm a");

                return (
                  <motion.div
                    key={r.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.2, delay: i * 0.02 }}
                    className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-bg-elevated/50"
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gold/10 font-mono text-xs font-semibold text-gold">
                      {r.party_size}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium text-text-primary">
                        {guestName}
                      </span>
                      <span className="text-xs text-text-muted">
                        {time}
                        {r.special_request ? ` \u00b7 ${r.special_request}` : ""}
                      </span>
                    </div>
                    {r.confirmation_code ? (
                      <span className="hidden font-mono text-xs text-text-muted sm:block">
                        {r.confirmation_code}
                      </span>
                    ) : null}
                    <StatusBadge status={r.status} />
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      {r.status === "confirmed" ? (
                        <Button variant="ghost" size="sm">
                          {t("dashboard.reservations.checkIn")}
                        </Button>
                      ) : null}
                      {r.status === "pending" ? (
                        <Button variant="ghost" size="sm">
                          {t("common.actions.confirm")}
                        </Button>
                      ) : null}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </SectionCard>
    </AnimatedPage>
  );
}
