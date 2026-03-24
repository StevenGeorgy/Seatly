import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UserCircle, Search, Star, Ban } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { SectionCard } from "@/components/dashboard/SectionCard";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useGuests, type GuestRow } from "@/hooks/useGuests";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { formatCurrency } from "@/lib/utils/formatCurrency";

export default function CrmPage() {
  const { t } = useTranslation();
  const { selectedRestaurant } = useRestaurantScope();
  const currency = selectedRestaurant?.currency ?? "cad";
  const [search, setSearch] = useState("");
  const { guests, loading } = useGuests({ search: search || undefined });
  const [selectedGuest, setSelectedGuest] = useState<GuestRow | null>(null);

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader title={t("dashboard.crm.title")} />

      <div className="relative w-full sm:max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <Input
          placeholder={t("dashboard.crm.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <SectionCard noPadding>
        {loading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : guests.length === 0 ? (
          <EmptyState
            icon={<UserCircle className="size-5" />}
            title={t("dashboard.crm.noGuests")}
            description={t("dashboard.crm.noGuestsDesc")}
          />
        ) : (
          <div className="divide-y divide-border">
            <AnimatePresence mode="popLayout">
              {guests.map((guest, i) => (
                <motion.button
                  key={guest.id}
                  type="button"
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, delay: i * 0.02 }}
                  onClick={() => setSelectedGuest(guest)}
                  className="group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-bg-elevated/50"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-bg-elevated text-xs font-semibold text-text-secondary">
                    {(guest.full_name ?? "?")[0]?.toUpperCase()}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-text-primary">
                        {guest.full_name ?? "\u2014"}
                      </span>
                      {guest.is_vip ? (
                        <Star className="size-3.5 fill-gold text-gold" />
                      ) : null}
                      {guest.is_blocked ? (
                        <Ban className="size-3.5 text-danger" />
                      ) : null}
                    </div>
                    <span className="text-xs text-text-muted">
                      {guest.total_visits} visits \u00b7 {formatCurrency(guest.total_spend, currency)}
                    </span>
                  </div>
                  <div className="hidden flex-wrap gap-1 sm:flex">
                    {guest.tags?.slice(0, 3).map((tag) => (
                      <StatusBadge key={tag} status="active" label={tag} />
                    ))}
                  </div>
                  <div className="hidden flex-col items-end gap-0.5 md:flex">
                    <span className="text-xs font-medium text-gold">
                      {guest.loyalty_points_balance} pts
                    </span>
                    {guest.last_visit_at ? (
                      <span className="text-xs text-text-muted">
                        {format(new Date(guest.last_visit_at), "MMM d")}
                      </span>
                    ) : null}
                  </div>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        )}
      </SectionCard>

      {/* Guest Profile Drawer */}
      <Sheet open={!!selectedGuest} onOpenChange={() => setSelectedGuest(null)}>
        <SheetContent className="w-full border-border bg-bg-surface sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="text-text-primary">
              {t("dashboard.crm.guestProfile")}
            </SheetTitle>
          </SheetHeader>
          {selectedGuest ? (
            <div className="mt-6 flex flex-col gap-5">
              {/* Guest header */}
              <div className="flex items-center gap-4">
                <div className="flex size-14 items-center justify-center rounded-full border-2 border-gold/30 bg-gold/10 text-lg font-bold text-gold">
                  {(selectedGuest.full_name ?? "?")[0]?.toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-text-primary">
                    {selectedGuest.full_name ?? "\u2014"}
                  </p>
                  <p className="text-sm text-text-muted">{selectedGuest.email}</p>
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: t("dashboard.crm.visits"), value: String(selectedGuest.total_visits) },
                  { label: t("dashboard.crm.totalSpend"), value: formatCurrency(selectedGuest.total_spend, currency) },
                  { label: t("dashboard.crm.loyaltyPoints"), value: String(selectedGuest.loyalty_points_balance) },
                  { label: t("dashboard.analytics.noShowRate"), value: String(selectedGuest.no_show_count) },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-lg border border-border bg-bg-elevated px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{stat.label}</p>
                    <p className="mt-0.5 text-base font-semibold text-text-primary">{stat.value}</p>
                  </div>
                ))}
              </div>

              {/* Tags */}
              {selectedGuest.tags && selectedGuest.tags.length > 0 ? (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                    {t("dashboard.crm.tags")}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedGuest.tags.map((tag) => (
                      <StatusBadge key={tag} status="active" label={tag} />
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Preferences */}
              {selectedGuest.dietary_restrictions && selectedGuest.dietary_restrictions.length > 0 ? (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Dietary
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedGuest.dietary_restrictions.map((dr) => (
                      <StatusBadge key={dr} status="inactive" label={dr} />
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Notes */}
              {selectedGuest.internal_notes ? (
                <div className="rounded-lg border border-border bg-bg-elevated p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
                    {t("dashboard.crm.notes")}
                  </p>
                  <p className="text-sm text-text-secondary">{selectedGuest.internal_notes}</p>
                </div>
              ) : null}

              <Button variant="outline" className="w-full">
                {t("dashboard.crm.addNote")}
              </Button>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </AnimatedPage>
  );
}
