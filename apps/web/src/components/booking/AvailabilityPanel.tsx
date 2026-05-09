import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Clock, Users } from "lucide-react";
import { addDays, endOfMonth, format, isValid, parse, startOfMonth, startOfToday } from "date-fns";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TimeWheel } from "@/components/booking/TimeWheel";
import { SeatWheel } from "@/components/booking/SeatWheel";
import {
  closestSlotTimeToNow,
  fetchAvailableDateSet,
  fetchNextAvailableDate,
  formatConflictWindow,
  useAvailability,
  useAvailabilityRealtimeInvalidate,
  useDinerConflictWindows,
  type AvailabilitySlot,
  type ConflictWindow,
} from "@/hooks/useAvailability";
import { formatCompactTimeLabel, to24HourTime } from "@/lib/utils/time";
import { cn } from "@/lib/utils";

export type AvailabilityPanelSlotState =
  | { kind: "available"; slot: AvailabilitySlot }
  | { kind: "conflict"; slot: AvailabilitySlot; reason: string };

export type AvailabilityPanelProps = {
  restaurantId: string;
  /** IANA tz, e.g. "America/Toronto" — used for "now" comparisons + conflict labels. */
  restaurantTimezone: string;
  /** Default 2. */
  defaultPartySize?: number;
  /** Pre-fill (modify flow passes the existing reservation's). */
  initialDate?: string; // YYYY-MM-DD
  /** Pre-fill 24h "HH:MM". */
  initialTime?: string;
  initialPartySize?: number;
  /** Modify flow: skip the reservation's own slot in the conflict windows. */
  excludeReservationId?: string | null;
  /** From useUser().profile?.id — null means "no diner is logged in". */
  userProfileId: string | null;
  /** Called when the user clicks an available pill. Parent advances flow. */
  onSelectSlot: (slot: AvailabilitySlot) => void;
  /** Highlights the given pill (parent's chosen slot). */
  selectedSlotIso?: string | null;
  /** Optional cap shown in the SeatWheel — defaults to 50. */
  maxPartySize?: number;
  /**
   * Fires whenever any control changes (date / time / partySize). Useful for
   * parents that mirror the panel's state into their own form (e.g.
   * RestaurantPublicPage's `dineIn`).
   */
  onStateChange?: (state: { date: string; time: string; partySize: number }) => void;
};

const SLOT_PILL_COUNT = 6;
const DEFAULT_PARTY = 2;

function dateKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function safeParseDate(value: string): Date | null {
  if (!value) return null;
  const parsed = parse(value, "yyyy-MM-dd", new Date());
  return isValid(parsed) ? parsed : null;
}

/** Generates "HH:MM" 24h labels at 30-min increments from start to end (inclusive). */
function generateTimeOptions(startHour: number, endHour: number): string[] {
  const out: string[] = [];
  for (let h = startHour; h <= endHour; h += 1) {
    out.push(`${String(h).padStart(2, "0")}:00`);
    if (h < endHour) out.push(`${String(h).padStart(2, "0")}:30`);
  }
  return out;
}

/** "HH:MM" → minutes since midnight, or null on bad input. */
function timeToMinutes(value: string): number | null {
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mn = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(mn)) return null;
  return h * 60 + mn;
}

