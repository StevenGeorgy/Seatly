import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock, Users } from "lucide-react";
import {
  addDays,
  endOfMonth,
  format,
  isValid,
  parse,
  startOfMonth,
  startOfToday,
} from "date-fns";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TimeWheel } from "@/components/booking/TimeWheel";
import { SeatWheel } from "@/components/booking/SeatWheel";
import {
  fetchAvailableDateSet,
  filterSlotsByConflicts,
  formatConflictWindow,
  useAvailability,
  useDinerConflictWindows,
} from "@/hooks/useAvailability";
import { formatCompactTimeLabel } from "@/lib/utils/time";

export type ModifyBookingValidity = {
  canSave: boolean;
  reason: string | null;
};

export type ModifyBookingValues = {
  date: string;
  time: string;
  partySize: number;
  notes: string;
};

type ModifyBookingFieldsProps = {
  restaurantId: string;
  restaurantTimezone: string | null;
  reservationId: string;
  userProfileId: string | null;
  initial: ModifyBookingValues;
  onChange: (next: ModifyBookingValues) => void;
  onValidityChange: (state: ModifyBookingValidity) => void;
  showNotes?: boolean;
};

function dateKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function safeParseDate(value: string): Date | null {
  if (!value) return null;
  const parsed = parse(value, "yyyy-MM-dd", new Date());
  return isValid(parsed) ? parsed : null;
}

/**
 * Polished date / time / party / notes pickers shared by the modify-booking
 * dialogs. Live-validates against `get_available_slots_cached` and the diner's
 * other reservations (via useDinerConflictWindows with excludeReservationId
 * pointing at the booking being edited). The parent uses `onValidityChange`
 * to gate its Save button — no trial-and-error 409 round-trips.
 */
