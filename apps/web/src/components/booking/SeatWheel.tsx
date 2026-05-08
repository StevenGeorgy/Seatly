import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type SeatWheelProps = {
  maxSeats: number;
  value: number;
  onCommit: (value: number) => void;
};

export function SeatWheel({ maxSeats, value, onCommit }: SeatWheelProps) {
  const seats = useMemo(
    () => Array.from({ length: Math.max(1, maxSeats) }, (_, index) => index + 1),
    [maxSeats],
  );
  const [draftValue, setDraftValue] = useState(value);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollToSeat = (seat: number) => {
    setDraftValue(Math.min(Math.max(1, seat), maxSeats));
  };
  const commitSeat = (seat: number) => {
    onCommit(Math.min(Math.max(1, seat), maxSeats));
  };

  useEffect(() => {
    void Promise.resolve().then(() => setDraftValue(value));
  }, [value]);

  // Manual non-passive wheel listener — React's onWheel is passive, so the
  // page scrolls before our handler can preventDefault.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < 4) return;
      event.preventDefault();
      setDraftValue((prev) => {
        const next = prev + (event.deltaY > 0 ? 1 : -1);
        return Math.min(Math.max(1, next), maxSeats);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [maxSeats]);

  // Keep the highlighted option in view. Without this, wheel-stepping past
  // the listbox's visible window leaves the highlight off-screen and the
  // user is scrolling blind (the list doesn't auto-follow because we
  // preventDefault the wheel event).
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(
      `[data-seat-value="${draftValue}"]`,
    );
    target?.scrollIntoView({ block: "nearest" });
  }, [draftValue]);

  return (
    <div>
      <div
        ref={listRef}
        role="listbox"
        aria-label="Party size"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") scrollToSeat(draftValue + 1);
          if (event.key === "ArrowUp") scrollToSeat(draftValue - 1);
          if (event.key === "Enter") commitSeat(draftValue);
        }}
        className="max-h-56 overflow-y-auto rounded-2xl border border-border bg-bg-base p-2 outline-none [scrollbar-color:var(--gold)_transparent] [scrollbar-width:thin] focus-visible:ring-2 focus-visible:ring-gold/40"
      >
        {seats.map((seat) => {
          const active = seat === draftValue;
          return (
            <button
              key={seat}
              type="button"
              role="option"
              aria-selected={active}
              data-seat-value={seat}
              onClick={() => commitSeat(seat)}
              className={cn(
                "flex h-10 w-full items-center justify-center rounded-xl text-sm transition-colors",
                active ? "bg-gold text-bg-base" : "text-text-secondary hover:bg-bg-elevated hover:text-white",
              )}
            >
              {seat} seat{seat === 1 ? "" : "s"}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => commitSeat(draftValue)}
        className="mt-2 h-10 w-full rounded-xl bg-gold text-sm font-semibold text-bg-base transition-opacity hover:opacity-90"
      >
        Select {draftValue} guest{draftValue === 1 ? "" : "s"}
      </button>
    </div>
  );
}
