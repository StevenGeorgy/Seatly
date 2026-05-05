import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  History,
  Phone,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { fetchAvailabilitySlots, type AvailabilitySlot } from "@/hooks/useAvailability";
import { useReservations, type ReservationRow } from "@/hooks/useReservations";
import { useStaffAuditEvents, type StaffAuditEventRow } from "@/hooks/useStaffAuditEvents";
import { useUser } from "@/hooks/useUser";
import { cn } from "@/lib/utils";
import { formatCompactTimeLabel } from "@/lib/utils/time";

function todayDateValue(): string {
  return format(new Date(), "yyyy-MM-dd");
}

function parseDateTime(date: string, isoOrTime: string): Date {
  const parsed = isoOrTime.includes("T") ? new Date(isoOrTime) : new Date(`${date}T${isoOrTime}`);
  return Number.isNaN(parsed.getTime()) ? new Date(`${date}T12:00:00`) : parsed;
}

function formatEventActor(event: StaffAuditEventRow): string {
  return event.actor_profile?.full_name ?? event.actor_profile?.email ?? event.actor_role ?? "Staff";
}

function formatAuditDetails(event: StaffAuditEventRow): string {
  const details = event.after_json ?? {};
  const parts = [
    typeof details.guest_name === "string" ? details.guest_name : null,
    typeof details.party_size === "number" ? `${details.party_size} guests` : null,
    typeof details.reserved_at === "string" ? formatCompactTimeLabel(new Date(details.reserved_at)) : null,
  ].filter(Boolean);
  return parts.join(" · ") || event.entity_id || "Reservation action";
}

function currentReservationRows(reservations: ReservationRow[], date: string) {
  return reservations
    .filter((reservation) => reservation.reserved_at.slice(0, 10) === date || format(new Date(reservation.reserved_at), "yyyy-MM-dd") === date)
    .sort((a, b) => new Date(a.reserved_at).getTime() - new Date(b.reserved_at).getTime());
}

