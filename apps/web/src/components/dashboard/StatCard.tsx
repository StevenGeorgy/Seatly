import { type ReactNode } from "react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  value: string;
  delta?: { value: string; positive: boolean } | null;
  icon?: ReactNode;
  className?: string;
};

export function StatCard({ label, value, delta, icon, className }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={cn(
        "group relative overflow-hidden rounded-lg border border-border bg-bg-surface p-5 transition-colors hover:border-gold/40",
        className,
      )}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-gold/[0.03] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wider text-text-secondary">
            {label}
          </span>
          <span className="text-2xl font-semibold tracking-tight text-text-primary">
            {value}
          </span>
          {delta ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs font-medium",
                delta.positive ? "text-success" : "text-danger",
              )}
            >
              <span>{delta.positive ? "\u2191" : "\u2193"}</span>
              {delta.value}
            </span>
          ) : null}
        </div>
        {icon ? (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gold/10 text-gold transition-colors group-hover:bg-gold/20">
            {icon}
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}
