import { AlertTriangle, Clock } from "lucide-react";

import { cn } from "@/lib/utils";

export interface HoldTimerBannerProps {
  secondsLeft: number;
  visualState: "calm" | "warning" | "urgent";
  className?: string;
}

export function HoldTimerBanner({
  secondsLeft,
  visualState,
  className,
}: HoldTimerBannerProps) {
  const safeSeconds = Math.max(0, Math.floor(secondsLeft));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  const display = `${minutes}:${String(seconds).padStart(2, "0")}`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "sticky top-0 z-30 flex items-center justify-center gap-2 border-b px-4 py-2 text-sm font-medium",
        visualState === "calm" && "bg-bg-elevated/80 border-border text-text-secondary",
        visualState === "warning" && "bg-gold/10 border-gold/40 text-gold",
        visualState === "urgent" && "bg-danger/10 border-danger/50 text-danger animate-pulse",
        className,
      )}
    >
      {visualState === "urgent" ? (
        <AlertTriangle className="size-4" />
      ) : (
        <Clock className="size-4" />
      )}
      <span>
        {visualState === "urgent" ? "Hurry — table releases in " : "Holding your table — "}
        <span className="font-mono">{display}</span>
      </span>
    </div>
  );
}
