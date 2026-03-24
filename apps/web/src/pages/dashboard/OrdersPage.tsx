import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { UtensilsCrossed, Wine } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNowStrict } from "date-fns";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrders, type OrderRow } from "@/hooks/useOrders";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

type KdsColumn = { key: string; label: string; items: OrderRow[] };

export default function OrdersPage() {
  const { t } = useTranslation();
  const [barOnly, setBarOnly] = useState(false);
  const { orders, loading, refetch } = useOrders({ barOnly });

  const columns = useMemo((): KdsColumn[] => {
    const pending = orders.filter((o) => o.status === "pending" || o.status === "confirmed");
    const inProgress = orders.filter((o) => o.status === "preparing");
    const ready = orders.filter((o) => o.status === "ready");
    return [
      { key: "pending", label: t("dashboard.orders.pending"), items: pending },
      { key: "inProgress", label: t("dashboard.orders.inProgress"), items: inProgress },
      { key: "ready", label: t("dashboard.orders.readyToServe"), items: ready },
    ];
  }, [orders, t]);

  const advanceOrder = async (orderId: string, currentStatus: string) => {
    if (!isSupabaseConfigured()) return;
    const next: Record<string, string> = {
      pending: "preparing",
      confirmed: "preparing",
      preparing: "ready",
      ready: "served",
    };
    const newStatus = next[currentStatus];
    if (!newStatus) return;
    const client = getSupabaseBrowserClient();
    await client.from("orders").update({ status: newStatus }).eq("id", orderId);
    void refetch();
  };

  const columnColors: Record<string, string> = {
    pending: "border-warning/30",
    inProgress: "border-info/30",
    ready: "border-success/30",
  };

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader
        title={t("dashboard.orders.title")}
        actions={
          <Button
            variant={barOnly ? "default" : "outline"}
            size="default"
            className="gap-2"
            onClick={() => setBarOnly(!barOnly)}
          >
            <Wine className="size-4" />
            {barOnly ? t("dashboard.orders.allItems") : t("dashboard.orders.barOnly")}
          </Button>
        }
      />

      {loading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[400px] rounded-lg" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<UtensilsCrossed className="size-5" />}
          title={t("dashboard.orders.noOrders")}
          description={t("dashboard.orders.noOrdersDesc")}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {columns.map((col) => (
            <div key={col.key} className={`flex flex-col rounded-xl border-2 ${columnColors[col.key] ?? "border-border"} bg-bg-surface`}>
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold text-text-primary">{col.label}</h3>
                <span className="flex size-6 items-center justify-center rounded-full bg-bg-elevated text-xs font-semibold text-text-secondary">
                  {col.items.length}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3">
                <AnimatePresence mode="popLayout">
                  {col.items.map((order) => {
                    const tableNum = order.reservations?.tables?.table_number ?? "\u2014";
                    const timeAgo = order.created_at
                      ? formatDistanceToNowStrict(new Date(order.created_at), { addSuffix: false })
                      : "";

                    return (
                      <motion.div
                        key={order.id}
                        layout
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.2 }}
                        className="group rounded-lg border border-border bg-bg-elevated p-3 transition-colors hover:border-gold/30"
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-semibold uppercase tracking-wider text-gold">
                            {t("dashboard.orders.table")} {tableNum}
                          </span>
                          <span className="text-xs text-text-muted">{timeAgo}</span>
                        </div>
                        <ul className="mb-3 flex flex-col gap-1">
                          {order.order_items.slice(0, 5).map((item) => (
                            <li key={item.id} className="flex items-center gap-2 text-sm text-text-secondary">
                              <span className="flex size-5 shrink-0 items-center justify-center rounded bg-bg-surface text-xs font-semibold text-text-muted">
                                {item.quantity}
                              </span>
                              <span className="truncate">{item.menu_items?.name ?? "\u2014"}</span>
                            </li>
                          ))}
                          {order.order_items.length > 5 ? (
                            <li className="text-xs text-text-muted">
                              +{order.order_items.length - 5} more
                            </li>
                          ) : null}
                        </ul>
                        <Button
                          size="sm"
                          className="w-full"
                          onClick={() => void advanceOrder(order.id, order.status)}
                        >
                          {order.status === "pending" || order.status === "confirmed"
                            ? t("dashboard.orders.startPreparing")
                            : order.status === "preparing"
                              ? t("dashboard.orders.markReady")
                              : t("dashboard.orders.markServed")}
                        </Button>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                {col.items.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center py-12 text-xs text-text-muted">
                    {t("common.empty.noData")}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </AnimatedPage>
  );
}
