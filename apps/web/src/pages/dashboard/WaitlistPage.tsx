import { useTranslation } from "react-i18next";
import { Clock, Plus, Bell, Armchair, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { SectionCard } from "@/components/dashboard/SectionCard";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWaitlist } from "@/hooks/useWaitlist";

export default function WaitlistPage() {
  const { t } = useTranslation();
  const { entries, loading } = useWaitlist();

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader
        title={t("dashboard.waitlist.title")}
        actions={
          <Button size="default" className="gap-2">
            <Plus className="size-4" />
            {t("dashboard.waitlist.addGuest")}
          </Button>
        }
      />

      <SectionCard noPadding>
        {loading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<Clock className="size-5" />}
            title={t("dashboard.waitlist.noEntries")}
            description={t("dashboard.waitlist.noEntriesDesc")}
          />
        ) : (
          <div className="divide-y divide-border">
            <AnimatePresence mode="popLayout">
              {entries.map((entry, i) => (
                <motion.div
                  key={entry.id}
                  layout
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10, height: 0 }}
                  transition={{ duration: 0.25, delay: i * 0.03 }}
                  className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-bg-elevated/50"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-gold bg-gold/10 text-sm font-bold text-gold">
                    {entry.position}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-text-primary">
                      {entry.guest_name ?? "\u2014"}
                    </span>
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <span>{entry.party_size} guests</span>
                      {entry.estimated_wait_minutes ? (
                        <>
                          <span>\u00b7</span>
                          <span>~{entry.estimated_wait_minutes} {t("dashboard.waitlist.minutes")}</span>
                        </>
                      ) : null}
                      {entry.remote_join ? (
                        <>
                          <span>\u00b7</span>
                          <span className="rounded bg-info/15 px-1.5 py-0.5 text-info">
                            {t("dashboard.waitlist.remoteJoin")}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button variant="ghost" size="icon-sm" title={t("dashboard.waitlist.notify")}>
                      <Bell className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" title={t("dashboard.waitlist.seatNow")}>
                      <Armchair className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" className="text-danger hover:text-danger" title={t("dashboard.waitlist.remove")}>
                      <X className="size-4" />
                    </Button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </SectionCard>
    </AnimatedPage>
  );
}
