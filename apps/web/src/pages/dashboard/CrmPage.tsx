import { useMemo, useState } from "react";
import { Heart, Mail, Plus, Search } from "lucide-react";
import { motion } from "framer-motion";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Segment = "vip" | "loyalty" | "returning" | "new";

type GuestRow = {
  initials: string;
  name: string;
  segment: Segment;
  subline?: string;
  visits: number;
  lastVisit: string;
  lifetime: string;
  avgTicket: string;
  notes: string[];
};

const GUESTS: GuestRow[] = [
  { initials: "PJ", name: "Park, Ji-soo", segment: "vip", visits: 14, lastVisit: "2 days", lifetime: "$4,280", avgTicket: "$306", notes: ["Loire wines", "Quiet table"] },
  { initials: "LC", name: "Lefebvre, Camille", segment: "loyalty", visits: 6, lastVisit: "tonight", lifetime: "$2,410", avgTicket: "$402", notes: ["Birthday", "Patio"] },
  { initials: "CD", name: "Chen, David", segment: "vip", visits: 11, lastVisit: "tonight", lifetime: "$3,120", avgTicket: "$284", notes: ["Pre-orders", "Dessert"] },
  { initials: "TM", name: "Tremblay, Marc", segment: "loyalty", visits: 8, lastVisit: "tonight", lifetime: "$1,980", avgTicket: "$248", notes: ["Shellfish allergy"] },
  { initials: "SA", name: "Singh, Aanya", segment: "new", subline: "Deposit pending", visits: 3, lastVisit: "tonight", lifetime: "$840", avgTicket: "$280", notes: ["Large parties"] },
  { initials: "WK", name: "Wong, Karen", segment: "loyalty", visits: 9, lastVisit: "1 wk", lifetime: "$2,340", avgTicket: "$260", notes: ["Wine pairings"] },
  { initials: "AR", name: "Anand, Riya", segment: "returning", visits: 4, lastVisit: "2 wk", lifetime: "$780", avgTicket: "$195", notes: ["Birthday brought"] },
  { initials: "CR", name: "Cohen, Rachel", segment: "new", visits: 1, lastVisit: "today", lifetime: "$184", avgTicket: "$184", notes: ["Vegetarian", "GF"] },
  { initials: "HM", name: "Hassan, Mira", segment: "new", visits: 2, lastVisit: "today", lifetime: "$312", avgTicket: "$156", notes: ["Walk-in"] },
  { initials: "PA", name: "Park, Anand", segment: "vip", visits: 5, lastVisit: "tonight", lifetime: "$1,640", avgTicket: "$328", notes: ["Anniversary", "Champagne"] },
];

const STATS = [
  { label: "Guests in book", value: "10", caption: "this month", delta: "6%", deltaTone: "up" as const },
  { label: "Active VIPs", value: "3", caption: "≥10 visits", delta: null, deltaTone: null },
  { label: "Total LTV", value: "$17.9k", caption: "this month", delta: "$1.2k", deltaTone: "up" as const },
  { label: "Repeat rate", value: "48%", caption: "vs Q1", delta: "3pt", deltaTone: "up" as const },
];

const SEGMENT_CLASSES: Record<Segment, string> = {
  vip: "border-gold/40 bg-gold/10 text-gold",
  loyalty: "border-info/40 bg-info/10 text-info",
  returning: "border-[#8B7BD8]/40 bg-[#8B7BD8]/10 text-[#B6A8E8]",
  new: "border-border bg-bg-elevated text-text-muted",
};

const AVATAR_CLASSES: Record<Segment, string> = {
  vip: "border-gold/40 bg-gold/10 text-gold",
  loyalty: "border-gold/40 bg-gold/10 text-gold",
  returning: "border-gold/40 bg-gold/10 text-gold",
  new: "border-gold/40 bg-gold/10 text-gold",
};

type TabKey = "all" | "vip" | "loyalty" | "returning" | "new";

export default function CrmPage() {
  const [tab, setTab] = useState<TabKey>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => ({
    all: GUESTS.length,
    vip: GUESTS.filter((g) => g.segment === "vip").length,
    loyalty: GUESTS.filter((g) => g.segment === "loyalty").length,
    returning: GUESTS.filter((g) => g.segment === "returning").length,
    new: GUESTS.filter((g) => g.segment === "new").length,
  }), []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GUESTS.filter((row) => {
      if (tab !== "all" && row.segment !== tab) return false;
      if (!q) return true;
      return row.name.toLowerCase().includes(q) || row.notes.join(" ").toLowerCase().includes(q);
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
            <Heart className="size-3.5" />
            Guest book
          </p>
          <h1 className="mt-2 font-serif text-3xl text-white sm:text-4xl">Your regulars</h1>
          <p className="mt-1 text-sm italic text-text-muted">
            Every guest, every visit, every preference — quietly remembered.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="default" className="gap-2">
            <Mail className="size-4" />
            Send campaign
          </Button>
          <Button size="default" className="gap-2">
            <Plus className="size-4" />
            Add guest
          </Button>
        </div>
      </motion.header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => (
          <article key={stat.label} className="rounded-2xl border border-border bg-bg-surface p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
              {stat.label}
            </p>
            <p className="mt-3 font-serif text-4xl text-white">{stat.value}</p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
              {stat.deltaTone && (
                <span className={cn("font-medium", stat.deltaTone === "up" ? "text-success" : "text-danger")}>
                  ↑ {stat.delta}
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
            {(["all", "vip", "loyalty", "returning", "new"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                  tab === key ? "bg-gold/15 text-gold" : "text-text-muted hover:text-text-secondary",
                )}
              >
                {key === "vip" ? "VIP" : key}
                <span className={cn("font-mono text-[10px]", tab === key ? "text-gold/80" : "text-text-muted")}>
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
              placeholder="Search guests…"
              className="h-9 w-full rounded-md border border-border bg-bg-elevated/50 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-gold/40 focus:outline-none"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left">
            <thead>
              <tr className="border-b border-border/60 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                <th className="px-5 py-3 font-medium">Guest</th>
                <th className="px-5 py-3 font-medium">Segment</th>
                <th className="px-5 py-3 font-medium">Visits</th>
                <th className="px-5 py-3 font-medium">Last visit</th>
                <th className="px-5 py-3 font-medium">Lifetime</th>
                <th className="px-5 py-3 font-medium">Avg ticket</th>
                <th className="px-5 py-3 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {visible.map((row) => (
                <tr key={row.name} className="text-sm transition-colors hover:bg-bg-elevated/30">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] font-semibold",
                          AVATAR_CLASSES[row.segment],
                        )}
                      >
                        {row.initials}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-text-primary">{row.name}</p>
                        {row.subline && (
                          <p className="text-xs text-warning">{row.subline}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider",
                        SEGMENT_CLASSES[row.segment],
                      )}
                    >
                      {row.segment === "vip" ? "VIP" : row.segment}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-text-secondary">{row.visits}</td>
                  <td className="px-5 py-4 text-text-secondary">{row.lastVisit}</td>
                  <td className="px-5 py-4 text-text-primary">{row.lifetime}</td>
                  <td className="px-5 py-4 text-text-secondary">{row.avgTicket}</td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap gap-1.5">
                      {row.notes.map((note) => (
                        <span
                          key={note}
                          className="rounded-md border border-border bg-bg-elevated/60 px-2 py-0.5 text-[11px] text-text-secondary"
                        >
                          {note}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AnimatedPage>
  );
}
