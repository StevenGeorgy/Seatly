import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  MapPin,
  PencilLine,
  Phone,
  Tag,
  Users,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CenaivaWordmark } from "@/components/brand/CenaivaWordmark";
import { CustomerNav } from "@/components/customer/CustomerNav";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ModifyBookingFields,
  type ModifyBookingValidity,
  type ModifyBookingValues,
} from "@/components/booking/ModifyBookingFields";
import { invalidateAvailabilityCache } from "@/hooks/useAvailability";
import { useMyReservations, type MyReservationRow } from "@/hooks/useMyReservations";
import { useUser } from "@/hooks/useUser";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import {
  reservationDisplayStatus,
  reservationDisplayStatusKey,
  type ReservationDisplayStatus,
} from "@/lib/reservations/displayStatus";
import { cn } from "@/lib/utils";
import { dateInTz, formatCompactTimeLabel, formatCompactTimeLabelInTz, timeInTz, to24HourTime } from "@/lib/utils/time";

function statusFor(row: MyReservationRow): ReservationDisplayStatus {
  return reservationDisplayStatus(row);
}

function statusClass(status: ReservationDisplayStatus): string {
  const classes: Record<ReservationDisplayStatus, string> = {
    upcoming: "border-success/30 bg-success/10 text-success",
    current: "border-gold/30 bg-gold/10 text-gold",
    past: "border-border bg-bg-elevated text-text-secondary",
    cancelled: "border-danger/30 bg-danger/10 text-danger",
  };
  return classes[status];
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-bg-surface/60 p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold/10 text-gold">
        <Icon className="size-4" />
      </span>
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          {label}
        </p>
        <p className="mt-1 text-sm font-medium text-white">{value}</p>
      </div>
    </div>
  );
}

async function cancelReservation(reservationId: string): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error("Authentication is not available. Configure Supabase first.");
  }

  // Raw fetch (not client.functions.invoke) so we can read body.error on
  // non-2xx responses. functions.invoke wraps any 4xx/5xx as a generic
  // "Edge Function returned a non-2xx status code" message and discards the
  // JSON body the edge function uses to explain why.
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
    body: JSON.stringify({ reservation_id: reservationId }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };
  if (!res.ok || body.error || body.ok !== true) {
    throw new Error(body.error ?? `Could not cancel reservation (${res.status}).`);
  }
}

async function modifyReservation(
  reservationId: string,
  payload: {
    date: string;
    time: string;
    partySize: number;
    specialRequest: string;
  },
): Promise<void> {
  if (!isSupabaseConfigured()) {
    throw new Error("Authentication is not available. Configure Supabase first.");
  }

  // The edge function builds a UTC ISO via `new Date("${date}T${time}:00Z")`
  // which only accepts 24-hour HH:MM. The wheel commits the slot's display
  // string ("5:15pm") so we need to normalise here before sending.
  const normalisedTime = to24HourTime(payload.time);
  if (!normalisedTime) {
    throw new Error("Pick a valid time and try again.");
  }

  // Raw fetch (not client.functions.invoke) so we can read body.error on
  // non-2xx responses. functions.invoke wraps any 4xx/5xx as a generic
  // "Edge Function returned a non-2xx status code" message and discards the
  // JSON body the edge function uses to explain why.
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
      reservation_id: reservationId,
      date: payload.date,
      time: normalisedTime,
      party_size: payload.partySize,
      special_request: payload.specialRequest,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    unavailable_reason?: string;
  };
  if (!res.ok || body.error || body.ok !== true) {
    throw new Error(body.error ?? `Could not modify reservation (${res.status}).`);
  }
}

