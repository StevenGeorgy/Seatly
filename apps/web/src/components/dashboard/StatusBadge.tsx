import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-success/15 text-success border-success/25",
  seated: "bg-gold/15 text-gold border-gold/25",
  completed: "bg-text-muted/15 text-text-secondary border-text-muted/25",
  cancelled: "bg-danger/15 text-danger border-danger/25",
  no_show: "bg-danger/15 text-danger border-danger/25",
  pending: "bg-warning/15 text-warning border-warning/25",
  preparing: "bg-info/15 text-info border-info/25",
  ready: "bg-success/15 text-success border-success/25",
  served: "bg-text-muted/15 text-text-secondary border-text-muted/25",
  ordered: "bg-warning/15 text-warning border-warning/25",
  waiting: "bg-warning/15 text-warning border-warning/25",
  empty: "bg-success/15 text-success border-success/25",
  reserved: "bg-gold/15 text-gold border-gold/25",
  occupied: "bg-danger/15 text-danger border-danger/25",
  cleaning: "bg-cleaning/15 text-cleaning border-cleaning/25",
  blocked: "bg-blocked/15 text-text-muted border-blocked/25",
  active: "bg-success/15 text-success border-success/25",
  inactive: "bg-text-muted/15 text-text-secondary border-text-muted/25",
};

const DEFAULT_STYLE = "bg-bg-elevated text-text-secondary border-border";

type StatusBadgeProps = {
  status: string;
  label?: string;
  className?: string;
};

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const style = STATUS_STYLES[status] ?? DEFAULT_STYLE;
  const displayLabel = label ?? status.replace(/_/g, " ");

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium capitalize",
        style,
        className,
      )}
    >
      {displayLabel}
    </span>
  );
}