export function ModifyBookingFields({
  restaurantId,
  restaurantTimezone,
  reservationId,
  userProfileId,
  initial,
  onChange,
  onValidityChange,
  showNotes = true,
}: ModifyBookingFieldsProps) {
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [partySize, setPartySize] = useState(initial.partySize);
  const [notes, setNotes] = useState(initial.notes);

  const [calendarMonth, setCalendarMonth] = useState(() =>
    safeParseDate(initial.date) ?? new Date(),
  );
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [timePopoverOpen, setTimePopoverOpen] = useState(false);
  const [partyPopoverOpen, setPartyPopoverOpen] = useState(false);

  const [availableDateKeys, setAvailableDateKeys] = useState<Set<string>>(new Set());
  const [dateAvailabilityLoading, setDateAvailabilityLoading] = useState(false);

  // Mirror local state up to the parent on every change.
  useEffect(() => {
    onChange({ date, time, partySize, notes });
  }, [date, time, partySize, notes, onChange]);

  const {
    slots,
    floorCapacity,
    loading: availabilityLoading,
    fetchSlots,
    unavailableMessage,
    unavailableReason,
  } = useAvailability();

  // Re-fetch slots whenever date or party size changes.
  useEffect(() => {
    if (!restaurantId || !date) return;
    void fetchSlots(restaurantId, date, partySize, { forceRefresh: true });
  }, [fetchSlots, restaurantId, date, partySize]);

  // Populate disabled-date keys for the visible calendar month.
  useEffect(() => {
    if (!restaurantId) return;
    let cancelled = false;
    const monthStart = startOfMonth(calendarMonth);
    const monthEnd = endOfMonth(calendarMonth);
    const today = startOfToday();
    const rangeStart = monthStart < today ? today : monthStart;
    if (rangeStart > monthEnd) {
      setAvailableDateKeys(new Set());
      setDateAvailabilityLoading(false);
      return;
    }
    setDateAvailabilityLoading(true);
    void fetchAvailableDateSet({
      restaurantId,
      partySize,
      startDate: dateKey(rangeStart),
      endDate: dateKey(monthEnd),
    })
      .then((availableDays) => {
        if (!cancelled) setAvailableDateKeys(availableDays);
      })
      .catch(() => {
        if (!cancelled) setAvailableDateKeys(new Set());
      })
      .finally(() => {
        if (!cancelled) setDateAvailabilityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [restaurantId, partySize, calendarMonth]);

  const dinerConflictWindows = useDinerConflictWindows({
    userProfileId,
    currentRestaurantId: restaurantId,
    date: date || null,
    timezone: restaurantTimezone,
    excludeReservationId: reservationId,
  });

  const availableSlots = useMemo(() => {
    const seen = new Set<string>();
    return filterSlotsByConflicts(slots, dinerConflictWindows).filter((slot) => {
      if (seen.has(slot.display_time)) return false;
      seen.add(slot.display_time);
      return true;
    });
  }, [slots, dinerConflictWindows]);

  const availableTimes = useMemo(
    () => availableSlots.map((slot) => slot.display_time),
    [availableSlots],
  );

  const dinerConflictNotices = useMemo(() => {
    if (dinerConflictWindows.length === 0) return [] as string[];
    if (availableSlots.length === slots.length) return [] as string[];
    const seen = new Set<string>();
    for (const window of dinerConflictWindows) {
      const formatted = formatConflictWindow(window, restaurantTimezone);
      if (formatted) seen.add(formatted);
    }
    return Array.from(seen);
  }, [dinerConflictWindows, availableSlots.length, slots.length, restaurantTimezone]);

  // Calendar disabled predicate. Today's date may also be disabled if there
  // are no slots remaining; that's fine.
  const today = startOfToday();
  const calendarRangeEnd = useMemo(() => addDays(today, 62), [today]);
  const unavailableDate = (candidate: Date) => {
    if (candidate < today) return true;
    if (candidate > calendarRangeEnd) return true;
    if (dateAvailabilityLoading) return false;
    return !availableDateKeys.has(dateKey(candidate));
  };

  const previewDateLabel = useMemo(() => {
    const parsed = safeParseDate(date);
    return parsed
      ? parsed.toLocaleDateString("en-CA", {
          weekday: "short",
          month: "short",
          day: "numeric",
        })
      : "Pick a date";
  }, [date]);

  const maxPartySize = Math.max(1, floorCapacity ?? 50);

  // Match a chosen `time` against the live `availableTimes`. Both are in
  // display form ("7:30 PM"), but normalise via formatCompactTimeLabel for
  // edge cases ("7:30 PM" vs "7:30pm").
  const timeMatchesAvailableSlot = useMemo(() => {
    if (!time) return false;
    const normalised = formatCompactTimeLabel(time);
    return availableTimes.some(
      (candidate) => formatCompactTimeLabel(candidate) === normalised,
    );
  }, [time, availableTimes]);

  // Derive validity. Reported up to the parent so it can drive its Save
  // button + helper text.
  useEffect(() => {
    let next: ModifyBookingValidity = { canSave: true, reason: null };

    const hasChange =
      date !== initial.date
      || partySize !== initial.partySize
      || notes !== initial.notes
      || (time && formatCompactTimeLabel(time) !== formatCompactTimeLabel(initial.time));

    if (availabilityLoading || dateAvailabilityLoading) {
      next = { canSave: false, reason: "Checking availability…" };
    } else if (!date) {
      next = { canSave: false, reason: "Pick a date." };
    } else if (!availableDateKeys.has(date)) {
      next = { canSave: false, reason: "No times open on that date." };
    } else if (!availableTimes.length) {
      next = {
        canSave: false,
        reason: unavailableMessage ?? unavailableHeadline(unavailableReason) ?? "No times available.",
      };
    } else if (!timeMatchesAvailableSlot) {
      next = { canSave: false, reason: "Pick an available time." };
    } else if (partySize > maxPartySize) {
      next = { canSave: false, reason: `Party size exceeds capacity (${maxPartySize}).` };
    } else if (!hasChange) {
      next = { canSave: false, reason: "No changes to save." };
    }

    onValidityChange(next);
  }, [
    availabilityLoading,
    dateAvailabilityLoading,
    date,
    time,
    partySize,
    notes,
    initial.date,
    initial.time,
    initial.partySize,
    initial.notes,
    availableDateKeys,
    availableTimes,
    timeMatchesAvailableSlot,
    maxPartySize,
    unavailableMessage,
    unavailableReason,
    onValidityChange,
  ]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-bg-elevated p-3 text-left transition-colors hover:bg-bg-elevated/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
            >
              <CalendarDays className="size-4 text-gold" />
              <span>
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Date</p>
                <p className="mt-1 text-sm text-white">{previewDateLabel}</p>
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
              onSelect={(picked) => {
                if (!picked) return;
                setDate(format(picked, "yyyy-MM-dd"));
                setDatePopoverOpen(false);
              }}
              disabled={unavailableDate}
              className="rounded-md border-0 bg-transparent [--cell-size:--spacing(8)]"
            />
          </PopoverContent>
        </Popover>

        <Popover open={timePopoverOpen} onOpenChange={setTimePopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-bg-elevated p-3 text-left transition-colors hover:bg-bg-elevated/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
            >
              <Clock className="size-4 text-gold" />
              <span>
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Time</p>
                <p className="mt-1 text-sm text-white">
                  {availabilityLoading
                    ? "Loading…"
                    : time
                      ? formatCompactTimeLabel(time)
                      : "Pick a time"}
                </p>
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="z-[120] w-48 border-border bg-bg-elevated p-2 text-text-primary shadow-2xl"
          >
            {availableTimes.length > 0 ? (
              <TimeWheel
                times={availableTimes}
                value={time || availableTimes[0]}
                onCommit={(picked) => {
                  setTime(picked);
                  setTimePopoverOpen(false);
                }}
              />
            ) : (
              <p className="px-2 py-3 text-center text-xs text-text-muted">
                {availabilityLoading
                  ? "Checking availability…"
                  : unavailableMessage ?? "No times available."}
              </p>
            )}
          </PopoverContent>
        </Popover>
      </div>

      <Popover open={partyPopoverOpen} onOpenChange={setPartyPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-bg-elevated p-3 text-left transition-colors hover:bg-bg-elevated/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
          >
            <Users className="size-4 text-gold" />
            <span>
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Party</p>
              <p className="mt-1 text-sm text-white">
                {partySize} guest{partySize === 1 ? "" : "s"}
              </p>
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="z-[120] w-48 border-border bg-bg-elevated p-2 text-text-primary shadow-2xl"
        >
          <SeatWheel
            maxSeats={maxPartySize}
            value={partySize}
            onCommit={(picked) => {
              setPartySize(picked);
              setPartyPopoverOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>

      {showNotes ? (
        <div className="grid gap-2">
          <label
            htmlFor="modify-booking-notes"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted"
          >
            Special request / notes
          </label>
          <textarea
            id="modify-booking-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            placeholder="Allergies, occasion, seating notes…"
            className="w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-foreground placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-gold/40"
          />
        </div>
      ) : null}

      {dinerConflictNotices.length > 0 ? (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
          <p className="font-semibold">Some times are hidden because you're already booked:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {dinerConflictNotices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function unavailableHeadline(reason: string | null): string | null {
  switch (reason) {
    case "closed":
      return "Closed on this date.";
    case "no_shifts":
      return "No service hours configured.";
    case "party_size_out_of_range":
      return "Party size is outside the bookable range.";
    case "fully_booked":
      return "Fully booked for this date.";
    case "no_future_slots":
      return "No more times remaining today.";
    case "no_slots":
      return "No times available.";
    default:
      return null;
  }
}
