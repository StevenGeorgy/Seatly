import { useMemo, useState } from "react";
import { Filter, Plus, Search, UtensilsCrossed } from "lucide-react";
import { motion } from "framer-motion";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { Button } from "@/components/ui/button";
import { useOrders } from "@/hooks/useOrders";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { cn } from "@/lib/utils";
import { NewOrderDrawer } from "@/components/orders/NewOrderDrawer";

type TicketStatus = "open" | "closed";
type TicketTag = "split" | "allergen" | "birthday" | "vip";

type Ticket = {
  table: string;
  orderId: string;
  guest: string;
  tag?: { kind: TicketTag; label: string };
  course: string;
  items: number;
  total: number;
  server: string;
  opened: string;
  status: TicketStatus;
};

const TICKETS: Ticket[] = [
  { table: "T06", orderId: "OR-2841", guest: "Park, Ji-soo", tag: { kind: "split", label: "SPLIT × 3" }, course: "Mains", items: 9, total: 412.5, server: "M.Reyes", opened: "6:32p", status: "open" },
  { table: "T03", orderId: "OR-2842", guest: "Tremblay, M.", course: "Hors", items: 6, total: 268.0, server: "A.Singh", opened: "7:00p", status: "open" },
  { table: "T18", orderId: "OR-2843", guest: "Singh, A.", tag: { kind: "allergen", label: "ALLERGEN" }, course: "Snacks", items: 11, total: 520.4, server: "M.Reyes", opened: "7:15p", status: "open" },
  { table: "T12", orderId: "OR-2844", guest: "Lefebvre, C.", tag: { kind: "birthday", label: "BIRTHDAY" }, course: "Hors", items: 7, total: 344.2, server: "D.Owens", opened: "7:30p", status: "open" },
  { table: "T05", orderId: "OR-2846", guest: "Chen, D.", tag: { kind: "vip", label: "VIP" }, course: "Dessert", items: 5, total: 214.0, server: "A.Singh", opened: "7:45p", status: "open" },
  { table: "T20", orderId: "OR-2848", guest: "Park, A.", tag: { kind: "vip", label: "VIP" }, course: "Mains", items: 12, total: 642.0, server: "D.Owens", opened: "8:02p", status: "open" },
  { table: "T09", orderId: "OR-2849", guest: "Okafor, N.", course: "Hors", items: 4, total: 178.0, server: "A.Singh", opened: "8:14p", status: "open" },
  { table: "T22", orderId: "OR-2850", guest: "Bianchi, G.", course: "Mains", items: 8, total: 386.75, server: "M.Reyes", opened: "8:21p", status: "open" },
  { table: "T01", orderId: "OR-2839", guest: "Anand, R.", course: "Closed", items: 6, total: 184.2, server: "M.Reyes", opened: "5:28p", status: "closed" },
  { table: "T07", orderId: "OR-2840", guest: "Walk-in", course: "Closed", items: 3, total: 96.5, server: "A.Singh", opened: "6:12p", status: "closed" },
];

const STATS = [
  { label: "Open tickets", value: "8", caption: "on the floor", deltaTone: null as null },
  { label: "Open value", value: "$2966", caption: "vs avg Sat", delta: "$1,840", deltaTone: "up" as const },
  { label: "Avg ticket", value: "$371", caption: "vs last week", delta: "6%", deltaTone: "up" as const },
  { label: "Avg time", value: "42m", caption: "ticket → close", delta: "3m", deltaTone: "down" as const },
];

const TAG_CLASSES: Record<TicketTag, string> = {
  split: "border-info/30 bg-info/10 text-info",
  allergen: "border-danger/30 bg-danger/10 text-danger",
  birthday: "border-warning/30 bg-warning/10 text-warning",
  vip: "border-gold/30 bg-gold/10 text-gold",
};

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

type TabKey = "all" | "open" | "closed";