export default function BookingDetailsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { reservationId } = useParams<{ reservationId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { upcoming, past, loading, refresh } = useMyReservations();
  const { profile } = useUser();
  const [cancelling, setCancelling] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [modifyOpen, setModifyOpen] = useState(false);
  const autoOpenedFromUrl = useRef(false);
  const [modifying, setModifying] = useState(false);
  const [modifyInitial, setModifyInitial] = useState<ModifyBookingValues | null>(null);
  const [modifyValues, setModifyValues] = useState<ModifyBookingValues | null>(null);
  const [modifyValidity, setModifyValidity] = useState<ModifyBookingValidity>({
    canSave: false,
    reason: null,
    reasonKind: null,
  });

  const reservation = useMemo(() => {
    return [...upcoming, ...past].find((row) => row.id === reservationId) ?? null;
  }, [past, reservationId, upcoming]);

  const status = reservation ? statusFor(reservation) : null;
  const reservedAt = useMemo(
    () => reservation ? new Date(reservation.reserved_at) : null,
    [reservation],
  );
  const canCancel = Boolean(reservation && (status === "upcoming" || status === "current"));
  const canModify = canCancel;
  const restaurantName = reservation?.restaurant?.name ?? "Restaurant";
  const cuisineLine = [reservation?.restaurant?.cuisine_type, reservation?.restaurant?.city]
    .filter(Boolean)
    .join(" · ");

  const buildInitialModifyValues = (
    row: MyReservationRow,
    at: Date,
  ): ModifyBookingValues => {
    const tz = row.restaurant?.timezone ?? null;
    return {
      date: dateInTz(at, tz),
      time: timeInTz(at, tz),
      partySize: row.party_size,
      notes: row.special_request ?? "",
    };
  };

  const openModifyDialog = () => {
    if (!reservation || !reservedAt || !canModify) return;
    const initial = buildInitialModifyValues(reservation, reservedAt);
    setModifyInitial(initial);
    setModifyValues(initial);
    setModifyValidity({ canSave: false, reason: null, reasonKind: null });
    setModifyOpen(true);
  };

  useEffect(() => {
    if (autoOpenedFromUrl.current) return;
    if (searchParams.get("modify") !== "1" || !reservation || !reservedAt || !canModify) {
      return;
    }
    autoOpenedFromUrl.current = true;
    const initial = buildInitialModifyValues(reservation, reservedAt);
    setModifyInitial(initial);
    setModifyValues(initial);
    setModifyValidity({ canSave: false, reason: null, reasonKind: null });
    setModifyOpen(true);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("modify");
        return next;
      },
      { replace: true },
    );
  }, [canModify, reservation, reservedAt, searchParams, setSearchParams]);

  const handleCancel = async () => {
    if (!reservation || !canCancel || cancelling) return;
    setCancelling(true);
    try {
      await cancelReservation(reservation.id);
      await refresh();
      // Drop cached availability so this device sees the freed-up slot
      // immediately without waiting for realtime / DB cache TTL.
      if (reservation.restaurant?.id) invalidateAvailabilityCache(reservation.restaurant.id);
      setCancelConfirmOpen(false);
      toast.success("Reservation cancelled.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel reservation.");
    } finally {
      setCancelling(false);
    }
  };

  const handleModify = async () => {
    if (!reservation || !canModify || modifying || !modifyValues || !modifyValidity.canSave) {
      return;
    }

    setModifying(true);
    try {
      await modifyReservation(reservation.id, {
        date: modifyValues.date,
        time: modifyValues.time,
        partySize: modifyValues.partySize,
        specialRequest: modifyValues.notes.trim(),
      });
      await refresh();
      // Drop cached availability so the previous slot reappears and the new
      // slot disappears for this device on the next view.
      if (reservation.restaurant?.id) invalidateAvailabilityCache(reservation.restaurant.id);
      setModifyOpen(false);
      toast.success("Reservation modified.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not modify reservation.");
    } finally {
      setModifying(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/40 bg-background/85 backdrop-blur-xl">
        <div className="flex h-[5.5rem] w-full items-center px-4 sm:px-5">
          <Link to="/" className="flex shrink-0 items-center" aria-label="Cenaiva home">
            <CenaivaWordmark />
          </Link>
          <CustomerNav />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1040px] px-5 py-10 lg:px-8 lg:py-12">
        <button
          type="button"
          onClick={() => navigate("/bookings")}
          className="inline-flex items-center gap-2 text-sm text-text-secondary transition-colors hover:text-white"
        >
          <ArrowLeft className="size-4" />
          Back to bookings
        </button>

        {loading && (
          <div className="mt-8 rounded-3xl border border-border bg-bg-surface/50 p-8 text-sm text-text-muted">
            Loading reservation details...
          </div>
        )}

        {!loading && !reservation && (
          <div className="mt-8 rounded-3xl border border-border bg-bg-surface/50 p-8">
            <p className="font-serif text-3xl text-white">Reservation not found</p>
            <p className="mt-2 text-sm text-text-secondary">
              This booking could not be found for your account.
            </p>
            <Button asChild className="mt-6 h-10 rounded-md font-semibold">
              <Link to="/bookings">View bookings</Link>
            </Button>
          </div>
        )}

        {reservation && reservedAt && status && (
          <div className="mt-8 overflow-hidden rounded-3xl border border-border bg-bg-surface shadow-2xl shadow-black/30">
            <div className="relative flex min-h-[280px] items-end overflow-hidden bg-bg-elevated p-6 sm:p-8">
              {reservation.restaurant?.cover_photo_url ? (
                <img
                  src={reservation.restaurant.cover_photo_url}
                  alt={`${restaurantName} cover`}
                  className="absolute inset-0 size-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-gold/15 via-bg-elevated to-bg-base" />
              )}
              <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/45 to-bg-base" />
              <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-3 py-1 text-xs font-medium",
                      statusClass(status),
                    )}
                  >
                    {t(reservationDisplayStatusKey(status))}
                  </span>
                  <p className="mt-4 font-serif text-5xl leading-tight text-white">
                    {restaurantName}
                  </p>
                  {cuisineLine && (
                    <p className="mt-2 text-sm uppercase tracking-[0.18em] text-text-secondary">
                      {cuisineLine}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-8 p-6 lg:grid-cols-[1fr_280px] lg:p-8">
              <section>
                <h1 className="font-serif text-3xl text-white">Reservation details</h1>
                <p className="mt-2 max-w-2xl text-sm text-text-secondary">
                  This page shows your booking information only. To make a new reservation, use
                  View restaurant.
                </p>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <DetailRow
                    icon={CalendarDays}
                    label="Date"
                    value={new Intl.DateTimeFormat("en-US", {
                      timeZone: reservation.restaurant?.timezone ?? undefined,
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    }).format(reservedAt)}
                  />
                  <DetailRow
                    icon={Clock}
                    label="Time"
                    value={formatCompactTimeLabelInTz(reservedAt, reservation.restaurant?.timezone ?? null)}
                  />
                  <DetailRow
                    icon={Users}
                    label="Guests"
                    value={`${reservation.party_size} guests`}
                  />
                  <DetailRow
                    icon={Tag}
                    label="Confirmation"
                    value={reservation.confirmation_code ?? "Not issued yet"}
                  />
                  {reservation.special_request && (
                    <DetailRow
                      icon={PencilLine}
                      label="Notes"
                      value={reservation.special_request}
                    />
                  )}
                  {reservation.restaurant?.address && (
                    <DetailRow icon={MapPin} label="Address" value={reservation.restaurant.address} />
                  )}
                  {reservation.restaurant?.phone && (
                    <DetailRow icon={Phone} label="Phone" value={reservation.restaurant.phone} />
                  )}
                </div>
              </section>

              <aside className="space-y-3 rounded-2xl border border-border bg-bg-base/40 p-4">
                <Button asChild className="h-11 w-full rounded-md font-semibold">
                  <Link to={`/${reservation.restaurant?.slug ?? ""}`}>View restaurant</Link>
                </Button>
                {canModify && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={openModifyDialog}
                    className="h-11 w-full rounded-md font-medium"
                  >
                    <PencilLine className="size-4" />
                    Modify booking
                  </Button>
                )}
                {reservation.restaurant?.address ? (
                  <Button asChild variant="outline" className="h-11 w-full rounded-md font-medium">
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                        `${reservation.restaurant.address} ${restaurantName}`,
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <MapPin className="size-4" />
                      Directions
                    </a>
                  </Button>
                ) : (
                  <Button disabled variant="outline" className="h-11 w-full rounded-md font-medium">
                    <MapPin className="size-4" />
                    Directions
                  </Button>
                )}
                {reservation.restaurant?.phone ? (
                  <Button asChild variant="outline" className="h-11 w-full rounded-md font-medium">
                    <a href={`tel:${reservation.restaurant.phone}`}>
                      <Phone className="size-4" />
                      Call
                    </a>
                  </Button>
                ) : (
                  <Button disabled variant="outline" className="h-11 w-full rounded-md font-medium">
                    <Phone className="size-4" />
                    Call
                  </Button>
                )}
                {canCancel ? (
                  <button
                    type="button"
                    onClick={() => setCancelConfirmOpen(true)}
                    disabled={cancelling}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-danger/50 bg-danger/10 text-sm font-medium text-danger transition-colors hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <X className="size-4" />
                    {cancelling ? "Cancelling..." : "Cancel booking"}
                  </button>
                ) : (
                  <div className="flex items-center gap-2 rounded-md border border-border bg-bg-surface p-3 text-sm text-text-secondary">
                    <CheckCircle2 className="size-4 text-gold" />
                    This booking cannot be cancelled.
                  </div>
                )}
              </aside>
            </div>
          </div>
        )}
      </main>

      <Dialog open={modifyOpen} onOpenChange={setModifyOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Modify booking</DialogTitle>
          </DialogHeader>
          {reservation && modifyInitial ? (
            <ModifyBookingFields
              key={`${reservation.id}-${modifyOpen}`}
              restaurantId={reservation.restaurant?.id ?? ""}
              restaurantTimezone={reservation.restaurant?.timezone ?? null}
              reservationId={reservation.id}
              userProfileId={profile?.id ?? null}
              initial={modifyInitial}
              onChange={setModifyValues}
              onValidityChange={setModifyValidity}
            />
          ) : null}
          {/*
            Card-style CTA mirroring the customer "Reserve a table" pattern.
            The button label encodes the current state — saving, loading,
            blocking reason, no-pick, no-changes, or the dynamic "Confirm
            7:15pm changes" when the new combo is bookable.
          */}
          {(() => {
            const pickedTime = modifyValues?.time
              ? formatCompactTimeLabel(modifyValues.time)
              : null;
            const ctaLabel = modifying
              ? "Saving…"
              : modifyValidity.reasonKind === "blocking" && modifyValidity.reason
                ? modifyValidity.reason
                : modifyValidity.reasonKind === "neutral" && modifyValidity.reason
                  ? modifyValidity.reason
                  : modifyValidity.canSave && pickedTime
                    ? `Confirm ${pickedTime} changes`
                    : "Pick new details to continue";
            return (
              <div className="mt-2 space-y-2">
                <Button
                  type="button"
                  onClick={() => void handleModify()}
                  disabled={modifying || !modifyValidity.canSave}
                  className="h-14 w-full rounded-xl text-base font-semibold"
                >
                  {ctaLabel}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setModifyOpen(false)}
                  disabled={modifying}
                  className="h-9 w-full text-sm font-normal text-text-muted hover:text-text-primary"
                >
                  Keep current booking
                </Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={cancelConfirmOpen} onOpenChange={(open) => !cancelling && setCancelConfirmOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel this reservation?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-secondary">
            The restaurant will be notified and your table will be released. This can't be undone.
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCancelConfirmOpen(false)}
              disabled={cancelling}
            >
              Keep booking
            </Button>
            <Button
              type="button"
              onClick={() => void handleCancel()}
              disabled={cancelling}
              className="bg-danger text-white hover:bg-danger/90"
            >
              {cancelling ? "Cancelling..." : "Cancel booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
