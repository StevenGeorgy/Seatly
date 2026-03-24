import { useTranslation } from "react-i18next";
import { Users, Plus, Mail } from "lucide-react";
import { motion } from "framer-motion";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { SectionCard } from "@/components/dashboard/SectionCard";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useStaffRoster } from "@/hooks/useStaffRoster";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { formatCurrency } from "@/lib/utils/formatCurrency";

export default function StaffPage() {
  const { t } = useTranslation();
  const { selectedRestaurant } = useRestaurantScope();
  const currency = selectedRestaurant?.currency ?? "cad";
  const { members, loading } = useStaffRoster();

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader
        title={t("dashboard.staff.title")}
        actions={
          <Button size="default" className="gap-2">
            <Plus className="size-4" />
            {t("dashboard.staff.addStaff")}
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
        ) : members.length === 0 ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title={t("dashboard.staff.noStaff")}
            description={t("dashboard.staff.noStaffDesc")}
            action={
              <Button size="default" className="gap-2">
                <Mail className="size-4" />
                {t("dashboard.staff.addStaff")}
              </Button>
            }
          />
        ) : (
          <div className="divide-y divide-border">
            {members.map((member, i) => {
              const name = member.user_profiles?.full_name ?? member.user_profiles?.email ?? "\u2014";
              const initials = name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

              return (
                <motion.div
                  key={member.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: i * 0.03 }}
                  className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-bg-elevated/50"
                >
                  <Avatar className="size-10 border border-border">
                    <AvatarImage src={member.user_profiles?.avatar_url ?? undefined} alt={name} />
                    <AvatarFallback className="bg-bg-elevated text-xs font-semibold text-text-secondary">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-text-primary">{name}</span>
                    <span className="truncate text-xs text-text-muted">
                      {member.user_profiles?.email}
                    </span>
                  </div>
                  <StatusBadge status="active" label={member.role} />
                  {member.employment_type ? (
                    <span className="hidden text-xs capitalize text-text-muted sm:block">
                      {member.employment_type.replace("_", " ")}
                    </span>
                  ) : null}
                  {member.hourly_rate ? (
                    <span className="hidden text-sm font-medium text-text-secondary sm:block">
                      {formatCurrency(member.hourly_rate, currency)}/hr
                    </span>
                  ) : null}
                </motion.div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </AnimatedPage>
  );
}