export default function OrdersPage() {
  const [tab, setTab] = useState<TabKey>("all");
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { selectedRestaurantId, selectedRestaurant } = useRestaurantScope();
  const { refetch } = useOrders();
  const currency = selectedRestaurant?.currency ?? "CAD";

  const counts = useMemo(() => ({
    all: TICKETS.length,
    open: TICKETS.filter((t) => t.status === "open").length,
    closed: TICKETS.filter((t) => t.status === "closed").length,
  }), []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TICKETS.filter((row) => {
      if (tab !== "all" && row.status !== tab) return false;
      if (!q) return true;
      return (
        row.orderId.toLowerCase().includes(q) ||
        row.guest.toLowerCase().includes(q) ||
        row.table.toLowerCase().includes(q)
      );
    });
  }, [tab, query]);

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
            Dine-in
          </p>
          <h1 className="mt-2 font-serif text-3xl text-white sm:text-4xl">Orders tonight</h1>
          <p className="mt-1 text-sm italic text-text-muted">
            Every open ticket on the floor — by table, course and server.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="default" className="gap-2">
            <Filter className="size-4" />
            Filters
          </Button>
          <Button size="default" className="gap-2" onClick={() => setDrawerOpen(true)}>
            <Plus className="size-4" />
            New ticket
          </Button>
        </div>
      </motion.header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => (
          <article
            key={stat.label}
            className="rounded-2xl border border-border bg-bg-surface p-5"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
              {stat.label}
            </p>
            <p className="mt-3 font-serif text-4xl text-white">{stat.value}</p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
              {stat.deltaTone && (
                <span
                  className={cn(
                    "font-medium",
                    stat.deltaTone === "up" ? "text-success" : "text-danger",
                  )}
                >
                  {stat.deltaTone === "up" ? "↑" : "↓"} {stat.delta}
                </span>
              )}
              <span>{stat.caption}</span>
            </p>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-border bg-bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-elevated/40 p-1">
            {(["all", "open", "closed"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  tab === key
                    ? "bg-gold/15 text-gold"
                    : "text-text-muted hover:text-text-secondary",
                )}
              >
                {key}
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
              placeholder="Order #, guest…"
              className="h-9 w-full rounded-md border border-border bg-bg-elevated/50 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-gold/40 focus:outline-none"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left">
            <thead>
              <tr className="border-b border-border/60 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                <th className="px-5 py-3 font-medium">Table</th>
                <th className="px-5 py-3 font-medium">Guest</th>
                <th className="px-5 py-3 font-medium">Course</th>
                <th className="px-5 py-3 font-medium">Items</th>
                <th className="px-5 py-3 font-medium">Total</th>
                <th className="px-5 py-3 font-medium">Server</th>
                <th className="px-5 py-3 font-medium">Opened</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {visible.map((row) => (
                <tr key={row.orderId} className="text-sm transition-colors hover:bg-bg-elevated/30">
                  <td className="px-5 py-4 align-top">
                    <div className="font-serif text-base text-gold">{row.table}</div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                      {row.orderId}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <span className="text-text-primary">{row.guest}</span>
                      {row.tag && (
                        <span
                          className={cn(
                            "rounded-md border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider",
                            TAG_CLASSES[row.tag.kind],
                          )}
                        >
                          {row.tag.label}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-text-secondary">{row.course}</td>
                  <td className="px-5 py-4 text-text-secondary">{row.items}</td>
                  <td className="px-5 py-4 text-text-primary">{formatMoney(row.total)}</td>
                  <td className="px-5 py-4 text-text-secondary">{row.server}</td>
                  <td className="px-5 py-4 font-mono text-text-muted">{row.opened}</td>
                  <td className="px-5 py-4">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          row.status === "open" ? "bg-gold" : "bg-text-muted",
                        )}
                      />
                      <span
                        className={
                          row.status === "open" ? "text-gold" : "text-text-muted"
                        }
                      >
                        {row.status === "open" ? "Open" : "Closed"}
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <NewOrderDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => void refetch()}
        restaurantId={selectedRestaurantId}
        currency={currency}
      />
    </AnimatedPage>
  );
}
