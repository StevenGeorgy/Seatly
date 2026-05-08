import { useEffect, useRef, useState } from "react";

import { formatCompactTimeLabel } from "@/lib/utils/time";
import { cn } from "@/lib/utils";

type TimeWheelProps = {
  times: string[];
  value: string;
  onCommit: (value: string) => void;
};

export function TimeWheel({ times, value, onCommit }: TimeWheelProps) {
  const [draftValue, setDraftValue] = useState(value || times[0] || "");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void Promise.resolve().then(() => setDraftValue(value || times[0] || ""));
  }, [value, times]);

  const indexOfDraft = Math.max(0, times.indexOf(draftValue));
  const moveDraft = (delta: number) => {
    if (!times.length) return;
    const next = Math.min(times.length - 1, Math.max(0, indexOfDraft + delta));
    setDraftValue(times[next]);
  };

  // Mouse-wheel / trackpad. React's onWheel is attached as a passive listener,
  // which means event.preventDefault() is a no-op and the page scrolls instead
  // of the wheel highlight moving. Attach manually with { passive: false }.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < 4) return;
      event.preventDefault();
      if (!times.length) return;
      const idx = Math.max(0, times.indexOf(draftValue));
      const next = Math.min(times.length - 1, Math.max(0, idx + (event.deltaY > 0 ? 1 : -1)));
      setDraftValue(times[next]);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [times, draftValue]);

  // Keep the highlighted time in view. Without this, wheel-stepping past
  // the listbox's visible window leaves the highlight off-screen because
  // we preventDefault the wheel event so the list doesn't scroll on its own.
  useEffect(() => {
    const container = listRef.current;
    if (!container || !draftValue) return;
    const target = container.querySelector<HTMLElement>(
      `[data-time-value="${CSS.escape(draftValue)}"]`,
    );
    target?.scrollIntoView({ block: "nearest" });
  }, [draftValue]);

  const draftLabel = draftValue ? formatCompactTimeLabel(draftValue) : "";

  return (
    <div>
      <div
        ref={listRef}
        role="listbox"
        aria-label="Time"
        tabIndex={0}
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
              data-time-value={time}
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
