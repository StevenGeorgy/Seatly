import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { SectionCard } from "@/components/dashboard/SectionCard";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import { useStaffRoster } from "@/hooks/useStaffRoster";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { formatCurrency } from "@/lib/utils/formatCurrency";

const EMPLOYMENT_ORDER = ["full_time", "part_time", "contract", null] as const;

export default function SchedulePage() {
  const { t } = useTranslation();
  const { selectedRestaurant } = useRestaurantScope();
  const currency = selectedRestaurant?.currency ?? "cad";
  const { members, loading } = useStaffRoster();

  const grouped = EMPLOYMENT_ORDER.map((type) => ({
    type: type ?? "other",
    label: type ? type.replace("_", "-") : "Other",
    members: members.filter((m) => m.employment_type === type),
  })).filter((g) => g.members.length > 0);

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader
        title={t("routes.dashboard.schedule.title")}
        actions={
          <Button size="default" disabled title="Staff scheduling coming soon">
            {t("dashboard.staff.createShift")}
          </Button>
        }
      />

      {loading ? (
        <SectionCard noPadding>
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        </SectionCard>
      ) : members.length === 0 ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title="No staff yet"
          description="Add staff members from the Staff page to see them here."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {grouped.map((group) => (
            <SectionCard key={group.type} title={group.label.replace("-", " ").replace(/\b\w/g, (c) => c.toUpperCase())} noPadding>
              <div className="divide-y divide-border">
                {group.members.map((member, i) => {
                  const name = member.user_profiles?.full_name ?? member.user_profiles?.email ?? "\u2014";
                  const initials = name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
                  return (
                    <motion.div
                      key={member.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: i * 0.03 }}
                      className="flex items-center gap-4 px-5 py-3"
                    >
                      <Avatar className="size-9 border border-border">
                        <AvatarImage src={member.user_profiles?.avatar_url ?? undefined} alt={name} />
                        <AvatarFallback className="bg-bg-elevated text-xs font-semibold text-text-secondary">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium text-text-primary">{name}</span>
                        <span className="truncate text-xs text-text-muted">{member.user_profiles?.email}</span>
                      </div>
                      <StatusBadge status="active" label={member.role} />
                      {member.hourly_rate ? (
                        <span className="hidden text-sm font-medium text-text-secondary sm:block">
                          {formatCurrency(member.hourly_rate, currency)}/hr
                        </span>
                      ) : null}
                    </motion.div>
                  );
                })}
              </div>
            </SectionCard>
          ))}
          <p className="text-center text-xs text-text-muted">
            Weekly schedule calendar coming soon — shift scheduling will be available here.
          </p>
        </div>
      )}
    </AnimatedPage>
  );
}
