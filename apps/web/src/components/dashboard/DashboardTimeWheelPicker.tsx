import { useEffect, useMemo, useRef, useState } from "react";
import { Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatCompactTimeLabel } from "@/lib/utils/time";

const HOURS = Array.from({ length: 12 }, (_, index) => String(index + 1));
const PERIODS = ["AM", "PM"] as const;

type TimeFormat = "12h" | "24h";

function minuteValues(step: number): string[] {
  return Array.from({ length: Math.floor(60 / step) }, (_, index) =>
    String(index * step).padStart(2, "0"),
  );
}

function parseTimeValue(value: string): { hour: string; minute: string; period: (typeof PERIODS)[number] } {
  const fallback = { hour: "11", minute: "00", period: "AM" as const };
  const trimmed = value.trim();
  if (!trimmed) return fallback;

  const meridiemMatch = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (meridiemMatch) {
    const hour = Number(meridiemMatch[1]);
    const minute = meridiemMatch[2] ?? "00";
    const period = meridiemMatch[3].toUpperCase() as (typeof PERIODS)[number];
    if (!Number.isFinite(hour)) return fallback;
    return {
      hour: String(hour === 0 ? 12 : hour > 12 ? hour - 12 : hour),
      minute,
      period,
    };
  }

  const [hourPart, minutePart] = trimmed.split(":");
  const hour24 = Number(hourPart);
  if (!Number.isFinite(hour24)) return fallback;
  const period: (typeof PERIODS)[number] = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return {
    hour: String(hour12),
    minute: minutePart?.slice(0, 2) ?? "00",
    period,
  };
}

function formatTimeValue(
  hour: string,
  minute: string,
  period: (typeof PERIODS)[number],
  valueFormat: TimeFormat,
): string {
  const hourNumber = Number(hour);
  const hour24 = period === "AM"
    ? hourNumber % 12
    : hourNumber === 12 ? 12 : hourNumber + 12;
  if (valueFormat === "24h") return `${String(hour24).padStart(2, "0")}:${minute}`;
  return `${hourNumber}:${minute} ${period}`;
}

function WheelColumn({
  label,
  values,
  value,
  onChange,
}: {
  label: string;
  values: readonly string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const wheelDeltaRef = useRef(0);
  const selectedIndex = Math.max(values.indexOf(value), 0);
  const selectedValue = values[selectedIndex] ?? values[0] ?? "";

  const move = (direction: 1 | -1) => {
    const nextIndex = (selectedIndex + direction + values.length) % values.length;
    onChange(values[nextIndex]);
  };

  useEffect(() => {
    const selectedButton = scrollRef.current?.querySelector<HTMLButtonElement>(
      `[data-wheel-value="${CSS.escape(selectedValue)}"]`,
    );
    selectedButton?.scrollIntoView({ block: "center" });
  }, [selectedValue]);

  const commitNearestValue = () => {
    const container = scrollRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const centerY = containerRect.top + containerRect.height / 2;
    const options = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-wheel-option]"));
    const nearest = options.reduce<HTMLButtonElement | null>((closest, option) => {
      if (!closest) return option;
      const optionRect = option.getBoundingClientRect();
      const closestRect = closest.getBoundingClientRect();
      const optionDistance = Math.abs(optionRect.top + optionRect.height / 2 - centerY);
      const closestDistance = Math.abs(closestRect.top + closestRect.height / 2 - centerY);
      return optionDistance < closestDistance ? option : closest;
    }, null);

    const nextValue = nearest?.dataset.wheelValue;
    if (nextValue && nextValue !== value) onChange(nextValue);
  };

  return (
    <div
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onWheel={(event) => {
        event.preventDefault();
        wheelDeltaRef.current += event.deltaY;
        if (Math.abs(wheelDeltaRef.current) < 24) return;
        move(wheelDeltaRef.current > 0 ? 1 : -1);
        wheelDeltaRef.current = 0;
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") move(1);
        if (event.key === "ArrowUp") move(-1);
      }}
      className="relative h-40 overflow-hidden rounded-2xl border border-border bg-bg-base/80 outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
    >
      <div aria-hidden className="pointer-events-none absolute inset-x-4 top-1/2 z-10 h-9 -translate-y-1/2 border-y border-gold/20" />
      <div
        ref={scrollRef}
        onScroll={() => {
          if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
          scrollTimerRef.current = window.setTimeout(commitNearestValue, 90);
        }}
        className="h-full overflow-y-auto overscroll-contain py-[64px] pr-1 [scrollbar-color:var(--gold)_transparent] [scrollbar-width:thin]"
      >
        {values.map((item) => {
          const active = item === selectedValue;
          return (
            <button
              key={item}
              type="button"
              role="option"
              aria-selected={active}
              data-wheel-option
              data-wheel-value={item}
              onClick={() => onChange(item)}
              className={cn(
                "flex h-9 w-full items-center justify-center text-base transition-all",
                active ? "scale-110 font-semibold text-gold" : "text-text-muted hover:text-text-secondary",
              )}
            >
              {item}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DashboardTimeWheelPicker({
  value,
  onChange,
  valueFormat,
  ariaLabel,
  doneLabel,
  helperLabel,
  minuteStep = 30,
}: {
  value: string;
  onChange: (value: string) => void;
  valueFormat: TimeFormat;
  ariaLabel: string;
  doneLabel: string;
  helperLabel: string;
  minuteStep?: 15 | 30;
}) {
  const [open, setOpen] = useState(false);
  const minutes = useMemo(() => minuteValues(minuteStep), [minuteStep]);
  const parts = parseTimeValue(value);
  const safeMinute = minutes.includes(parts.minute) ? parts.minute : minutes[0] ?? "00";

  const setPart = (next: Partial<typeof parts>) => {
    const merged = { ...parts, minute: safeMinute, ...next };
    onChange(formatTimeValue(merged.hour, merged.minute, merged.period, valueFormat));
  };

  const displayValue = value ? formatCompactTimeLabel(value) : ariaLabel;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className="flex h-10 min-w-32 items-center justify-between gap-3 rounded-xl border border-border bg-bg-elevated px-3 text-left text-sm text-text-primary outline-none transition-colors hover:border-gold/30 focus-visible:ring-2 focus-visible:ring-gold/40"
        >
          <span className="truncate">{displayValue}</span>
          <Clock className="size-3.5 shrink-0 text-text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 border-border bg-bg-elevated p-3 text-text-primary shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
            {helperLabel}
          </p>
          <p className="text-sm font-medium text-white">{formatCompactTimeLabel(value)}</p>
        </div>
        <div className="grid grid-cols-[1fr_1fr_0.9fr] gap-2">
          <WheelColumn label={`${ariaLabel} hour`} values={HOURS} value={parts.hour} onChange={(hour) => setPart({ hour })} />
          <WheelColumn label={`${ariaLabel} minute`} values={minutes} value={safeMinute} onChange={(minute) => setPart({ minute })} />
          <WheelColumn label={`${ariaLabel} period`} values={PERIODS} value={parts.period} onChange={(period) => setPart({ period: period as (typeof PERIODS)[number] })} />
        </div>
        <Button type="button" size="sm" className="mt-3 w-full" onClick={() => setOpen(false)}>
          {doneLabel}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