export default function HostViewPage() {
  const { selectedRestaurantId } = useRestaurantScope();
  const { rolesAtRestaurant } = useUser();
  const [searchParams] = useSearchParams();
  const initialDate = searchParams.get("date") ?? todayDateValue();
  const initialPartySize = searchParams.get("partySize") ?? "2";
  const initialTime = searchParams.get("time");
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [partySize, setPartySize] = useState(initialPartySize);
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const filters = useMemo(() => ({ date: selectedDate }), [selectedDate]);
  const { reservations, loading: reservationsLoading, createReservation, refetch } = useReservations(filters);
  const { events, loading: historyLoading, refetch: refetchHistory } = useStaffAuditEvents(80);
  const scopedRoles = selectedRestaurantId ? rolesAtRestaurant(selectedRestaurantId) : [];
  const canViewHistory = scopedRoles.some((role) => role.role === "owner" || role.role === "manager");
  const currentRows = useMemo(() => currentReservationRows(reservations, selectedDate), [reservations, selectedDate]);
  const parsedPartySize = Math.max(1, Math.floor(Number(partySize)) || 1);

  const loadAvailability = async () => {
    if (!selectedRestaurantId) {
      toast.error("Select a restaurant first.");
      return;
    }
    setAvailabilityLoading(true);
    setSelectedSlot(null);
    try {
      const result = await fetchAvailabilitySlots(selectedRestaurantId, selectedDate, parsedPartySize);
      if (result.error) {
        toast.error(result.error);
        setAvailability([]);
      } else {
        setAvailability(result.slots);
        if (initialTime) {
          setSelectedSlot(result.slots.find((slot) => slot.date_time === initialTime) ?? null);
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load availability.");
      setAvailability([]);
    } finally {
      setAvailabilityLoading(false);
    }
  };

  useEffect(() => {
    if (!initialTime || !selectedRestaurantId) return;
    void loadAvailability();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const createHostReservation = async () => {
    if (!selectedSlot) {
      toast.error("Select an available time.");
      return;
    }
    if (!guestName.trim()) {
      toast.error("Guest name is required.");
      return;
    }
    setSaving(true);
    try {
      const reservationId = await createReservation({
        guest_name: guestName.trim(),
        guest_email: guestEmail.trim(),
        guest_phone: guestPhone.trim(),
        party_size: parsedPartySize,
        reserved_at: selectedSlot.date_time,
        availability_slot: selectedSlot,
        special_request: notes.trim(),
      });
      await Promise.all([refetch(), refetchHistory()]);
      setGuestName("");
      setGuestEmail("");
      setGuestPhone("");
      setNotes("");
      setSelectedSlot(null);
      toast.success(reservationId ? `Host booking created (${reservationId.slice(0, 8)}).` : "Host booking created.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create booking.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatedPage className="h-full overflow-y-auto px-5 py-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-border/50 pb-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-gold">
              Host operations
            </p>
            <h1 className="mt-2 font-serif text-5xl leading-none text-white">Host View</h1>
            <p className="mt-3 max-w-2xl text-sm text-text-secondary">
              Check availability by date and party size, then book the guest into the live reservation system.
            </p>
          </div>
          {canViewHistory && (
            <Button type="button" variant="outline" onClick={() => setHistoryOpen(true)}>
              <History className="size-4" />
              History
            </Button>
          )}
        </header>

        <section className="grid gap-4 rounded-2xl border border-border bg-bg-surface/70 p-4 lg:grid-cols-[1fr_1fr_auto]">
          <div className="grid gap-2">
            <Label htmlFor="host-date">Date</Label>
            <Input id="host-date" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="host-party">Guests</Label>
            <Input id="host-party" type="number" min="1" max="99" value={partySize} onChange={(event) => setPartySize(event.target.value)} />
          </div>
          <Button type="button" className="self-end" onClick={() => void loadAvailability()} disabled={availabilityLoading}>
            {availabilityLoading ? <RefreshCw className="size-4 animate-spin" /> : <Search className="size-4" />}
            Check availability
          </Button>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="rounded-2xl border border-border bg-bg-surface/70 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-serif text-2xl text-white">Available timeline</h2>
                <p className="mt-1 text-xs text-text-muted">
                  {availability.length > 0 ? `${availability.length} available times` : "Choose a date and party size to begin."}
                </p>
              </div>
              <span className="rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs text-gold">
                Party of {parsedPartySize}
              </span>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {availability.map((slot) => (
                <button
                  key={`${slot.shift_id}-${slot.date_time}`}
                  type="button"
                  onClick={() => setSelectedSlot(slot)}
                  className={cn(
                    "rounded-2xl border p-4 text-left transition-colors",
                    selectedSlot?.date_time === slot.date_time
                      ? "border-gold bg-gold/10"
                      : "border-border bg-bg-base/40 hover:border-gold/40",
                  )}
                >
                  <p className="font-serif text-2xl text-white">{slot.display_time}</p>
                  <p className="mt-1 text-xs text-text-muted">{slot.shift_name}</p>
                  <p className="mt-3 text-xs text-text-secondary">
                    {slot.table_ids?.length ?? 0} table{(slot.table_ids?.length ?? 0) === 1 ? "" : "s"} available for assignment
                  </p>
                </button>
              ))}
              {!availabilityLoading && availability.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border p-8 text-sm text-text-muted sm:col-span-2 lg:col-span-3">
                  No availability loaded yet.
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-border bg-bg-surface/70 p-5">
              <h2 className="font-serif text-2xl text-white">Create booking</h2>
              <p className="mt-1 text-xs text-text-muted">
                {selectedSlot ? `Selected ${selectedSlot.display_time}` : "Select an available time first."}
              </p>
              <div className="mt-5 grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="host-guest">Guest name</Label>
                  <Input id="host-guest" value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Jane Smith" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="host-phone">Phone</Label>
                  <Input id="host-phone" value={guestPhone} onChange={(event) => setGuestPhone(event.target.value)} placeholder="+1 555 000 0000" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="host-email">Email</Label>
                  <Input id="host-email" type="email" value={guestEmail} onChange={(event) => setGuestEmail(event.target.value)} placeholder="guest@example.com" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="host-notes">Notes</Label>
                  <Textarea id="host-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Allergies, occasion, seating notes..." />
                </div>
                <Button type="button" onClick={() => void createHostReservation()} disabled={saving || !selectedSlot}>
                  {saving ? "Booking..." : "Book selected time"}
                </Button>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-bg-surface/70 p-5">
              <h2 className="font-serif text-2xl text-white">Current day</h2>
              <div className="mt-4 space-y-3">
                {reservationsLoading ? (
                  <p className="text-sm text-text-muted">Loading reservations...</p>
                ) : currentRows.length === 0 ? (
                  <p className="text-sm text-text-muted">No reservations for this day.</p>
                ) : (
                  currentRows.slice(0, 8).map((reservation) => {
                    const reservedAt = parseDateTime(selectedDate, reservation.reserved_at);
                    return (
                      <div key={reservation.id} className="rounded-xl border border-border bg-bg-base/40 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-white">{reservation.guests?.full_name ?? reservation.guest_full_name ?? "Guest"}</p>
                          <span className="font-mono text-xs text-gold">{formatCompactTimeLabel(reservedAt)}</span>
                        </div>
                        <p className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                          <Users className="size-3.5" />
                          {reservation.party_size} guests
                          {reservation.guest_phone || reservation.guests?.phone ? (
                            <>
                              <Phone className="ml-2 size-3.5" />
                              {reservation.guest_phone ?? reservation.guests?.phone}
                            </>
                          ) : null}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Host history</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            {historyLoading ? (
              <p className="text-sm text-text-muted">Loading history...</p>
            ) : events.length === 0 ? (
              <p className="text-sm text-text-muted">No host actions recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {events.map((event) => (
                  <div key={event.id} className="rounded-xl border border-border bg-bg-surface p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-white">{formatEventActor(event)}</p>
                        <p className="mt-1 text-xs text-text-muted">{event.action.replace(/\./g, " ")}</p>
                      </div>
                      <span className="text-xs text-text-muted">
                        {format(new Date(event.created_at), "MMM d, h:mm a")}
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-text-secondary">{formatAuditDetails(event)}</p>
                    {event.entity_id && (
                      <p className="mt-1 font-mono text-[11px] text-text-muted">{event.entity_id}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}
