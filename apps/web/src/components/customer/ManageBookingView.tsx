import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CalendarDays, Clock, Loader2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ModifyBookingFields,
  type ModifyBookingValidity,
  type ModifyBookingValues,
} from "@/components/booking/ModifyBookingFields";
import { invalidateAvailabilityCache } from "@/hooks/useAvailability";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { formatCompactTimeLabel, to24HourTime } from "@/lib/utils/time";
import { cn } from "@/lib/utils";
import { toUserFacingError, toUserFacingEdgeError } from "@/lib/errors";

type LookupRow = {
  id: string;
  restaurant_id: string;
  reserved_at: string;
  party_size: number;
  status: string | null;
  guest_full_name: string | null;
  duration_minutes: number | null;
  special_request: string | null;
  restaurant_name: string | null;
  restaurant_timezone: string | null;
};

type Props = {
  slug: string;
  code: string;
  backHref: string;
};

const FINAL_STATUSES = new Set(["cancelled", "completed", "no_show"]);

function formatLocalDate(iso: string, tz: string | null): { date: string; time: string } {
  const date = new Date(iso);
  const tzSafe = tz ?? "America/Toronto";
  const dateLabel = date.toLocaleDateString("en-US", {
    timeZone: tzSafe,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeLabel = date.toLocaleTimeString("en-US", {
    timeZone: tzSafe,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return { date: dateLabel, time: timeLabel };
}

function isoDateInTz(iso: string, tz: string | null): string {
  const date = new Date(iso);
  const tzSafe = tz ?? "America/Toronto";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tzSafe,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${lookup("year")}-${lookup("month")}-${lookup("day")}`;
}

function isoTimeInTz(iso: string, tz: string | null): string {
  const date = new Date(iso);
  const tzSafe = tz ?? "America/Toronto";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tzSafe,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const lookup = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${lookup("hour")}:${lookup("minute")}`;
}

export function ManageBookingView({ slug, code, backHref }: Props) {
  const [reservation, setReservation] = useState<LookupRow | null>(null);
  const [lookupState, setLookupState] = useState<"loading" | "found" | "missing" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [mode, setMode] = useState<"view" | "modify" | "confirmCancel" | "done">("view");
  const [busy, setBusy] = useState(false);

  // Modify form state — driven by the shared ModifyBookingFields component.
  const [modifyInitial, setModifyInitial] = useState<ModifyBookingValues | null>(null);
  const [modifyValues, setModifyValues] = useState<ModifyBookingValues | null>(null);
  const [modifyValidity, setModifyValidity] = useState<ModifyBookingValidity>({
    canSave: false,
    reason: null,
    reasonKind: null,
  });

  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!isSupabaseConfigured()) {
        if (!cancelled) {
          setLookupState("error");
          setErrorMessage("Supabase is not configured.");
        }
        return;
      }
      const client = getSupabaseBrowserClient();
      const { data, error } = await client.rpc("lookup_reservation_by_code", {
        p_slug: slug,
        p_code: code,
      });
      if (cancelled) return;
      if (error) {
        const friendly = toUserFacingError(error, "Couldn't load this reservation. Try again.");
        setLookupState("error");
        setErrorMessage(friendly.message);
        console.error("[ManageBookingView.lookup]", friendly.code, friendly.technical ?? error);
        return;
      }
      const rows = (data as LookupRow[] | null) ?? [];
      if (!rows.length) {
        setLookupState("missing");
        return;
      }
      const row = rows[0];
      setReservation(row);
      setLookupState("found");
      // Seed modify form
      const initial: ModifyBookingValues = {
        date: isoDateInTz(row.reserved_at, row.restaurant_timezone),
        time: isoTimeInTz(row.reserved_at, row.restaurant_timezone),
        partySize: row.party_size,
        notes: row.special_request ?? "",
      };
      setModifyInitial(initial);
      setModifyValues(initial);
      setModifyValidity({ canSave: false, reason: null, reasonKind: null });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [slug, code]);

  const labels = useMemo(
    () => (reservation ? formatLocalDate(reservation.reserved_at, reservation.restaurant_timezone) : null),
    [reservation],
  );
  const isFinal = reservation && reservation.status && FINAL_STATUSES.has(reservation.status);

  const handleCancel = async () => {
    if (!reservation) return;
    setBusy(true);
    try {
      // Raw fetch (not client.functions.invoke) so we can read body.error on
      // non-2xx responses; functions.invoke wraps 4xx/5xx as generic
      // "non-2xx status code" and discards the JSON body.
      const client = getSupabaseBrowserClient();
      const { data: sessionData } = await client.auth.getSession();
      const token = sessionData.session?.access_token ?? null;
      const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/cancel-reservation`, {
        method: "POST",
        headers: {
          apikey: getSupabaseAnonKey(),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reservation_id: reservation.id,
          confirmation_code: code,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        refund_total_cents?: number;
        refunds?: Array<{ ok?: boolean; amount_cents?: number }>;
      };
      if (!res.ok || body.error || body.ok !== true) {
        const friendly = toUserFacingEdgeError(res, body as unknown as Record<string, unknown>);
        setErrorMessage(friendly.message);
        console.error("[ManageBookingView.cancel]", friendly.code, friendly.technical ?? body);
        setMode("view");
        return;
      }
      // Drop cached availability so the freed-up slot reappears immediately
      // without waiting for realtime / DB cache TTL.
      invalidateAvailabilityCache(reservation.restaurant_id);
      const refundCents = typeof body.refund_total_cents === "number" ? body.refund_total_cents : 0;
      const refundAttempted = Array.isArray(body.refunds) && body.refunds.length > 0;
      const refundPending = refundAttempted && body.refunds!.some((r) => r?.ok === false);
      let message = "Your reservation has been cancelled. The restaurant has been notified.";
      if (refundCents > 0) {
        const dollars = (refundCents / 100).toFixed(2);
        message = refundPending
          ? `Your reservation has been cancelled. $${dollars} refunded; remaining refunds are processing — we'll email you once they complete.`
          : `Your reservation has been cancelled. $${dollars} has been refunded to your card.`;
      } else if (refundPending) {
        message = "Your reservation has been cancelled. Refunds are still processing — we'll email you once they complete.";
      }
      setDoneMessage(message);
      setMode("done");
    } catch (err) {
      const friendly = toUserFacingError(err, "Couldn't cancel the reservation. Try again.");
      setErrorMessage(friendly.message);
      console.error("[ManageBookingView.cancel]", friendly.code, friendly.technical ?? err);
      setMode("view");
    } finally {
      setBusy(false);
    }
  };

  const handleModify = async () => {
    if (!reservation || !modifyValues || !modifyValidity.canSave) return;
    // The edge function expects 24-hour HH:MM (it concatenates `${date}T${time}:00Z`
    // into a Date constructor). The wheel commits a display string like "5:15pm".
    const normalisedTime = to24HourTime(modifyValues.time);
    if (!normalisedTime) {
      setErrorMessage("Pick a valid time and try again.");
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    try {
      // Raw fetch (not client.functions.invoke) so we can read body.error on
      // non-2xx responses. functions.invoke wraps any 4xx/5xx as a generic
      // "non-2xx status code" message and discards the JSON body.
      const client = getSupabaseBrowserClient();
      const { data: sessionData } = await client.auth.getSession();
      const token = sessionData.session?.access_token ?? null;
      const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/modify-reservation`, {
        method: "POST",
        headers: {
          apikey: getSupabaseAnonKey(),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reservation_id: reservation.id,
          confirmation_code: code,
          date: modifyValues.date,
          time: normalisedTime,
          party_size: modifyValues.partySize,
          special_request: modifyValues.notes,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        unavailable_reason?: string;
      };
      if (!res.ok || body.error || body.ok !== true) {
        const friendly = toUserFacingEdgeError(res, body as unknown as Record<string, unknown>);
        setErrorMessage(friendly.message);
        console.error("[ManageBookingView.modify]", friendly.code, friendly.technical ?? body);
        return;
      }
      // Drop cached availability so the previous slot reappears + the new
      // one disappears for this device on the next view.
      invalidateAvailabilityCache(reservation.restaurant_id);
      setDoneMessage("Your reservation has been updated. We've sent you a confirmation.");
      setMode("done");
    } catch (err) {
      const friendly = toUserFacingError(err, "Couldn't update the reservation. Try again.");
      setErrorMessage(friendly.message);
      console.error("[ManageBookingView.modify]", friendly.code, friendly.technical ?? err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <Button variant="ghost" size="sm" asChild className="mb-6 gap-1.5 text-text-secondary">
        <Link to={backHref}>
          <ArrowLeft className="size-4" />
          Back to {reservation?.restaurant_name ?? "restaurant"}
        </Link>
      </Button>

      {lookupState === "loading" && (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 className="size-4 animate-spin" />
          Loading your reservation…
        </div>
      )}

      {lookupState === "error" && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-danger/40 bg-danger/10 p-5 text-sm text-danger">
            We couldn't load this reservation: {errorMessage}
          </div>
          <p className="text-sm text-text-secondary">
            Can't find your booking?{" "}
            <Link to="/find-reservation" className="text-gold underline-offset-4 hover:underline">
              Try our reservation lookup →
            </Link>
          </p>
        </div>
      )}

      {lookupState === "missing" && (
        <div className="rounded-2xl border border-border bg-bg-surface p-5">
          <h1 className="font-serif text-2xl text-white">This booking can no longer be managed.</h1>
          <p className="mt-2 text-sm text-text-muted">
            The link may be invalid or the reservation may have already been cancelled or completed. If you believe this is a mistake, contact the restaurant directly.
          </p>
          <p className="mt-4 text-sm text-text-secondary">
            Can't find your booking?{" "}
            <Link to="/find-reservation" className="text-gold underline-offset-4 hover:underline">
              Try our reservation lookup →
            </Link>
          </p>
        </div>
      )}

      {lookupState === "found" && reservation && labels && (
        <div className="rounded-2xl border border-border bg-bg-surface p-6">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="font-serif text-2xl text-white">Manage your reservation</h1>
            {reservation.status && (
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em]",
                  isFinal ? "bg-bg-elevated text-text-muted" : "bg-gold/15 text-gold",
                )}
              >
                {reservation.status}
              </span>
            )}
          </div>

          <p className="text-sm text-text-secondary">{reservation.restaurant_name}</p>
          <p className="mt-1 font-serif text-xl text-white">{reservation.guest_full_name ?? "Guest"}</p>

          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex items-center gap-3">
              <CalendarDays className="size-4 text-gold" />
              <div className="flex-1 text-text-secondary">{labels.date}</div>
            </div>
            <div className="flex items-center gap-3">
              <Clock className="size-4 text-gold" />
              <div className="flex-1 text-text-secondary">{labels.time}</div>
            </div>
            <div className="flex items-center gap-3">
              <Users className="size-4 text-gold" />
              <div className="flex-1 text-text-secondary">
                {reservation.party_size} {reservation.party_size === 1 ? "guest" : "guests"}
              </div>
            </div>
            {reservation.special_request ? (
              <div className="rounded-xl border border-border bg-bg-elevated p-3 text-text-secondary">
                <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Notes</span>
                <span className="mt-1 block">{reservation.special_request}</span>
              </div>
            ) : null}
          </dl>

          {errorMessage && (
            <div className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {errorMessage}
            </div>
          )}

          {mode === "done" && (
            <div className="mt-5 rounded-xl border border-success/40 bg-success/10 p-4 text-sm text-success">
              {doneMessage}
            </div>
          )}

          {!isFinal && mode === "view" && (
            <div className="mt-6 flex flex-wrap gap-2">
              <Button onClick={() => setMode("modify")} disabled={busy}>
                Modify booking
              </Button>
              <Button
                variant="outline"
                onClick={() => setMode("confirmCancel")}
                disabled={busy}
              >
                Cancel booking
              </Button>
            </div>
          )}

          {mode === "confirmCancel" && (
            <div className="mt-6 rounded-xl border border-border bg-bg-elevated p-4">
              <p className="text-sm text-white">Cancel this reservation?</p>
              <p className="mt-1 text-xs text-text-muted">
                The restaurant will be notified and the table will be released.
              </p>
              <div className="mt-4 flex gap-2">
                <Button variant="destructive" onClick={handleCancel} disabled={busy}>
                  {busy ? "Cancelling…" : "Yes, cancel"}
                </Button>
                <Button variant="ghost" onClick={() => setMode("view")} disabled={busy}>
                  Keep booking
                </Button>
              </div>
            </div>
          )}

          {mode === "modify" && modifyInitial && (
            <div className="mt-6 space-y-4">
              <ModifyBookingFields
                key={`${reservation.id}-modify`}
                restaurantId={reservation.restaurant_id}
                restaurantTimezone={reservation.restaurant_timezone}
                reservationId={reservation.id}
                userProfileId={null}
                initial={modifyInitial}
                onChange={setModifyValues}
                onValidityChange={setModifyValidity}
              />
              {(() => {
                const pickedTime = modifyValues?.time
                  ? formatCompactTimeLabel(modifyValues.time)
                  : null;
                const ctaLabel = busy
                  ? "Saving…"
                  : modifyValidity.reasonKind === "blocking" && modifyValidity.reason
                    ? modifyValidity.reason
                    : modifyValidity.reasonKind === "neutral" && modifyValidity.reason
                      ? modifyValidity.reason
                      : modifyValidity.canSave && pickedTime
                        ? `Confirm ${pickedTime} changes`
                        : "Pick new details to continue";
                return (
                  <div className="space-y-2">
                    <Button
                      onClick={handleModify}
                      disabled={busy || !modifyValidity.canSave}
                      className="h-14 w-full rounded-xl text-base font-semibold"
                    >
                      {ctaLabel}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setMode("view")}
                      disabled={busy}
                      className="h-9 w-full text-sm font-normal text-text-muted hover:text-text-primary"
                    >
                      Keep current booking
                    </Button>
                  </div>
                );
              })()}
            </div>
          )}

          {mode === "done" && (
            <div className="mt-5">
              <Button asChild variant="outline">
                <Link to={backHref}>Back to {reservation.restaurant_name ?? "restaurant"}</Link>
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
