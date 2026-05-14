import { useCallback, useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { addDays, format, parseISO } from "date-fns";
import { AlertCircle, ArrowRight, Bell, Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useUser } from "@/hooks/useUser";
import { fetchNextAvailableDate } from "@/hooks/useAvailability";
import { formatCompactTimeLabel, to24HourTime } from "@/lib/utils/time";
import { cn } from "@/lib/utils";

// Default ±window when watching a slot. Mirrors OpenTable's "Notify Me" semantics
// (they don't ask users for a window — they pick a sensible default and let the
// alert be loose enough to catch nearby cancellations). 2 hours covers most
// "I want around 7pm but I'd take 6 or 8" cases.
const DEFAULT_WINDOW_MINUTES = 120;

type SubmitError = {
  error: "closed_on_this_date" | "past_last_seating" | "beyond_booking_window";
  message: string;
  suggested_next_date: string | null;
};

type Props = {
  variant: "restaurant" | "event";
  restaurantId?: string;
  restaurantName?: string;
  /** URL slug used to navigate to the public restaurant page when the user
   *  picks "Look for available day". Only meaningful when variant="restaurant"
   *  AND `showLookForDay !== false`. */
  restaurantSlug?: string;
  eventId?: string;
  eventName?: string;
  defaultDate?: string;
  defaultTime?: string;
  defaultPartySize?: number;
  className?: string;
  size?: "sm" | "default";
  buttonLabel?: string;
  /** Hide the secondary "Look for available day" button. Default: true for
   *  restaurant variant, ignored for event variant (events never show it).
   *  Set false on surfaces where the user already has a calendar visible
   *  (AvailabilityPanel empty state) — the button would just close the
   *  dialog and drop them on the same calendar they're already looking at. */
  showLookForDay?: boolean;
};

const safeFormat = (yyyymmdd: string, pattern: string): string => {
  try {
    return format(parseISO(yyyymmdd), pattern);
  } catch {
    return yyyymmdd;
  }
};

export function NotifyMeButton({
  variant,
  restaurantId,
  restaurantName,
  restaurantSlug,
  eventId,
  eventName,
  defaultDate,
  defaultTime,
  defaultPartySize = 2,
  className,
  size = "default",
  buttonLabel = "Notify me",
  showLookForDay = true,
}: Props) {
  const { user } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // The actual date/time/party come from the host surface (Discover filter,
  // AvailabilityPanel state, etc.) and are inherited as defaults. The dialog
  // itself shows a summary — users go BACK to the host surface to change
  // their selection, or hit "Look for available day" to escape to the public
  // restaurant page.
  const [date, setDate] = useState(defaultDate ?? new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(defaultTime ?? "19:00");
  const [partySize, setPartySize] = useState(defaultPartySize);

  const [lastError, setLastError] = useState<SubmitError | null>(null);
  // Happy-path nudge — show a secondary "Or try X instead" link when there's
  // a nearby open date the user might prefer. Prefetched on dialog open.
  const [nextOpenDate, setNextOpenDate] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (defaultDate) setDate(defaultDate);
    if (defaultTime) setTime(defaultTime);
    setPartySize(defaultPartySize);
    setLastError(null);
  }, [open, defaultDate, defaultTime, defaultPartySize]);

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(location.search);
    if (params.get("notifyMe") === "1") {
      setOpen(true);
      params.delete("notifyMe");
      const cleaned = params.toString();
      navigate(
        { pathname: location.pathname, search: cleaned ? `?${cleaned}` : "" },
        { replace: true },
      );
    }
  }, [user, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!open || variant !== "restaurant" || !restaurantId || !date) {
      setNextOpenDate(null);
      return;
    }
    let cancelled = false;
    const fromDate = format(addDays(parseISO(date), 1), "yyyy-MM-dd");
    void fetchNextAvailableDate({
      restaurantId,
      partySize,
      fromDate,
    }).then((next) => {
      if (!cancelled) setNextOpenDate(next ?? null);
    });
    return () => { cancelled = true; };
  }, [open, variant, restaurantId, date, partySize]);

  const targetName =
    variant === "restaurant" ? restaurantName ?? "this restaurant" : eventName ?? "this event";

  // Whether to actually render the secondary "Look for available day" button.
  // Events always skip it (one-day events have no other day; multi-day events
  // already have a date picker in their detail dialog).
  const renderLookForDay =
    variant === "restaurant" && showLookForDay && Boolean(restaurantSlug);

  const handleClick = () => {
    if (!user) {
      const returnTo = `${location.pathname}${location.search ? location.search + "&" : "?"}notifyMe=1`;
      navigate(`/auth?return=${encodeURIComponent(returnTo)}`);
      return;
    }
    setOpen(true);
  };

  const handleLookForDay = () => {
    if (!restaurantSlug) return;
    setOpen(false);
    const params = new URLSearchParams();
    params.set("date", date);
    // Normalize 12h-style "6:00 AM" to "06:00" before adding to the URL. The
    // host pages (RestaurantPublicPage / AvailabilityPanel) expect 24h.
    const normalizedTime = time ? to24HourTime(time) ?? time : null;
    if (normalizedTime) params.set("time", normalizedTime);
    params.set("party", String(partySize));
    navigate(`/${restaurantSlug}?${params.toString()}`);
  };

  const submit = useCallback(async (override?: { date?: string }) => {
    if (!isSupabaseConfigured()) {
      toast.error("Not connected — try again in a moment.");
      return;
    }
    setSubmitting(true);
    setLastError(null);
    try {
      const client = getSupabaseBrowserClient();
      const effectiveDate = override?.date ?? date;
      // Normalize the time to 24h ("6:00 AM" → "06:00") so the Postgres
      // `time` column stores a clean value. The DB accepts AM/PM literals
      // but storing them in 24h matches the rest of Cenaiva's time columns.
      const normalizedTime = time ? to24HourTime(time) ?? time : null;
      const params =
        variant === "restaurant"
          ? {
              p_restaurant_id: restaurantId ?? null,
              p_event_id: null,
              p_date: effectiveDate,
              p_party_size: partySize,
              p_preferred_time: normalizedTime,
              p_window_minutes: DEFAULT_WINDOW_MINUTES,
            }
          : {
              p_restaurant_id: null,
              p_event_id: eventId ?? null,
              p_date: null,
              p_party_size: partySize,
              p_preferred_time: null,
              // Events don't use the window semantically (date+time are fixed
              // by the event itself), but the RPC validates window_minutes
              // BETWEEN 15 AND 480 so we send a valid placeholder.
              p_window_minutes: DEFAULT_WINDOW_MINUTES,
            };
      const { data, error } = await client.rpc("create_availability_alert", params);
      if (error) {
        toast.error(error.message);
        return;
      }
      const result = data as {
        ok: boolean;
        error?: string;
        message?: string;
        suggested_next_date?: string | null;
        alert_id?: string;
      };
      if (!result?.ok) {
        switch (result.error) {
          case "duplicate":
            toast.message("You're already watching this.", {
              description: "We'll ping you when a spot opens.",
            });
            setOpen(false);
            return;
          case "closed_on_this_date":
          case "past_last_seating":
          case "beyond_booking_window":
            setLastError({
              error: result.error,
              message: result.message ?? "That date isn't available.",
              suggested_next_date: result.suggested_next_date ?? null,
            });
            return;
          case "not_authenticated":
            toast.error("Please sign in to set an alert.");
            return;
          default:
            toast.error(result?.error ?? "Couldn't create alert.");
            return;
        }
      }
      toast.success("Got it. We'll ping you when a spot opens.");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create alert.");
    } finally {
      setSubmitting(false);
    }
  }, [variant, restaurantId, eventId, date, partySize, time]);

  // Build the one-line summary shown in the dialog body. Restaurant variant
  // shows date · time · party. Event variant just shows party (the event has
  // a fixed date/time displayed elsewhere).
  const summary =
    variant === "restaurant"
      ? `${safeFormat(date, "EEE, MMM d")} · ${formatCompactTimeLabel(time)} · ${partySize} guest${partySize === 1 ? "" : "s"}`
      : `${partySize} guest${partySize === 1 ? "" : "s"}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          onClick={handleClick}
          variant="outline"
          size={size === "sm" ? "sm" : "default"}
          className={cn("gap-1.5", className)}
        >
          <Bell className="size-4" />
          {buttonLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Notify me when a spot opens</DialogTitle>
          <DialogDescription>
            We'll ping you the moment {variant === "event" ? "seats open" : "a table opens"} at{" "}
            <span className="text-white">{targetName}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Summary line — what we'll actually be watching. */}
          <div className="rounded-xl border border-border bg-bg-elevated/60 px-4 py-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">
              We'll watch
            </p>
            <p className="mt-1 text-sm text-white">{summary}</p>
            {variant === "restaurant" ? (
              <p className="mt-1.5 text-[11px] text-text-muted">± 2 hr window</p>
            ) : null}
          </div>

          {/* Server rejected the date — show inline banner with one-tap retry
              if the server suggested another open date. */}
          {lastError ? (
            <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-3 text-sm">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" />
                <p className="text-text-secondary">{lastError.message}</p>
              </div>
              {lastError.suggested_next_date ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full justify-center gap-1.5 border-gold/40 text-gold hover:bg-gold/10"
                  onClick={() => {
                    const next = lastError.suggested_next_date!;
                    setDate(next);
                    setLastError(null);
                    void submit({ date: next });
                  }}
                  disabled={submitting}
                >
                  Use {safeFormat(lastError.suggested_next_date, "EEE, MMM d")}
                </Button>
              ) : null}
            </div>
          ) : null}

          {/* Happy-path nudge — alternative open date when one exists nearby
              AND we're not currently showing an error banner. Restaurant
              variant only. */}
          {!lastError && variant === "restaurant" && nextOpenDate && nextOpenDate !== date ? (
            <p className="text-xs text-text-muted">
              Heads up — there are openings on{" "}
              <button
                type="button"
                className="text-gold underline-offset-2 hover:underline"
                onClick={() => setDate(nextOpenDate)}
              >
                {safeFormat(nextOpenDate, "EEE, MMM d")}
              </button>{" "}
              too.
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:flex-row sm:justify-between">
          {renderLookForDay ? (
            <Button
              type="button"
              variant="ghost"
              onClick={handleLookForDay}
              disabled={submitting}
              className="gap-1.5"
            >
              Look for available day
              <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
          )}
          <Button onClick={() => void submit()} disabled={submitting} className="gap-1.5">
            {submitting ? "Setting up..." : (<><Check className="size-4" /> Notify me</>)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
