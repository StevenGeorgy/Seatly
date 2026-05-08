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
  /**
   * `"blocking"` → the chosen combo is genuinely unbookable; render a yellow
   *                banner so the user can't miss it.
   * `"neutral"`  → loading / "no changes yet" / pick-a-date — render as muted
   *                helper text instead.
   */
  reasonKind: "blocking" | "neutral" | null;
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

  // `null` means "no fetch has completed for this restaurant/party/month yet"
  // — distinct from an empty Set, which means "we asked and there are zero
  // open dates." The unavailableDate predicate uses this distinction so the
  // calendar doesn't grey out every date during the initial fetch race.
  const [availableDateKeys, setAvailableDateKeys] = useState<Set<string> | null>(null);
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

  // Drop the picked time when it's no longer in the live `availableTimes` set
  // (e.g. user just bumped party size and the previously-picked slot doesn't
  // fit the new party). Without this, the wheel still displays the stale
  // value, the validity effect briefly sees a match in the OLD slots until
  // the new fetch lands, and the user can race a Confirm click that the
  // server then has to reject. Only runs once availability has actually
  // settled (loading=false AND we have at least one slot or an explicit
  // unavailable_reason from the RPC) — otherwise we'd clear during the
  // transient empty-slots window every time the user changes a field.
  useEffect(() => {
    if (availabilityLoading) return;
    if (!time) return;
    if (availableTimes.length === 0) return; // handled by the blocking banner
    const normalised = formatCompactTimeLabel(time);
    const stillThere = availableTimes.some(
      (candidate) => formatCompactTimeLabel(candidate) === normalised,
    );
    if (!stillThere) setTime("");
  }, [availabilityLoading, time, availableTimes]);

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

  const [blockingReason, setBlockingReason] = useState<string | null>(null);

  // Calendar disabled predicate. Today's date may also be disabled if there
  // are no slots remaining; that's fine.
  const today = startOfToday();
  const calendarRangeEnd = useMemo(() => addDays(today, 62), [today]);
  const unavailableDate = (candidate: Date) => {
    if (candidate < today) return true;
    if (candidate > calendarRangeEnd) return true;
    // While the first fetch is in flight (`loading`) or hasn't completed yet
    // (`null` set), don't pre-grey future dates — otherwise the calendar
    // pops open with everything disabled until the fetch lands.
    if (dateAvailabilityLoading || availableDateKeys === null) return false;
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

  // True while ANY availability fetch is in flight. The whole form locks
  // during this window so the user can't change inputs faster than the
  // server can respond — matches the contract: "they shouldn't be able to
  // change any of it until the loading is completed".
  const isLoading = availabilityLoading || dateAvailabilityLoading || availableDateKeys === null;

  const partySizeLabel = `${partySize} guest${partySize === 1 ? "" : "s"}`;
  const dateForBanner = useMemo(() => {
    const parsed = safeParseDate(date);
    if (!parsed) return null;
    return parsed.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
  }, [date]);

  // Derive validity. Reported up to the parent so it can drive its Save
  // button + helper text. `reasonKind` tells the parent whether to render the
  // reason as a yellow banner ("blocking") or muted text ("neutral").
  useEffect(() => {
    let next: ModifyBookingValidity = { canSave: true, reason: null, reasonKind: null };

    const hasChange =
      date !== initial.date
      || partySize !== initial.partySize
      || notes !== initial.notes
      || (time && formatCompactTimeLabel(time) !== formatCompactTimeLabel(initial.time));

    if (isLoading) {
      next = { canSave: false, reason: "Checking availability…", reasonKind: "neutral" };
    } else if (!date) {
      next = { canSave: false, reason: "Pick a date.", reasonKind: "neutral" };
    } else if (!availableDateKeys.has(date)) {
      next = {
        canSave: false,
        reason: dateForBanner
          ? `No times open on ${dateForBanner} for ${partySizeLabel}. Try another date or smaller party.`
          : "No times open on that date.",
        reasonKind: "blocking",
      };
    } else if (!availableTimes.length) {
      next = {
        canSave: false,
        reason:
          unavailableMessage
          ?? unavailableHeadline(unavailableReason)
          ?? (dateForBanner
            ? `No times available for ${partySizeLabel} on ${dateForBanner}. Try another date or smaller party.`
            : `No times available for ${partySizeLabel}.`),
        reasonKind: "blocking",
      };
    } else if (!time) {
      // Time is empty — either the user hasn't picked yet, or our auto-clear
      // dropped the previous pick because it's no longer in availableTimes.
      // This is a neutral "needs input" state, not a blocking error.
      next = { canSave: false, reason: "Pick a time from the list.", reasonKind: "neutral" };
    } else if (!timeMatchesAvailableSlot) {
      next = {
        canSave: false,
        reason: `That time isn't available for ${partySizeLabel}. Pick a time from the list.`,
        reasonKind: "blocking",
      };
    } else if (partySize > maxPartySize) {
      next = {
        canSave: false,
        reason: `Party size exceeds capacity (${maxPartySize}).`,
        reasonKind: "blocking",
      };
    } else if (!hasChange) {
      next = { canSave: false, reason: "No changes to save.", reasonKind: "neutral" };
    }

    setBlockingReason(next.reasonKind === "blocking" ? next.reason : null);
    onValidityChange(next);
  }, [
    isLoading,
    dateForBanner,
    partySizeLabel,
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
        <Popover
          open={isLoading ? false : datePopoverOpen}
          onOpenChange={(open) => !isLoading && setDatePopoverOpen(open)}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={isLoading}
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-bg-elevated p-3 text-left transition-colors hover:bg-bg-elevated/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CalendarDays className="size-4 text-gold" />
              <span>
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Date</p>
                <p className="mt-1 text-sm text-white">{isLoading ? "Loading…" : previewDateLabel}</p>
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

        <Popover
          open={isLoading ? false : timePopoverOpen}
          onOpenChange={(open) => !isLoading && setTimePopoverOpen(open)}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={isLoading}
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-bg-elevated p-3 text-left transition-colors hover:bg-bg-elevated/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Clock className="size-4 text-gold" />
              <span>
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Time</p>
                <p className="mt-1 text-sm text-white">
                  {isLoading
                    ? "Loading…"
                    : time
                      ? formatCompactTimeLabel(time)
                      : availableTimes.length > 0
                        ? "Pick a time"
                        : "No times"}
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
                No times available.
              </p>
            )}
          </PopoverContent>
        </Popover>
      </div>

      <Popover
        open={isLoading ? false : partyPopoverOpen}
        onOpenChange={(open) => !isLoading && setPartyPopoverOpen(open)}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={isLoading}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-bg-elevated p-3 text-left transition-colors hover:bg-bg-elevated/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Users className="size-4 text-gold" />
            <span>
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Party</p>
              <p className="mt-1 text-sm text-white">
                {isLoading ? "Loading…" : `${partySize} guest${partySize === 1 ? "" : "s"}`}
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
            disabled={isLoading}
            placeholder="Allergies, occasion, seating notes…"
            className="w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-foreground placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-xl border border-border bg-bg-elevated/40 px-3 py-2 text-xs leading-relaxed text-text-muted">
          Checking availability…
        </div>
      ) : blockingReason ? (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
          <p className="font-semibold">{blockingReason}</p>
          <p className="mt-1 text-warning/80">
            Pick a different date, time, or party size to continue.
          </p>
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
