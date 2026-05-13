import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock, FileText, Info, MapPin, Star, Tag, Ticket, Users } from "lucide-react";
import { format, isValid, parse, startOfToday } from "date-fns";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SeatWheel } from "@/components/booking/SeatWheel";
import { TimeWheel } from "@/components/booking/TimeWheel";
import type { EventPromotionDisplay } from "@/lib/customer/eventPromotionDisplay";
import { cn } from "@/lib/utils";

export type ReserveParams = {
  partySize: number;
  time: string; // "HH:mm" 24-hour
  date: string; // "yyyy-mm-dd"
};

const DEFAULT_PARTY_CAP = 20;
const FALLBACK_TIME = "19:00";

function safeParseDate(value: string): Date | null {
  if (!value) return null;
  const parsed = parse(value, "yyyy-MM-dd", new Date());
  return isValid(parsed) ? parsed : null;
}

function formatTwelveHour(hhmm: string): string {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return hhmm;
  let h = parseInt(m[1], 10);
  const mn = m[2];
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${mn} ${period}`;
}

function hhmmToMinutes(value: string): number | null {
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// 30-min stepped options between start and end inclusive. Returns single-entry
// list if start === end (or end missing), so the TimeWheel renders cleanly.
function buildTimeOptions(start: string | null, end: string | null): string[] {
  const a = start ? hhmmToMinutes(start) : null;
  const b = end ? hhmmToMinutes(end) : null;
  if (a == null) return [start ?? FALLBACK_TIME];
  if (b == null || b <= a) return [minutesToHHMM(a)];
  const out: string[] = [];
  for (let m = a; m <= b; m += 30) out.push(minutesToHHMM(m));
  return out;
}

function formatDateLabel(value: string): string {
  const parsed = safeParseDate(value);
  if (!parsed) return "Pick a date";
  return parsed.toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function EventPromotionArt({ item, className }: { item: EventPromotionDisplay; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden bg-bg-base", className)}>
      {item.imageUrl ? (
        <img src={item.imageUrl} alt={item.title} className="size-full object-cover" />
      ) : (
        <>
          <div
            aria-hidden
            className="absolute inset-0 bg-[repeating-linear-gradient(135deg,var(--gold)_0_1px,transparent_1px_16px)] opacity-20"
          />
          <div aria-hidden className="absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold/35 ring-8 ring-gold/10" />
          <span className="absolute bottom-5 left-1/2 -translate-x-1/2 font-mono text-[10px] uppercase tracking-[0.35em] text-gold/70">
            {item.imageLabel}
          </span>
        </>
      )}
      <div className="absolute left-4 top-4 flex flex-wrap gap-2">
        <span className="rounded-md border border-gold/40 bg-bg-base/70 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-gold backdrop-blur">
          {item.badgeLabel}
        </span>
        <span className="rounded-md border border-gold/40 bg-bg-base/70 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-gold backdrop-blur">
          {item.availabilityLabel}
        </span>
      </div>
      {item.mediaType === "pdf" && (
        <div className="absolute bottom-4 right-4 inline-flex items-center gap-2 rounded-md border border-border bg-bg-base/75 px-3 py-2 text-xs text-white backdrop-blur">
          <FileText className="size-4 text-gold" />
          PDF attached
        </div>
      )}
    </div>
  );
}

export function EventPromotionDetailCard({
  item,
  onReserve,
  onRestaurantOpen,
  className,
  preview = false,
}: {
  item: EventPromotionDisplay;
  // onReserve callback receives the picked party size + time + date so the
  // booking URL can be pre-filled with the diner's actual choice.
  onReserve?: (item: EventPromotionDisplay, params: ReserveParams) => void;
  onRestaurantOpen?: (item: EventPromotionDisplay) => void;
  className?: string;
  preview?: boolean;
}) {
  const canOpenRestaurant = Boolean(onRestaurantOpen);

  // ── Constraint computation ───────────────────────────────────────────────
  // Date locking: when rawEndDate is null OR equals rawDate, the date is
  // locked. Otherwise the diner can pick within [rawDate, rawEndDate].
  const dateLocked = !item.rawEndDate || item.rawEndDate === item.rawDate;
  const defaultDate = item.rawDate ?? format(startOfToday(), "yyyy-MM-dd");
  // Time locking: events with fixed_arrival_time, or with start_time but no
  // distinct end_time. Promos never set timeLocked.
  const timeLocked = item.timeLocked;
  const winStart = item.rawTimeWindowStart ? item.rawTimeWindowStart.slice(0, 5) : null;
  const winEnd = item.rawTimeWindowEnd ? item.rawTimeWindowEnd.slice(0, 5) : null;
  const defaultTime = winStart ?? FALLBACK_TIME;

  // ── State ──
  const [partySize, setPartySize] = useState<number>(2);
  const [time, setTime] = useState<string>(defaultTime);
  const [date, setDate] = useState<string>(defaultDate);
  const [calendarMonth, setCalendarMonth] = useState<Date>(
    () => safeParseDate(defaultDate) ?? new Date(),
  );
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [timePopoverOpen, setTimePopoverOpen] = useState(false);
  const [partyPopoverOpen, setPartyPopoverOpen] = useState(false);

  // Re-seed the pickers when the dialog navigates between different items.
  // Item-id guards make this a one-shot per item change rather than a
  // continuous sync, so the user's manual picks are preserved between
  // renders of the same item.
  useEffect(() => {
    const nextDate = item.rawDate ?? format(startOfToday(), "yyyy-MM-dd");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTime(winStart ?? FALLBACK_TIME);
    setDate(nextDate);
    setCalendarMonth(safeParseDate(nextDate) ?? new Date());
  }, [item.id, item.rawDate, winStart]);

  // ── Time wheel options derived from window bounds ──
  const timeOptions = useMemo(() => {
    if (timeLocked || !winEnd) {
      // Locked or no end bound → single option pinned to start (or fallback).
      return [winStart ?? FALLBACK_TIME];
    }
    return buildTimeOptions(winStart, winEnd);
  }, [timeLocked, winStart, winEnd]);

  // ── Party-size cap: clamp by seatsLeft when the event tracks tickets. ──
  const seatsLeft = item.seatsLeft;
  const partyCap = useMemo(() => {
    const ceiling =
      seatsLeft != null && seatsLeft > 0
        ? Math.min(seatsLeft, DEFAULT_PARTY_CAP)
        : DEFAULT_PARTY_CAP;
    return Math.max(1, ceiling);
  }, [seatsLeft]);

  // ── Validation ──
  const timeInWindow = (() => {
    if (timeLocked) return time === (winStart ?? FALLBACK_TIME);
    if (!winStart || !winEnd) return true;
    return time >= winStart && time <= winEnd;
  })();
  const dateInWindow = (() => {
    if (dateLocked) return date === item.rawDate;
    return (
      (!item.rawDate || date >= item.rawDate)
      && (!item.rawEndDate || date <= item.rawEndDate)
    );
  })();
  const canBook = !preview
    && partySize >= 1 && partySize <= partyCap
    && /^\d{2}:\d{2}$/.test(time)
    && timeInWindow
    && dateInWindow;
  const exceedsCapacity = seatsLeft != null && partySize > seatsLeft;

  // ── Calendar disabled predicate (date popover) ──
  const dateRangeStart = useMemo(() => safeParseDate(item.rawDate ?? ""), [item.rawDate]);
  const dateRangeEnd = useMemo(() => safeParseDate(item.rawEndDate ?? ""), [item.rawEndDate]);
  const unavailableDate = (candidate: Date): boolean => {
    const today = startOfToday();
    if (candidate < today) return true;
    if (dateRangeStart && candidate < dateRangeStart) return true;
    if (dateRangeEnd && candidate > dateRangeEnd) return true;
    if (dateLocked && dateRangeStart) {
      return candidate.getTime() !== dateRangeStart.getTime();
    }
    return false;
  };

  return (
    <article className={cn("overflow-hidden rounded-2xl border border-border bg-bg-surface text-text-primary shadow-2xl shadow-black/30", className)}>
      <EventPromotionArt item={item} className="h-56 sm:h-64" />
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-secondary">
            <span>{item.cuisineLabel}</span>
            <span>{item.priceRangeLabel}</span>
            <span className="inline-flex items-center gap-1">
              <Star className="size-3.5 fill-gold text-gold" />
              {item.ratingLabel}
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5 text-text-muted" />
              {item.cityLabel}
            </span>
          </div>

          <h2 className="mt-3 line-clamp-2 break-words font-serif text-3xl leading-tight text-white sm:text-4xl">
            {item.title}
          </h2>
          {item.description && (
            <p className="mt-3 line-clamp-3 max-w-2xl whitespace-pre-line break-words text-sm leading-6 text-text-secondary">
              {item.description}
            </p>
          )}

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-bg-elevated/60 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Date</p>
              <p className="mt-2 inline-flex items-center gap-2 text-sm text-white">
                <CalendarDays className="size-4 text-gold" />
                {item.dateLabel}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-bg-elevated/60 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Time</p>
              <p className="mt-2 inline-flex items-center gap-2 text-sm text-white">
                <Clock className="size-4 text-gold" />
                {item.timeLabel}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-bg-elevated/60 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Price</p>
              <p className="mt-2 inline-flex items-center gap-2 text-sm text-white">
                <Tag className="size-4 text-gold" />
                {item.priceLabel}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-bg-elevated/60 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Availability</p>
              <p className="mt-2 inline-flex items-center gap-2 text-sm text-white">
                <Users className="size-4 text-gold" />
                {item.seatsLabel ?? item.availabilityLabel}
              </p>
            </div>
            {item.mediaType === "pdf" && item.mediaUrl && (
              <a
                href={item.mediaUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-border bg-bg-elevated/60 p-4 transition-colors hover:border-gold/40 sm:col-span-2"
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Attachment</p>
                <p className="mt-2 inline-flex items-center gap-2 text-sm text-white">
                  <FileText className="size-4 text-gold" />
                  {item.mediaName ?? "Open PDF"}
                </p>
              </a>
            )}
          </div>
        </div>

        <aside className="border-t border-border bg-bg-elevated/30 p-5 sm:p-6 lg:border-l lg:border-t-0">
          <h3 className="font-serif text-xl text-white">
            {item.source === "event" ? "Book this event" : "Book this promotion"}
          </h3>
          <div className="mt-4 space-y-3 text-sm text-text-secondary">
            <p className="flex justify-between gap-4">
              <span>Restaurant</span>
              {canOpenRestaurant ? (
                <button
                  type="button"
                  onClick={() => onRestaurantOpen?.(item)}
                  className="text-right text-white underline-offset-4 transition-colors hover:text-gold hover:underline"
                >
                  {item.restaurantName}
                </button>
              ) : (
                <span className="text-right text-white">{item.restaurantName}</span>
              )}
            </p>
            <p className="flex justify-between gap-4">
              <span>{item.source === "event" ? "Per cover" : "Offer"}</span>
              <span className="text-right text-white">{item.perCoverLabel ?? item.priceLabel}</span>
            </p>
            {item.promoCode && (
              <p className="flex justify-between gap-4">
                <span>Promo code</span>
                <span className="font-mono uppercase text-gold">{item.promoCode}</span>
              </p>
            )}
            {preview && (
              <p className="flex justify-between gap-4">
                <span>Status</span>
                <span className={item.isActive ? "text-success" : "text-text-muted"}>
                  {item.isActive ? "Visible to diners" : "Draft preview"}
                </span>
              </p>
            )}
          </div>

          {/* Diner booking controls — DATE / TIME / PARTY chips that open the
              same Popover + Calendar / TimeWheel / SeatWheel widgets used by
              AvailabilityPanel on the public restaurant page. Constraints
              come from the event/promotion config (rawDate, rawEndDate,
              timeLocked, rawTimeWindowStart/End, seatsLeft). Hidden in
              owner-preview mode.

              Layout: chips stack vertically (`grid-cols-1`). The aside this
              renders into is only 300px wide on lg+, so a 3-col row would
              truncate every value mid-word ("Fr...", "8:...", "2 ..."). One
              chip per row keeps every value fully legible. */}
          {!preview && (
            <div className="mt-5 grid grid-cols-1 gap-2">
              {/* DATE */}
              <Popover
                open={dateLocked ? false : datePopoverOpen}
                onOpenChange={(open) => !dateLocked && setDatePopoverOpen(open)}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={dateLocked}
                    className="flex w-full items-center gap-3 rounded-xl border border-border bg-bg-elevated p-3 text-left transition-colors hover:bg-bg-elevated/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <CalendarDays className="size-4 text-gold" />
                    <span className="min-w-0 flex-1">
                      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">
                        Date
                      </p>
                      <p className="mt-1 truncate text-sm text-white">
                        {formatDateLabel(date)}
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

              {/* TIME */}
              <Popover
                open={timeLocked || timeOptions.length <= 1 ? false : timePopoverOpen}
                onOpenChange={(open) => {
                  if (timeLocked || timeOptions.length <= 1) return;
                  setTimePopoverOpen(open);
                }}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={timeLocked || timeOptions.length <= 1}
                    className="flex w-full items-center gap-3 rounded-xl border border-border bg-bg-elevated p-3 text-left transition-colors hover:bg-bg-elevated/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Clock className="size-4 text-gold" />
                    <span className="min-w-0 flex-1">
                      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">
                        Time
                      </p>
                      <p className="mt-1 truncate text-sm text-white">
                        {formatTwelveHour(time)}
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
                    value={time}
                    onCommit={(picked) => {
                      setTime(picked);
                      setTimePopoverOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>

              {/* PARTY */}
              <Popover open={partyPopoverOpen} onOpenChange={setPartyPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-xl border border-border bg-bg-elevated p-3 text-left transition-colors hover:bg-bg-elevated/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
                  >
                    <Users className="size-4 text-gold" />
                    <span className="min-w-0 flex-1">
                      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">
                        Party
                      </p>
                      <p className="mt-1 truncate text-sm text-white">
                        {partySize} guest{partySize === 1 ? "" : "s"}
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
                    value={Math.min(partySize, partyCap)}
                    onCommit={(picked) => {
                      setPartySize(picked);
                      setPartyPopoverOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* Inline validation hints — surfaced beneath the chips. */}
          {!preview && (timeLocked || (winStart && winEnd) || dateLocked || (item.rawDate && item.rawEndDate) || exceedsCapacity) ? (
            <div className="mt-2 space-y-1 text-[11px] text-text-muted">
              {dateLocked && item.rawDate && (
                <p>Date locked to {formatDateLabel(item.rawDate)}.</p>
              )}
              {!dateLocked && item.rawDate && item.rawEndDate && (
                <p>
                  Pick a date between {formatDateLabel(item.rawDate)} and {formatDateLabel(item.rawEndDate)}.
                </p>
              )}
              {timeLocked && winStart && (
                <p>Arrival time fixed at {formatTwelveHour(winStart)}.</p>
              )}
              {!timeLocked && winStart && winEnd && (
                <p>Pick a time between {formatTwelveHour(winStart)} and {formatTwelveHour(winEnd)}.</p>
              )}
              {exceedsCapacity && seatsLeft != null && (
                <p className="text-amber-300">Only {seatsLeft} seat{seatsLeft === 1 ? "" : "s"} left.</p>
              )}
            </div>
          ) : null}

          <Button
            className="mt-5 h-12 w-full gap-2 rounded-md font-semibold"
            onClick={() => onReserve?.(item, { partySize, time, date })}
            disabled={!preview && (!canBook || exceedsCapacity)}
          >
            <Ticket className="size-4" />
            {preview ? "Preview only" : "Book"}
          </Button>
          {canOpenRestaurant && (
            <Button
              type="button"
              variant="outline"
              className="mt-3 h-11 w-full rounded-md font-semibold"
              onClick={() => onRestaurantOpen?.(item)}
            >
              View restaurant menu
            </Button>
          )}

          {preview && (
            <p className="mt-5 flex gap-2 text-[11px] leading-relaxed text-text-muted">
              <Info className="mt-0.5 size-3.5 shrink-0 text-gold" />
              Diners see this card from promotions and restaurant event surfaces.
            </p>
          )}
        </aside>
      </div>
    </article>
  );
}

export function EventPromotionDetailDialog({
  item,
  open,
  onOpenChange,
  onReserve,
  onRestaurantOpen,
  keepOpenOnOutsideInteraction = false,
  modal = true,
  preview = false,
}: {
  item: EventPromotionDisplay | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReserve?: (item: EventPromotionDisplay, params: ReserveParams) => void;
  onRestaurantOpen?: (item: EventPromotionDisplay) => void;
  keepOpenOnOutsideInteraction?: boolean;
  modal?: boolean;
  preview?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={modal}>
      <DialogContent
        className="max-h-[92vh] overflow-y-auto border-border bg-bg-base p-0 text-text-primary sm:max-w-4xl"
        onEscapeKeyDown={(event) => {
          if (keepOpenOnOutsideInteraction) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (keepOpenOnOutsideInteraction) event.preventDefault();
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{item?.title ?? "Event preview"}</DialogTitle>
        </DialogHeader>
        {item && (
          <EventPromotionDetailCard
            item={item}
            onReserve={onReserve}
            onRestaurantOpen={onRestaurantOpen}
            preview={preview}
            className="border-0 shadow-none"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
