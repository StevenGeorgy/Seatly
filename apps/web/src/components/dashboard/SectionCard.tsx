import { type ReactNode } from "react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

type SectionCardProps = {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
};

export function SectionCard({
  title,
  actions,
  children,
  className,
  noPadding,
}: SectionCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={cn(
        "rounded-lg border border-border bg-bg-surface",
        className,
      )}
    >
      {title || actions ? (
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          {title ? (
            <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          ) : (
            <div />
          )}
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={noPadding ? "" : "p-5"}>{children}</div>
    </motion.div>
  );
}