/** Renders "HH:MM" 24h as "7:00 PM". */
function formatTwelveHour(value: string): string {
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return value;
  let h = parseInt(m[1], 10);
  const mn = m[2];
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${mn} ${period}`;
}

/** Centered windowing: 3 before target + 3 at-or-after, backfilled. */
function centerSlotsAround(
  slots: AvailabilitySlot[],
  targetTime: string,
  count: number,
): AvailabilitySlot[] {
  const target = to24HourTime(targetTime) ?? targetTime;
  const targetMinutes = timeToMinutes(target);
  if (targetMinutes == null) {
    return slots
      .slice()
      .sort((a, b) => new Date(a.date_time).getTime() - new Date(b.date_time).getTime())
      .slice(0, count);
  }

  const indexed = slots
    .map((slot) => {
      const t24 = to24HourTime(slot.display_time);
      const minutes = t24 ? timeToMinutes(t24) : null;
      return minutes != null ? { slot, minutes } : null;
    })
    .filter((x): x is { slot: AvailabilitySlot; minutes: number } => x !== null)
    .sort((a, b) => a.minutes - b.minutes);

  const before = indexed.filter((s) => s.minutes < targetMinutes).slice(-Math.floor(count / 2));
  const atOrAfter = indexed.filter((s) => s.minutes >= targetMinutes).slice(0, Math.ceil(count / 2));
  const core = [...before, ...atOrAfter];

  if (core.length < count) {
    const used = new Set(core.map((c) => c.slot.date_time));
    const extras = indexed
      .filter((s) => !used.has(s.slot.date_time))
      .sort(
        (a, b) =>
          Math.abs(a.minutes - targetMinutes) - Math.abs(b.minutes - targetMinutes),
      )
      .slice(0, count - core.length);
    core.push(...extras);
  }

  return core
    .sort((a, b) => a.minutes - b.minutes)
    .slice(0, count)
    .map((c) => c.slot);
}

/** Maps a slot to "available" or "conflict" given the diner's other reservations. */
function classifySlot(
  slot: AvailabilitySlot,
  conflicts: ConflictWindow[],
  timezone: string,
): AvailabilityPanelSlotState {
  if (conflicts.length === 0) return { kind: "available", slot };
  const start = new Date(slot.date_time);
  const minutes =
    typeof slot.duration_minutes === "number" && slot.duration_minutes > 0
      ? slot.duration_minutes
      : 90;
  const end = new Date(start.getTime() + minutes * 60_000);
  const hit = conflicts.find((c) => start < c.end && c.start < end);
  if (!hit) return { kind: "available", slot };
  const label =
    formatConflictWindow(hit, timezone) ?? "another booking you already have";
  return { kind: "conflict", slot, reason: `Hidden — ${label}` };
}

/**
 * Unified booking widget — date / time / party + 6 slot pills. Used by
 * RestaurantPublicPage, RestaurantPreviewModal, and ModifyBookingFields.
 *
 * Defaults on cold load: today (or `fetchNextAvailableDate`) / closest slot
 * to "now" / 2 guests. Auto-refetches on any control change. Conflicts with
 * the diner's other reservations render as DISABLED pills with a tooltip
 * explaining why — never silently filtered.
 */
export function AvailabilityPanel({
  restaurantId,
  restaurantTimezone,
  defaultPartySize = DEFAULT_PARTY,
  initialDate,
  initialTime,
  initialPartySize,
  excludeReservationId,
  userProfileId,
  onSelectSlot,
  selectedSlotIso,
  maxPartySize = 50,
  onStateChange,
}: AvailabilityPanelProps) {
  const [date, setDate] = useState<string>(initialDate ?? "");
  const [time, setTime] = useState<string>(initialTime ?? "");
  const [partySize, setPartySize] = useState<number>(
    initialPartySize ?? defaultPartySize,
  );
  const [bootstrapped, setBootstrapped] = useState<boolean>(false);

  const [calendarMonth, setCalendarMonth] = useState<Date>(
    () => safeParseDate(initialDate ?? "") ?? new Date(),
  );
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [timePopoverOpen, setTimePopoverOpen] = useState(false);
  const [partyPopoverOpen, setPartyPopoverOpen] = useState(false);
  const [availableDateKeys, setAvailableDateKeys] = useState<Set<string> | null>(null);
  const [dateAvailLoading, setDateAvailLoading] = useState(false);

  const {
    slots,
    floorCapacity,
    loading: availLoading,
    fetchSlots,
    unavailableMessage,
    unavailableReason,
  } = useAvailability();

  // ── Mount-only bootstrap: pick today (or next available) + closest time ──
  const bootstrapStartedRef = useRef(false);
  useEffect(() => {
    if (bootstrapStartedRef.current) return;
    bootstrapStartedRef.current = true;
    const run = async () => {
      const todayIso = format(startOfToday(), "yyyy-MM-dd");
      let nextDate = initialDate;
      if (!nextDate) {
        nextDate = (await fetchNextAvailableDate({
          restaurantId,
          partySize: initialPartySize ?? defaultPartySize,
          fromDate: todayIso,
        })) ?? todayIso;
      }
      setDate(nextDate);
      setBootstrapped(true);
    };
    void run();
  }, [restaurantId, initialDate, initialPartySize, defaultPartySize]);

  // ── Refetch slots whenever date / party changes ──
  useEffect(() => {
    if (!date) return;
    void fetchSlots(restaurantId, date, partySize);
  }, [fetchSlots, restaurantId, date, partySize]);

  // ── Mirror state up to the parent on any control change. ──
  useEffect(() => {
    onStateChange?.({ date, time, partySize });
  }, [date, time, partySize, onStateChange]);

  // ── First slot fetch settled? Pick a default time if none was provided. ──
  useEffect(() => {
    if (time || availLoading) return;
    if (slots.length === 0) return;
    const closest = closestSlotTimeToNow(slots, restaurantTimezone);
    // Sync setState here is safe — guarded on `time` being empty so it
    // runs at most once per cold load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (closest) setTime(closest);
  }, [slots, time, availLoading, restaurantTimezone]);

  // ── Realtime invalidation: refetch when reservations change. ──
  useAvailabilityRealtimeInvalidate(restaurantId, () => {
    if (date) void fetchSlots(restaurantId, date, partySize, { forceRefresh: true });
  });

  // ── Available-date set drives the calendar's disabled predicate. ──
  useEffect(() => {
    let cancelled = false;
    const monthStart = startOfMonth(calendarMonth);
    const monthEnd = endOfMonth(calendarMonth);
    const today = startOfToday();
    const rangeStart = monthStart < today ? today : monthStart;
    if (rangeStart > monthEnd) {
      // Past-month edge case — no future days in this view; clear the set.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAvailableDateKeys(new Set());
      return;
    }
    setDateAvailLoading(true);
    void fetchAvailableDateSet({
      restaurantId,
      partySize,
      startDate: dateKey(rangeStart),
      endDate: dateKey(monthEnd),
    })
      .then((days) => {
        // `null` from the helper signals an RPC error — leave the keys null
        // so the calendar stays permissive (predicate returns false → all
        // future dates remain clickable). An empty Set, by contrast, is a
        // legitimate "no availability for this party" state and DOES grey
        // the month out.
        if (!cancelled) setAvailableDateKeys(days);
      })
      .catch(() => {
        // Network/JS error — same permissive fallback as above.
        if (!cancelled) setAvailableDateKeys(null);
      })
      .finally(() => {
        if (!cancelled) setDateAvailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [restaurantId, partySize, calendarMonth]);

  // ── Conflict windows for the diner on this date (excluding self when modifying). ──
  const conflicts = useDinerConflictWindows({
    userProfileId,
    currentRestaurantId: restaurantId,
    date: date || null,
    timezone: restaurantTimezone,
    excludeReservationId: excludeReservationId ?? null,
  });

  // ── Compute the 6 centered pills with conflict overlay. ──
  const pillStates = useMemo<AvailabilityPanelSlotState[]>(() => {
    if (slots.length === 0 || !time) return [];
    const centered = centerSlotsAround(slots, time, SLOT_PILL_COUNT);
    return centered.map((slot) => classifySlot(slot, conflicts, restaurantTimezone));
  }, [slots, time, conflicts, restaurantTimezone]);

  // ── Aggregated conflict notices for the day. ──
  const conflictNotices = useMemo<string[]>(() => {
    if (conflicts.length === 0) return [];
    const seen = new Set<string>();
    for (const c of conflicts) {
      const formatted = formatConflictWindow(c, restaurantTimezone);
      if (formatted) seen.add(formatted);
    }
    return Array.from(seen);
  }, [conflicts, restaurantTimezone]);

  // ── "No availability — try X" suggestion. ──
  const [suggestedNextDate, setSuggestedNextDate] = useState<string | null>(null);
  useEffect(() => {
    if (slots.length > 0 || !date || availLoading) return;
    let cancelled = false;
    void fetchNextAvailableDate({
      restaurantId,
      partySize,
      fromDate: format(addDays(safeParseDate(date) ?? startOfToday(), 1), "yyyy-MM-dd"),
    }).then((next) => {
      if (!cancelled) setSuggestedNextDate(next);
    });
    return () => {
      cancelled = true;
    };
  }, [slots.length, date, availLoading, restaurantId, partySize]);

  // ── Calendar disabled predicate. ──
  // Hard cap = 10 years out. Each shift's `advance_booking_days` is the
  // actual restaurant-side limit (we set it to 3650 globally so owners
  // can ramp up later without code changes); this just bounds the UI.
  const today = startOfToday();
  const calendarRangeEnd = useMemo(() => addDays(today, 3650), [today]);
  const unavailableDate = (candidate: Date) => {
    if (candidate < today) return true;
    if (candidate > calendarRangeEnd) return true;
    if (dateAvailLoading || availableDateKeys === null) return false;
    return !availableDateKeys.has(dateKey(candidate));
  };

  const previewDateLabel = useMemo(() => {
    const parsed = safeParseDate(date);
    return parsed
      ? parsed.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })
      : "Pick a date";
  }, [date]);

  const timeOptions = useMemo(() => generateTimeOptions(7, 23), []);
  const partyCap = Math.max(1, Math.min(maxPartySize, floorCapacity ?? maxPartySize));

  const isCold = !bootstrapped;
  const isFetching = availLoading || isCold;

  const onPickDate = (picked: Date | undefined) => {
    if (!picked) return;
    setDate(format(picked, "yyyy-MM-dd"));
    setDatePopoverOpen(false);
  };

  return (
    <div className="space-y-3">
      {/* ── Controls row ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Popover
          open={isCold ? false : datePopoverOpen}
          onOpenChange={(open) => !isCold && setDatePopoverOpen(open)}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={isCold}
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-bg-elevated p-3 text-left transition-colors hover:bg-bg-elevated/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CalendarDays className="size-4 text-gold" />
              <span>
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">
                  Date
                </p>
                <p className="mt-1 text-sm text-white">
                  {isCold ? "Loading…" : previewDateLabel}
                </p>
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="z-[120] w-auto border-border bg-bg-elevated p-0 text-text-primary shadow-2xl"
          >
            <Calendar
              mode="single"
              required={false}
              selected={safeParseDate(date) ?? undefined}
              month={calendarMonth}
              onMonthChange={setCalendarMonth}
              onSelect={onPickDate}
              disabled={unavailableDate}
              className="rounded-md border-0 bg-transparent [--cell-size:--spacing(8)]"
            />
          </PopoverContent>
        </Popover>

        <Popover
          open={isCold ? false : timePopoverOpen}
          onOpenChange={(open) => !isCold && setTimePopoverOpen(open)}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={isCold}
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-bg-elevated p-3 text-left transition-colors hover:bg-bg-elevated/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Clock className="size-4 text-gold" />
              <span>
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">
                  Time
                </p>
                <p className="mt-1 text-sm text-white">
                  {isCold ? "Loading…" : time ? formatTwelveHour(time) : "Pick a time"}
                </p>
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="z-[120] w-44 border-border bg-bg-elevated p-2 text-text-primary shadow-2xl"
          >
            <TimeWheel
              times={timeOptions}
              value={time || timeOptions[0]}
              onCommit={(picked) => {
                setTime(picked);
                setTimePopoverOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>

        <Popover
          open={isCold ? false : partyPopoverOpen}
          onOpenChange={(open) => !isCold && setPartyPopoverOpen(open)}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={isCold}
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-bg-elevated p-3 text-left transition-colors hover:bg-bg-elevated/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Users className="size-4 text-gold" />
              <span>
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">
                  Party
                </p>
                <p className="mt-1 text-sm text-white">
                  {isCold ? "Loading…" : `${partySize} guest${partySize === 1 ? "" : "s"}`}
                </p>
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="z-[120] w-44 border-border bg-bg-elevated p-2 text-text-primary shadow-2xl"
          >
            <SeatWheel
              maxSeats={partyCap}
              value={partySize}
              onCommit={(picked) => {
                setPartySize(picked);
                setPartyPopoverOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* ── Pill row ───────────────────────────────────────────────── */}
      <div className="min-h-[64px]">
        {isFetching && pillStates.length === 0 ? (
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: SLOT_PILL_COUNT }).map((_, i) => (
              <div
                key={i}
                className="h-10 w-20 animate-pulse rounded-full border border-border bg-bg-elevated/40"
              />
            ))}
          </div>
        ) : pillStates.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {pillStates.map((state) => {
              const slot = state.slot;
              const isSelected = selectedSlotIso === slot.date_time;
              const isConflict = state.kind === "conflict";
              return (
                <button
                  key={slot.date_time}
                  type="button"
                  disabled={isConflict}
                  onClick={() => !isConflict && onSelectSlot(slot)}
                  title={isConflict ? state.reason : `Book ${slot.display_time}`}
                  aria-disabled={isConflict}
                  className={cn(
                    "inline-flex h-10 items-center justify-center rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40",
                    isConflict
                      ? "cursor-not-allowed border-border bg-bg-elevated/40 text-text-muted line-through opacity-60"
                      : isSelected
                        ? "border-gold bg-gold text-black shadow-md"
                        : "border-border bg-bg-elevated text-white hover:border-gold/40 hover:bg-gold/10",
                  )}
                >
                  {formatCompactTimeLabel(slot.display_time)}
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState
            date={date}
            partySize={partySize}
            unavailableMessage={unavailableMessage}
            unavailableReason={unavailableReason}
            suggestedNextDate={suggestedNextDate}
            onTrySuggested={(next) => {
              setDate(next);
              setCalendarMonth(safeParseDate(next) ?? new Date());
            }}
          />
        )}
      </div>

      {/* ── Conflict notices ───────────────────────────────────────── */}
      {conflictNotices.length > 0 ? (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
          <p className="font-semibold">Some times are hidden because you're already booked:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {conflictNotices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function EmptyState({
  date,
  partySize,
  unavailableMessage,
  unavailableReason,
  suggestedNextDate,
  onTrySuggested,
}: {
  date: string;
  partySize: number;
  unavailableMessage: string | null;
  unavailableReason: string | null;
  suggestedNextDate: string | null;
  onTrySuggested: (next: string) => void;
}) {
  const dateLabel = safeParseDate(date)?.toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const headline =
    unavailableMessage ??
    (unavailableReason === "party_size_out_of_range"
      ? `Party size of ${partySize} exceeds this restaurant's capacity.`
      : `No availability for ${partySize} guest${partySize === 1 ? "" : "s"}${dateLabel ? ` on ${dateLabel}` : ""}.`);

  return (
    <div className="rounded-xl border border-border bg-bg-elevated/40 px-3 py-3 text-sm text-text-secondary">
      <p>{headline}</p>
      {suggestedNextDate ? (
        <button
          type="button"
          onClick={() => onTrySuggested(suggestedNextDate)}
          className="mt-2 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-xs font-medium text-gold transition-colors hover:bg-gold/20"
        >
          Try {safeParseDate(suggestedNextDate)?.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })}
        </button>
      ) : null}
    </div>
  );
}
