import { useEffect, useState } from "react";

import { formatCompactTimeLabel } from "@/lib/utils/time";
import { cn } from "@/lib/utils";

type TimeWheelProps = {
  times: string[];
  value: string;
  onCommit: (value: string) => void;
};

export function TimeWheel({ times, value, onCommit }: TimeWheelProps) {
  const [draftValue, setDraftValue] = useState(value || times[0] || "");

  useEffect(() => {
    void Promise.resolve().then(() => setDraftValue(value || times[0] || ""));
  }, [value, times]);

  const indexOfDraft = Math.max(0, times.indexOf(draftValue));
  const moveDraft = (delta: number) => {
    if (!times.length) return;
    const next = Math.min(times.length - 1, Math.max(0, indexOfDraft + delta));
    setDraftValue(times[next]);
  };

  const draftLabel = draftValue ? formatCompactTimeLabel(draftValue) : "";

  return (
    <div>
      <div
        role="listbox"
        aria-label="Time"
        tabIndex={0}
        onWheel={(event) => {
          event.preventDefault();
          if (Math.abs(event.deltaY) < 4) return;
          moveDraft(event.deltaY > 0 ? 1 : -1);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") moveDraft(1);
          if (event.key === "ArrowUp") moveDraft(-1);
          if (event.key === "Enter" && draftValue) onCommit(draftValue);
        }}
        className="max-h-56 overflow-y-auto rounded-2xl border border-border bg-bg-base p-2 outline-none [scrollbar-color:var(--gold)_transparent] [scrollbar-width:thin] focus-visible:ring-2 focus-visible:ring-gold/40"
      >
        {times.map((time) => {
          const active = time === draftValue;
          return (
            <button
              key={time}
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => onCommit(time)}
              className={cn(
                "flex h-10 w-full items-center justify-center rounded-xl text-sm transition-colors",
                active ? "bg-gold text-bg-base" : "text-text-secondary hover:bg-bg-elevated hover:text-white",
              )}
            >
              {formatCompactTimeLabel(time)}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => draftValue && onCommit(draftValue)}
        disabled={!draftValue}
        className="mt-2 h-10 w-full rounded-xl bg-gold text-sm font-semibold text-bg-base transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {draftLabel ? `Select ${draftLabel}` : "Select a time"}
      </button>
    </div>
  );
}
