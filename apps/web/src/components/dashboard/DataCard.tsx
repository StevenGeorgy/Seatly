import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Shared building blocks for the mobile "card list" that replaces a wide
// dashboard table below `md`. The desktop <table> stays untouched (wrapped in
// `hidden md:block`); a sibling `md:hidden` list maps the SAME row data into
// these cards so the two can't diverge. See OrdersPage for the canonical use.

export function DataCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <article className={cn("px-4 py-4", className)}>{children}</article>;
}

/** A label-left / value-right row inside a DataCard. */
export function DataCardRow({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 text-sm", className)}>
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-text-muted">
        {label}
      </span>
      <span className="min-w-0 text-right text-text-secondary">{children}</span>
    </div>
  );
}
