import { useTranslation } from "react-i18next";
import { PartyPopper, Plus, Calendar, Users } from "lucide-react";
import { format } from "date-fns";
import { motion } from "framer-motion";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useEvents } from "@/hooks/useEvents";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { formatCurrency } from "@/lib/utils/formatCurrency";

export default function EventsPage() {
  const { t } = useTranslation();
  const { selectedRestaurant } = useRestaurantScope();
  const currency = selectedRestaurant?.currency ?? "cad";
  const { events, loading } = useEvents();

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader
        title={t("dashboard.events.title")}
        actions={
          <Button size="default" className="gap-2">
            <Plus className="size-4" />
            {t("dashboard.events.createEvent")}
          </Button>
        }
      />

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[260px] rounded-lg" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={<PartyPopper className="size-5" />}
          title={t("dashboard.events.noEvents")}
          description={t("dashboard.events.noEventsDesc")}
          action={
            <Button size="default" className="gap-2">
              <Plus className="size-4" />
              {t("dashboard.events.createEvent")}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((event, i) => {
            const ticketPercent = event.capacity
              ? Math.round((event.tickets_sold / event.capacity) * 100)
              : 0;

            return (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                className="group overflow-hidden rounded-lg border border-border bg-bg-surface transition-colors hover:border-gold/30"
              >
                {event.cover_image_url ? (
                  <div className="relative h-32 w-full overflow-hidden bg-bg-elevated">
                    <img
                      src={event.cover_image_url}
                      alt={event.name}
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-bg-base/80 to-transparent" />
                  </div>
                ) : (
                  <div className="flex h-32 items-center justify-center bg-bg-elevated">
                    <PartyPopper className="size-8 text-text-muted" />
                  </div>
                )}
                <div className="flex flex-col gap-3 p-4">
                  <h3 className="truncate text-sm font-semibold text-text-primary">
                    {event.name}
                  </h3>
                  <div className="flex items-center gap-3 text-xs text-text-muted">
                    <span className="flex items-center gap-1">
                      <Calendar className="size-3.5" />
                      {format(new Date(event.date), "MMM d, yyyy")}
                    </span>
                    {event.price_per_person ? (
                      <span>{formatCurrency(event.price_per_person, currency)}/person</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Progress value={ticketPercent} className="h-1.5 flex-1" />
                    <span className="flex items-center gap-1 text-xs text-text-secondary">
                      <Users className="size-3" />
                      {event.tickets_sold}/{event.capacity ?? "\u221e"}
                    </span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </AnimatedPage>
  );
}
