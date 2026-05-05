import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { format } from "date-fns";
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
import { CustomerNav } from "@/components/customer/CustomerNav";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMyReservations, type MyReservationRow } from "@/hooks/useMyReservations";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { formatCompactTimeLabel } from "@/lib/utils/time";

type ReservationStatus = "confirmed" | "pending" | "completed" | "cancelled";

function statusFor(row: MyReservationRow): ReservationStatus {
  if (row.status === "cancelled") return "cancelled";
  if (row.status === "pending") return "pending";
  return new Date(row.reserved_at).getTime() < Date.now() ? "completed" : "confirmed";
}

function statusLabel(status: ReservationStatus): string {
  const labels: Record<ReservationStatus, string> = {
    confirmed: "Confirmed",
    pending: "Pending",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  return labels[status];
}

function statusClass(status: ReservationStatus): string {
  const classes: Record<ReservationStatus, string> = {
    confirmed: "border-success/30 bg-success/10 text-success",
    pending: "border-warning/30 bg-warning/10 text-warning",
    completed: "border-border bg-bg-elevated text-text-secondary",
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

  const client = getSupabaseBrowserClient();
  const { error, data } = await client.functions.invoke<{ ok?: boolean; error?: string }>(
    "cancel-reservation",
    {
      body: { reservation_id: reservationId },
    },
  );

  if (error || data?.error || data?.ok !== true) {
    throw new Error(data?.error ?? error?.message ?? "Could not cancel reservation.");
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

  const client = getSupabaseBrowserClient();
  const { error, data } = await client.functions.invoke<{ ok?: boolean; error?: string }>(
    "modify-reservation",
    {
      body: {
        reservation_id: reservationId,
        date: payload.date,
        time: payload.time,
        party_size: payload.partySize,
        special_request: payload.specialRequest,
      },
    },
  );

  if (error || data?.error || data?.ok !== true) {
    throw new Error(data?.error ?? error?.message ?? "Could not modify reservation.");
  }
}

export default function BookingDetailsPage() {
  const navigate = useNavigate();
  const { reservationId } = useParams<{ reservationId: string }>();
  const [searchParams] = useSearchParams();
  const { upcoming, past, loading, refresh } = useMyReservations();
  const [cancelling, setCancelling] = useState(false);
  const [modifyOpen, setModifyOpen] = useState(false);
  const [modifying, setModifying] = useState(false);
  const [modifyDate, setModifyDate] = useState("");
  const [modifyTime, setModifyTime] = useState("");
  const [modifyPartySize, setModifyPartySize] = useState("2");
  const [modifyNotes, setModifyNotes] = useState("");

  const reservation = useMemo(() => {
    return [...upcoming, ...past].find((row) => row.id === reservationId) ?? null;
  }, [past, reservationId, upcoming]);

  const status = reservation ? statusFor(reservation) : null;
  const reservedAt = useMemo(
    () => reservation ? new Date(reservation.reserved_at) : null,
    [reservation],
  );
  const canCancel = Boolean(reservation && status !== "cancelled" && status !== "completed");
  const canModify = canCancel;
  const restaurantName = reservation?.restaurant?.name ?? "Restaurant";
  const cuisineLine = [reservation?.restaurant?.cuisine_type, reservation?.restaurant?.city]
    .filter(Boolean)
    .join(" · ");

  const openModifyDialog = () => {
    if (!reservation || !reservedAt || !canModify) return;
    setModifyDate(format(reservedAt, "yyyy-MM-dd"));
    setModifyTime(format(reservedAt, "HH:mm"));
    setModifyPartySize(String(reservation.party_size));
    setModifyNotes(reservation.special_request ?? "");
    setModifyOpen(true);
  };

  useEffect(() => {
    if (searchParams.get("modify") !== "1" || modifyOpen || !reservation || !reservedAt || !canModify) {
      return;
    }
    void Promise.resolve().then(() => {
      setModifyDate(format(reservedAt, "yyyy-MM-dd"));
      setModifyTime(format(reservedAt, "HH:mm"));
      setModifyPartySize(String(reservation.party_size));
      setModifyNotes(reservation.special_request ?? "");
      setModifyOpen(true);
    });
  }, [canModify, modifyOpen, reservation, reservedAt, searchParams]);

  const handleCancel = async () => {
    if (!reservation || !canCancel || cancelling) return;
    setCancelling(true);
    try {
      await cancelReservation(reservation.id);
      await refresh();
      toast.success("Reservation cancelled.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel reservation.");
    } finally {
      setCancelling(false);
    }
  };

  const handleModify = async () => {
    if (!reservation || !canModify || modifying) return;
    const nextPartySize = Math.max(1, Math.floor(Number(modifyPartySize)));
    if (!modifyDate || !modifyTime || !Number.isFinite(nextPartySize)) {
      toast.error("Select a date, time, and guest count.");
      return;
    }

    setModifying(true);
    try {
      await modifyReservation(reservation.id, {
        date: modifyDate,
        time: modifyTime,
        partySize: nextPartySize,
        specialRequest: modifyNotes.trim(),
      });
      await refresh();
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
        <div className="mx-auto flex h-16 w-full max-w-[1320px] items-center px-5 lg:px-8">
          <Link to="/" className="flex shrink-0 items-center gap-2" aria-label="Cenaiva home">
            <span className="flex size-7 items-center justify-center rounded-md bg-gold/15">
              <span className="block size-2.5 rounded-sm bg-gold" />
            </span>
            <span className="font-serif text-xl font-semibold tracking-tight text-white">
              Cenaiva
            </span>
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
                    {statusLabel(status)}
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
                    value={format(reservedAt, "EEEE, MMMM d, yyyy")}
                  />
                  <DetailRow
                    icon={Clock}
                    label="Time"
                    value={formatCompactTimeLabel(reservedAt)}
                  />
                  <DetailRow
                    icon={Users}
                    label="Guests"
                    value={`${reservation.party_size} guests`}
                  />
                  <DetailRow
                    icon={Tag}
                    label="Confirmation"
                    value={reservation.confirmation_code ?? "Pending"}
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
                    onClick={() => void handleCancel()}
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
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="modify-date">Date</Label>
                <Input
                  id="modify-date"
                  type="date"
                  value={modifyDate}
                  onChange={(event) => setModifyDate(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="modify-time">Time</Label>
                <Input
                  id="modify-time"
                  type="time"
                  step="1800"
                  value={modifyTime}
                  onChange={(event) => setModifyTime(event.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="modify-party-size">Guests</Label>
              <Input
                id="modify-party-size"
                type="number"
                min="1"
                max="99"
                value={modifyPartySize}
                onChange={(event) => setModifyPartySize(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="modify-notes">Special request / notes</Label>
              <Textarea
                id="modify-notes"
                value={modifyNotes}
                onChange={(event) => setModifyNotes(event.target.value)}
                placeholder="Allergies, occasion, seating notes..."
              />
            </div>
            <p className="text-xs text-text-muted">
              Changes save only if the new date, time, and guest count are available.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setModifyOpen(false)}>
              Keep current booking
            </Button>
            <Button type="button" onClick={() => void handleModify()} disabled={modifying}>
              {modifying ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
