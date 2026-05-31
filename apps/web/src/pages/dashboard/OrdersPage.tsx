import { useMemo, useState } from "react";
import { CheckCircle2, Clock3, ReceiptText, Search, UtensilsCrossed } from "lucide-react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { DataCard, DataCardRow } from "@/components/dashboard/DataCard";
import { Button } from "@/components/ui/button";
import { useOrders, type OrderRow } from "@/hooks/useOrders";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { useErrorToast } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";

type TabKey = "all" | "pending" | "preparing" | "ready" | "served";

type PreorderRow = {
  id: string;
  orderId: string;
  reservationTime: string;
  guest: string;
  contact: string;
  table: string;
  items: string;
  itemCount: number;
  total: number;
  status: string;
  tabStatus: Exclude<TabKey, "all">;
  sortAt: number;
};

const ACTIVE_STATUSES = new Set(["pending", "confirmed", "preparing", "ready"]);

function tabStatusFor(status: string): Exclude<TabKey, "all"> {
  if (status === "preparing") return "preparing";
  if (status === "ready") return "ready";
  if (status === "served") return "served";
  return "pending";
}

export default function OrdersPage() {
  const { t, i18n } = useTranslation();
  const { errorToast } = useErrorToast();
  const [tab, setTab] = useState<TabKey>("all");
  const [query, setQuery] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const { selectedRestaurant } = useRestaurantScope();
  const { orders, loading, error, updateOrderStatus } = useOrders({ preordersOnly: true });
  const currency = selectedRestaurant?.currency ?? "cad";

  const rows = useMemo(
    () =>
      orders
        .map((order) => adaptOrder(order, i18n.language, t))
        .sort((a, b) => a.sortAt - b.sortAt),
    [i18n.language, orders, t],
  );

  const counts = useMemo(() => ({
    all: rows.length,
    pending: rows.filter((row) => row.tabStatus === "pending").length,
    preparing: rows.filter((row) => row.tabStatus === "preparing").length,
    ready: rows.filter((row) => row.tabStatus === "ready").length,
    served: rows.filter((row) => row.tabStatus === "served").length,
  }), [rows]);

  const stats = useMemo(() => {
    const activeRows = rows.filter((row) => ACTIVE_STATUSES.has(row.status));
    return [
      {
        label: t("dashboard.orders.statActivePreorders"),
        value: String(activeRows.length),
        caption: t("dashboard.orders.statActivePreordersCaption"),
        icon: Clock3,
      },
      {
        label: t("dashboard.orders.statReady"),
        value: String(counts.ready),
        caption: t("dashboard.orders.statReadyCaption"),
        icon: CheckCircle2,
      },
      {
        label: t("dashboard.orders.statPreorderValue"),
        value: formatCurrency(rows.reduce((sum, row) => sum + row.total, 0), currency),
        caption: t("dashboard.orders.statPreorderValueCaption"),
        icon: ReceiptText,
      },
      {
        label: t("dashboard.orders.statItems"),
        value: String(rows.reduce((sum, row) => sum + row.itemCount, 0)),
        caption: t("dashboard.orders.statItemsCaption"),
        icon: UtensilsCrossed,
      },
    ];
  }, [counts.ready, currency, rows, t]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (tab !== "all" && row.tabStatus !== tab) return false;
      if (!q) return true;
      return (
        row.orderId.toLowerCase().includes(q) ||
        row.guest.toLowerCase().includes(q) ||
        row.table.toLowerCase().includes(q) ||
        row.items.toLowerCase().includes(q) ||
        row.contact.toLowerCase().includes(q)
      );
    });
  }, [query, rows, tab]);

  const handleStatusClick = async (row: PreorderRow) => {
    const nextStatus = row.status === "ready" ? "served" : "ready";
    setUpdatingId(row.id);
    try {
      await updateOrderStatus(row.id, nextStatus);
      toast.success(t(nextStatus === "served" ? "dashboard.orders.markedServed" : "dashboard.orders.markedReady"));
    } catch (statusError) {
      errorToast(statusError, {
        fallback: t("dashboard.orders.updateFailed"),
        logTag: "[OrdersPage.handleStatusClick]",
      });
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
            <UtensilsCrossed className="size-3.5" />
            {t("dashboard.orders.eyebrow")}
          </p>
          <h1 className="mt-2 font-serif text-3xl text-white sm:text-4xl">{t("dashboard.orders.preordersTitle")}</h1>
          <p className="mt-1 text-sm italic text-text-muted">
            {t("dashboard.orders.preordersSubtitle")}
          </p>
        </div>
      </motion.header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <article
            key={stat.label}
            className="rounded-2xl border border-border bg-bg-surface p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                {stat.label}
              </p>
              <stat.icon className="size-4 text-gold" />
            </div>
            <p className="mt-3 font-serif text-4xl text-white">{stat.value}</p>
            <p className="mt-2 text-xs text-text-muted">
              {stat.caption}
            </p>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-border bg-bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-elevated/40 p-1">
            {(["all", "pending", "preparing", "ready", "served"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  tab === key
                    ? "bg-gold/15 text-gold"
                    : "text-text-muted hover:text-text-secondary",
                )}
              >
                {t(`dashboard.orders.tabs.${key}`)}
                <span
                  className={cn(
                    "font-mono text-[10px]",
                    tab === key ? "text-gold/80" : "text-text-muted",
                  )}
                >
                  {counts[key]}
                </span>
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("dashboard.orders.searchPlaceholder")}
              className="h-9 w-full rounded-md border border-border bg-bg-elevated/50 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-gold/40 focus:outline-none"
            />
          </div>
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[960px] text-left">
            <thead>
              <tr className="border-b border-border/60 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                <th className="px-5 py-3 font-medium">{t("dashboard.orders.reservationTime")}</th>
                <th className="px-5 py-3 font-medium">{t("dashboard.orders.guest")}</th>
                <th className="px-5 py-3 font-medium">{t("dashboard.orders.table")}</th>
                <th className="px-5 py-3 font-medium">{t("dashboard.orders.items")}</th>
                <th className="px-5 py-3 font-medium">{t("dashboard.orders.preorderTotal")}</th>
                <th className="px-5 py-3 font-medium">{t("dashboard.orders.status")}</th>
                <th className="px-5 py-3 text-right font-medium">{t("dashboard.orders.action")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-text-muted">
                    {t("dashboard.orders.loading")}
                  </td>
                </tr>
              )}
              {!loading && error && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-danger">
                    {t("dashboard.orders.loadFailed")}
                  </td>
                </tr>
              )}
              {!loading && !error && visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center">
                    <div className="mx-auto max-w-sm">
                      <p className="font-serif text-xl text-white">{t("dashboard.orders.emptyTitle")}</p>
                      <p className="mt-2 text-sm text-text-muted">{t("dashboard.orders.emptyDesc")}</p>
                    </div>
                  </td>
                </tr>
              )}
              {!loading && !error && visible.map((row) => (
                <tr key={row.id} className="text-sm transition-colors hover:bg-bg-elevated/30">
                  <td className="px-5 py-4 align-top">
                    <div className="font-serif text-base text-gold">{row.reservationTime}</div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                      {row.orderId}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="text-text-primary">{row.guest}</div>
                    <div className="mt-1 text-xs text-text-muted">{row.contact}</div>
                  </td>
                  <td className="px-5 py-4 font-serif text-base text-gold">{row.table}</td>
                  <td className="px-5 py-4">
                    <div className="text-text-secondary">{row.items}</div>
                    <div className="mt-1 text-xs text-text-muted">
                      {t("dashboard.orders.itemCount", { count: row.itemCount })}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-text-primary">{formatCurrency(row.total, currency)}</td>
                  <td className="px-5 py-4">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          statusDotClass(row.tabStatus),
                        )}
                      />
                      <span
                        className={statusTextClass(row.tabStatus)}
                      >
                        {t(`dashboard.orders.statuses.${row.tabStatus}`)}
                      </span>
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    {row.tabStatus !== "served" ? (
                      <Button
                        size="sm"
                        variant={row.tabStatus === "ready" ? "default" : "outline"}
                        disabled={updatingId === row.id}
                        onClick={() => void handleStatusClick(row)}
                      >
                        {row.tabStatus === "ready"
                          ? t("dashboard.orders.markServed")
                          : t("dashboard.orders.markReady")}
                      </Button>
                    ) : (
                      <span className="text-xs text-text-muted">{t("dashboard.orders.noAction")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: same data as the table above, rendered as cards (md:hidden) */}
        <div className="divide-y divide-border/50 md:hidden">
          {loading && (
            <p className="px-4 py-12 text-center text-sm text-text-muted">
              {t("dashboard.orders.loading")}
            </p>
          )}
          {!loading && error && (
            <p className="px-4 py-12 text-center text-sm text-danger">
              {t("dashboard.orders.loadFailed")}
            </p>
          )}
          {!loading && !error && visible.length === 0 && (
            <div className="px-4 py-12 text-center">
              <p className="font-serif text-xl text-white">{t("dashboard.orders.emptyTitle")}</p>
              <p className="mt-2 text-sm text-text-muted">{t("dashboard.orders.emptyDesc")}</p>
            </div>
          )}
          {!loading && !error && visible.map((row) => (
            <DataCard key={row.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-serif text-base text-gold">{row.reservationTime}</div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                    {row.orderId}
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 text-xs">
                  <span className={cn("size-1.5 rounded-full", statusDotClass(row.tabStatus))} />
                  <span className={statusTextClass(row.tabStatus)}>
                    {t(`dashboard.orders.statuses.${row.tabStatus}`)}
                  </span>
                </span>
              </div>
              <div className="mt-3 space-y-1.5">
                <DataCardRow label={t("dashboard.orders.guest")}>
                  <span className="text-text-primary">{row.guest}</span>
                  {row.contact ? ` · ${row.contact}` : null}
                </DataCardRow>
                <DataCardRow label={t("dashboard.orders.table")}>{row.table}</DataCardRow>
                <DataCardRow label={t("dashboard.orders.items")}>
                  {row.items} · {t("dashboard.orders.itemCount", { count: row.itemCount })}
                </DataCardRow>
                <DataCardRow label={t("dashboard.orders.preorderTotal")}>
                  {formatCurrency(row.total, currency)}
                </DataCardRow>
              </div>
              {row.tabStatus !== "served" && (
                <Button
                  size="lg"
                  variant={row.tabStatus === "ready" ? "default" : "outline"}
                  disabled={updatingId === row.id}
                  onClick={() => void handleStatusClick(row)}
                  className="mt-3 w-full"
                >
                  {row.tabStatus === "ready"
                    ? t("dashboard.orders.markServed")
                    : t("dashboard.orders.markReady")}
                </Button>
              )}
            </DataCard>
          ))}
        </div>
      </section>
    </AnimatedPage>
  );
}

function adaptOrder(
  order: OrderRow,
  language: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): PreorderRow {
  const reservedAt = order.reservations?.reserved_at ?? order.created_at;
  const sortAt = reservedAt ? new Date(reservedAt).getTime() : Number.MAX_SAFE_INTEGER;
  const itemCount = order.order_items.reduce((sum, item) => sum + item.quantity, 0);
  const itemTotal = order.order_items.reduce((sum, item) => sum + (item.line_total ?? item.unit_price * item.quantity), 0);
  const total = order.total_amount ?? order.subtotal ?? itemTotal;
  const items = summarizeItems(order, t);
  const guest = order.is_guest_checkout
    ? t("dashboard.orders.guestCheckout")
    : order.guests?.full_name ?? order.reservations?.guest_full_name ?? t("dashboard.orders.guestCheckout");
  const contact = order.guests?.phone
    ?? order.reservations?.guest_phone
    ?? order.reservations?.guest_email
    ?? t("dashboard.orders.noContact");
  const table = order.reservations?.tables?.label
    ?? order.reservations?.tables?.table_number
    ?? t("dashboard.orders.unassigned");

  return {
    id: order.id,
    orderId: order.confirmation_code ?? order.id.slice(0, 8).toUpperCase(),
    reservationTime: reservedAt ? formatReservationTime(reservedAt, language) : t("dashboard.orders.noReservationTime"),
    guest,
    contact,
    table,
    items,
    itemCount,
    total,
    status: order.status,
    tabStatus: tabStatusFor(order.status),
    sortAt,
  };
}

function summarizeItems(order: OrderRow, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (order.order_items.length === 0) return t("dashboard.orders.noItems");
  const visibleItems = order.order_items.slice(0, 2).map((item) => t("dashboard.orders.itemSummary", {
    quantity: item.quantity,
    name: item.name || item.menu_items?.name || t("dashboard.orders.unknownItem"),
  }));
  const remaining = order.order_items.length - visibleItems.length;
  if (remaining <= 0) return visibleItems.join(", ");
  return `${visibleItems.join(", ")} ${t("dashboard.orders.itemSummaryMore", { count: remaining })}`;
}

function formatReservationTime(value: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusDotClass(status: Exclude<TabKey, "all">): string {
  if (status === "ready") return "bg-success";
  if (status === "served") return "bg-text-muted";
  if (status === "preparing") return "bg-warning";
  return "bg-gold";
}

function statusTextClass(status: Exclude<TabKey, "all">): string {
  if (status === "ready") return "text-success";
  if (status === "served") return "text-text-muted";
  if (status === "preparing") return "text-warning";
  return "text-gold";
}
