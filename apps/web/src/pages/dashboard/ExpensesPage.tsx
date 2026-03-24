import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Receipt, Plus, Camera } from "lucide-react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { SectionCard } from "@/components/dashboard/SectionCard";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useExpenses } from "@/hooks/useExpenses";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { formatCurrency } from "@/lib/utils/formatCurrency";

export default function ExpensesPage() {
  const { t } = useTranslation();
  const { selectedRestaurant } = useRestaurantScope();
  const currency = selectedRestaurant?.currency ?? "cad";
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const { expenses, loading } = useExpenses({ category: categoryFilter });

  const monthTotal = expenses.reduce((sum, e) => sum + e.total_amount, 0);

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader
        title={t("dashboard.expenses.title")}
        description={`${t("dashboard.expenses.monthlyTotal")}: ${formatCurrency(monthTotal, currency)}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="default" className="gap-2">
              <Camera className="size-4" />
              {t("dashboard.expenses.scanReceipt")}
            </Button>
            <Button size="default" className="gap-2">
              <Plus className="size-4" />
              {t("dashboard.expenses.addExpense")}
            </Button>
          </div>
        }
      />

      <SectionCard noPadding>
        {loading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : expenses.length === 0 ? (
          <EmptyState
            icon={<Receipt className="size-5" />}
            title={t("dashboard.expenses.noExpenses")}
            description={t("dashboard.expenses.noExpensesDesc")}
          />
        ) : (
          <div className="divide-y divide-border">
            <AnimatePresence mode="popLayout">
              {expenses.map((expense, i) => (
                <motion.div
                  key={expense.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, delay: i * 0.02 }}
                  className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-bg-elevated/50"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-text-primary">
                      {expense.vendor_name ?? expense.description ?? "\u2014"}
                    </span>
                    <span className="text-xs text-text-muted">
                      {format(new Date(expense.expense_date), "MMM d, yyyy")}
                    </span>
                  </div>
                  <StatusBadge status="active" label={expense.category.replace(/_/g, " ")} />
                  <span className="text-sm font-semibold text-text-primary">
                    {formatCurrency(expense.total_amount, currency)}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </SectionCard>
    </AnimatedPage>
  );
}
