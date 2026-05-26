import { AlertTriangle, Clock, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export type HoldTimerBannerProps =
  | {
      mode: "active";
      secondsLeft: number;
      visualState: "calm" | "warning" | "urgent";
      className?: string;
    }
  | {
      mode: "creating";
      className?: string;
    }
  | {
      mode: "error";
      message: string;
      className?: string;
    };

const SHELL = "sticky top-0 z-30 flex items-center justify-center gap-2 border-b px-4 py-2 text-sm font-medium";

export function HoldTimerBanner(props: HoldTimerBannerProps) {
  if (props.mode === "creating") {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn(SHELL, "bg-bg-elevated/80 border-border text-text-secondary", props.className)}
      >
        <Loader2 className="size-4 animate-spin" />
        <span>Reserving your table…</span>
      </div>
    );
  }

  if (props.mode === "error") {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className={cn(SHELL, "bg-danger/10 border-danger/50 text-danger", props.className)}
      >
        <AlertTriangle className="size-4" />
        <span>{props.message}</span>
      </div>
    );
  }

  const safeSeconds = Math.max(0, Math.floor(props.secondsLeft));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  const display = `${minutes}:${String(seconds).padStart(2, "0")}`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        SHELL,
        props.visualState === "calm" && "bg-bg-elevated/80 border-border text-text-secondary",
        props.visualState === "warning" && "bg-gold/10 border-gold/40 text-gold",
        props.visualState === "urgent" && "bg-danger/10 border-danger/50 text-danger animate-pulse",
        props.className,
      )}
    >
      {props.visualState === "urgent" ? (
        <AlertTriangle className="size-4" />
      ) : (
        <Clock className="size-4" />
      )}
      <span>
        {props.visualState === "urgent" ? "Hurry — table releases in " : "Holding your table — "}
        <span className="font-mono">{display}</span>
      </span>
    </div>
  );
}
