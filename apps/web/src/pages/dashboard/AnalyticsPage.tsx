import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3 } from "lucide-react";
import { format, subDays } from "date-fns";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { StatCard } from "@/components/dashboard/StatCard";
import { SectionCard } from "@/components/dashboard/SectionCard";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { formatCurrency } from "@/lib/utils/formatCurrency";

const RANGE_PRESETS = {
  "7d": 7,
  "30d": 30,
} as const;

export default function AnalyticsPage() {
  const { t } = useTranslation();
  const { selectedRestaurant } = useRestaurantScope();
  const currency = selectedRestaurant?.currency ?? "cad";
  const [rangeKey, setRangeKey] = useState<string>("7d");

  const days = RANGE_PRESETS[rangeKey as keyof typeof RANGE_PRESETS] ?? 7;
  const range = useMemo(() => ({
    from: format(subDays(new Date(), days), "yyyy-MM-dd"),
    to: format(new Date(), "yyyy-MM-dd"),
  }), [days]);

  const { rows, totals, loading } = useAnalytics(range);

  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        date: format(new Date(r.date), "MMM d"),
        revenue: r.total_revenue,
        covers: r.total_covers,
      })),
    [rows],
  );

  const avgSpend = totals.covers > 0 ? totals.revenue / totals.covers : 0;
  const noShowRate = totals.covers > 0
    ? ((totals.noShows / (totals.covers + totals.noShows)) * 100).toFixed(1)
    : "0.0";

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader
        title={t("dashboard.analytics.title")}
        actions={
          <Tabs value={rangeKey} onValueChange={setRangeKey}>
            <TabsList>
              <TabsTrigger value="7d">{t("dashboard.analytics.last7Days")}</TabsTrigger>
              <TabsTrigger value="30d">{t("dashboard.analytics.last30Days")}</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[100px] rounded-lg" />
          ))
        ) : (
          <>
            <StatCard
              label={t("dashboard.analytics.revenue")}
              value={formatCurrency(totals.revenue, currency)}
            />
            <StatCard
              label={t("dashboard.analytics.covers")}
              value={String(totals.covers)}
            />
            <StatCard
              label={t("dashboard.analytics.avgSpend")}
              value={formatCurrency(avgSpend, currency)}
            />
            <StatCard
              label={t("dashboard.analytics.noShowRate")}
              value={`${noShowRate}%`}
            />
          </>
        )}
      </div>

      {/* Revenue Chart */}
      <SectionCard title={t("dashboard.analytics.revenue")}>
        {loading ? (
          <Skeleton className="h-[300px] w-full rounded-lg" />
        ) : chartData.length === 0 ? (
          <EmptyState
            icon={<BarChart3 className="size-5" />}
            title={t("dashboard.analytics.noData")}
            description={t("dashboard.analytics.noDataDesc")}
          />
        ) : (
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#C9A84C" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#C9A84C" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2E2E2E" />
                <XAxis dataKey="date" tick={{ fill: "#666666", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#666666", fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1A1A1A",
                    border: "1px solid #2E2E2E",
                    borderRadius: "10px",
                    color: "#FFFFFF",
                    fontSize: 13,
                  }}
                  formatter={(value: number) => [formatCurrency(value, currency), t("dashboard.analytics.revenue")]}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#C9A84C"
                  strokeWidth={2}
                  fill="url(#goldGrad)"
                  animationDuration={800}
                  animationEasing="ease-out"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>
    </AnimatedPage>
  );
}
