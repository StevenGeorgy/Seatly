import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type ScrollWheelPickerProps<T extends string | number> = {
  items: readonly T[];
  value: T;
  onChange: (next: T) => void;
  formatLabel?: (item: T) => string;
  itemHeight?: number;
};

/**
 * Snap-scroll picker shared across Discover filters and the booking modal time
 * selector. Five visible rows; the center band is the selection. Click any row
 * to snap to it; the wheel emits onChange on snap.
 */
export function ScrollWheelPicker<T extends string | number>({
  items,
  value,
  onChange,
  formatLabel,
  itemHeight = 40,
}: ScrollWheelPickerProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const visibleRows = 5;
  const padding = ((visibleRows - 1) / 2) * itemHeight;
  const selectedIndex = items.indexOf(value);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const target = Math.max(0, selectedIndex) * itemHeight;
    if (Math.abs(node.scrollTop - target) > 1) {
      node.scrollTo({ top: target, behavior: "auto" });
    }
  }, [selectedIndex, itemHeight]);

  const handleScroll = () => {
    if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      const node = containerRef.current;
      if (!node) return;
      const idx = Math.round(node.scrollTop / itemHeight);
      const clamped = Math.max(0, Math.min(items.length - 1, idx));
      const next = items[clamped];
      if (next !== undefined && next !== value) onChange(next);
    });
  };

  return (
    <div className="relative overflow-hidden" style={{ height: visibleRows * itemHeight }}>
      <div
        className="pointer-events-none absolute left-2 right-2 top-1/2 z-0 -translate-y-1/2 rounded-lg border border-gold/30 bg-gold/5"
        style={{ height: itemHeight }}
      />
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="absolute inset-0 z-10 overflow-y-auto"
        style={{
          paddingTop: padding,
          paddingBottom: padding,
          scrollSnapType: "y mandatory",
          scrollbarWidth: "none",
        }}
      >
        {items.map((item, idx) => (
          <button
            key={String(item)}
            type="button"
            onClick={() => {
              const node = containerRef.current;
              if (node) node.scrollTo({ top: idx * itemHeight, behavior: "smooth" });
            }}
            className={cn(
              "flex w-full items-center justify-center text-sm transition-colors",
              item === value ? "font-semibold text-gold" : "text-text-secondary",
            )}
            style={{ height: itemHeight, scrollSnapAlign: "center" }}
          >
            {formatLabel ? formatLabel(item) : String(item)}
          </button>
        ))}
      </div>
    </div>
  );
}
