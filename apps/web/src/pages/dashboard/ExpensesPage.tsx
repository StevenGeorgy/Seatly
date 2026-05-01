import { useState } from "react";
import { Coins, Plus } from "lucide-react";
import { motion } from "framer-motion";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DeltaTone = "up" | "down" | "flat";

const STATS = [
  { label: "Total spend", value: "$114.4k", delta: "2.4%", deltaTone: "down" as DeltaTone, caption: "vs last month" },
  { label: "Food cost %", value: "29%", delta: "0.4pt", deltaTone: "down" as DeltaTone, caption: "target 28%" },
  { label: "Labor cost %", value: "22%", delta: "1pt", deltaTone: "up" as DeltaTone, caption: "under target" },
  { label: "Net margin", value: "14.8%", delta: "1.2pt", deltaTone: "up" as DeltaTone, caption: "this month" },
];

type Category = {
  name: string;
  amount: string;
  pct: number;
  delta: string;
  deltaTone: DeltaTone;
};

const CATEGORIES: Category[] = [
  { name: "Food & beverage", amount: "$48.2k", pct: 100, delta: "+3%", deltaTone: "up" },
  { name: "Labor", amount: "$32.1k", pct: 67, delta: "-2%", deltaTone: "down" },
  { name: "Rent & utilities", amount: "$14.8k", pct: 31, delta: "0", deltaTone: "flat" },
  { name: "Operations", amount: "$9.4k", pct: 20, delta: "+5%", deltaTone: "up" },
  { name: "Marketing", amount: "$5.6k", pct: 12, delta: "+12%", deltaTone: "up" },
  { name: "Other", amount: "$4.2k", pct: 9, delta: "-1%", deltaTone: "down" },
];

type Txn = {
  date: string;
  vendor: string;
  category: string;
  description: string;
  amount: string;
  pending?: boolean;
};

const TXNS: Txn[] = [
  { date: "Apr 26", vendor: "Daniel Boulud Sourcing", category: "Food & beverage", description: "Lamb saddle · 24kg", amount: "$1,840.00" },
  { date: "Apr 26", vendor: "Loire Maison", category: "Food & beverage", description: "Sancerre case · 12 btl", amount: "$684.00" },
  { date: "Apr 25", vendor: "Toronto Hydro", category: "Rent & utilities", description: "Electric · April", amount: "$2,180.40" },
  { date: "Apr 25", vendor: "Maison Berthelot", category: "Food & beverage", description: "Truffle · 600g", amount: "$1,240.00", pending: true },
  { date: "Apr 24", vendor: "Square POS", category: "Operations", description: "Monthly subscription", amount: "$280.00" },
  { date: "Apr 24", vendor: "Fresh Market", category: "Food & beverage", description: "Produce · weekly", amount: "$1,420.50" },
  { date: "Apr 23", vendor: "Globe & Mail", category: "Marketing", description: "Spring tasting menu ad", amount: "$840.00" },
  { date: "Apr 23", vendor: "Ontario Linen Service", category: "Operations", description: "Weekly linen", amount: "$312.00" },
  { date: "Apr 22", vendor: "Yorkville Realty", category: "Rent & utilities", description: "May rent", amount: "$8,400.00", pending: true },
  { date: "Apr 22", vendor: "Payroll · Wave", category: "Labor", description: "Bi-weekly · 24 staff", amount: "$14,820.00" },
];

const RANGES = ["Week", "Month", "Quarter", "Year"] as const;
type RangeKey = (typeof RANGES)[number];

function deltaText(delta: string, tone: DeltaTone): { text: string; className: string } {
  if (tone === "flat") return { text: delta, className: "text-text-muted" };
  const arrow = tone === "up" ? "↑" : "↓";
  return {
    text: `${arrow} ${delta}`,
    className: tone === "up" ? "text-success" : "text-danger",
  };
}

export default function ExpensesPage() {
  const [range, setRange] = useState<RangeKey>("Month");

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
            <Coins className="size-3.5" />
            Cost ledger
          </p>
          <h1 className="mt-2 font-serif text-3xl text-white sm:text-4xl">Expenses</h1>
          <p className="mt-1 text-sm italic text-text-muted">
            What it actually costs to run the room — by category, by vendor, by week.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex items-center rounded-lg border border-border bg-bg-elevated/40 p-1">
            {RANGES.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setRange(key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  range === key ? "bg-gold/15 text-gold" : "text-text-muted hover:text-text-secondary",
                )}
              >
                {key}
              </button>
            ))}
          </div>
          <Button size="default" className="gap-2">
            <Plus className="size-4" />
            Log expense
          </Button>
        </div>
      </motion.header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => {
          const d = deltaText(stat.delta, stat.deltaTone);
          return (
            <article key={stat.label} className="rounded-2xl border border-border bg-bg-surface p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">{stat.label}</p>
              <p className="mt-3 font-serif text-4xl text-white">{stat.value}</p>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
                <span className={cn("font-medium", d.className)}>{d.text}</span>
                <span>{stat.caption}</span>
              </p>
            </article>
          );
        })}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-2xl border border-border bg-bg-surface p-5 lg:p-6">
          <h2 className="font-serif text-2xl text-white">By category</h2>
          <p className="mt-1 text-xs text-text-muted">Where the money went · April</p>
          <div className="mt-6 space-y-5">
            {CATEGORIES.map((cat) => {
              const d = deltaText(cat.delta, cat.deltaTone);
              return (
                <div key={cat.name}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-text-primary">{cat.name}</span>
                    <span className="flex items-baseline gap-2">
                      <span className="font-mono text-xs text-gold">{cat.amount}</span>
                      <span className={cn("font-mono text-[10px]", d.className)}>{d.text.replace("↑ ", "+").replace("↓ ", "-")}</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated">
                    <div className="h-full rounded-full bg-gold" style={{ width: `${cat.pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="rounded-2xl border border-border bg-bg-surface lg:col-span-2">
          <div className="flex items-start justify-between gap-4 px-5 py-5 lg:px-6">
            <div>
              <h2 className="font-serif text-2xl text-white">Recent transactions</h2>
              <p className="mt-1 text-xs text-text-muted">Last 30 days · 10 of 142 entries</p>
            </div>
            <Button variant="outline" size="sm">Export CSV</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-border/60 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                  <th className="px-5 py-3 font-medium lg:px-6">Date</th>
                  <th className="px-5 py-3 font-medium">Vendor</th>
                  <th className="px-5 py-3 font-medium">Category</th>
                  <th className="px-5 py-3 font-medium">Description</th>
                  <th className="px-5 py-3 text-right font-medium lg:px-6">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {TXNS.map((txn, i) => (
                  <tr key={i} className="text-sm transition-colors hover:bg-bg-elevated/30">
                    <td className="px-5 py-4 font-mono text-text-muted lg:px-6">{txn.date}</td>
                    <td className="px-5 py-4 text-text-primary">{txn.vendor}</td>
                    <td className="px-5 py-4 text-text-secondary">{txn.category}</td>
                    <td className="px-5 py-4 text-text-secondary">{txn.description}</td>
                    <td className="px-5 py-4 text-right lg:px-6">
                      <div className="text-text-primary">{txn.amount}</div>
                      {txn.pending && (
                        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-warning">
                          Pending
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </AnimatedPage>
  );
}
