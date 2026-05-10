import { useEffect, useMemo, useState } from "react";

import { AvailabilityPanel } from "@/components/booking/AvailabilityPanel";
import {
  type AvailabilitySlot,
  useAvailability,
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

/**
 * Modify dialog wrapper around `<AvailabilityPanel>`. Owns the notes textarea
 * and the validity contract the parent uses to gate its Save button. The panel
 * itself handles date / time / party / slot selection + diner-conflict UX.
 *
 * Validity rules:
 *   - Pick-a-slot phase → neutral "Pick a time from the list"
 *   - Picked slot but matches the current reservation → neutral "No changes
 *     to save"
 *   - Picked slot AND something differs from `initial` → canSave=true
 *
 * The picked slot represents a known-bookable time (it came from a fresh
 * `get_available_slots_cached` call), so we don't re-validate at the field
 * level — `book_reservation` is the source of truth.
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
  const [pickedSlot, setPickedSlot] = useState<AvailabilitySlot | null>(null);

  // Pull floor capacity to cap the party-size picker.
  const { floorCapacity } = useAvailability();
  const maxPartySize = Math.max(1, floorCapacity ?? 200);

  // Mirror local state up to the parent on every change.
  useEffect(() => {
    onChange({ date, time, partySize, notes });
  }, [date, time, partySize, notes, onChange]);

  const hasChange = useMemo(() => {
    if (notes !== initial.notes) return true;
    if (date !== initial.date) return true;
    if (partySize !== initial.partySize) return true;
    if (time && formatCompactTimeLabel(time) !== formatCompactTimeLabel(initial.time)) return true;
    return false;
  }, [date, time, partySize, notes, initial]);

  // Derive validity. Picked slots come from a live RPC fetch so we trust them
  // without re-validating; book_reservation is still the authoritative gate.
  useEffect(() => {
    let next: ModifyBookingValidity;
    if (!date) {
      next = { canSave: false, reason: "Pick a date.", reasonKind: "neutral" };
    } else if (!time || !pickedSlot) {
      next = { canSave: false, reason: "Pick a time from the list.", reasonKind: "neutral" };
    } else if (partySize > maxPartySize) {
      next = {
        canSave: false,
        reason: `Party size exceeds capacity (${maxPartySize}).`,
        reasonKind: "blocking",
      };
    } else if (!hasChange) {
      next = { canSave: false, reason: "No changes to save.", reasonKind: "neutral" };
    } else {
      next = { canSave: true, reason: null, reasonKind: null };
    }
    onValidityChange(next);
  }, [date, time, partySize, pickedSlot, hasChange, maxPartySize, onValidityChange]);

  return (
    <div className="space-y-4">
      <AvailabilityPanel
        restaurantId={restaurantId}
        restaurantTimezone={restaurantTimezone || "America/Toronto"}
        userProfileId={userProfileId}
        excludeReservationId={reservationId}
        initialDate={initial.date}
        initialTime={initial.time}
        initialPartySize={initial.partySize}
        selectedSlotIso={pickedSlot?.date_time ?? null}
        maxPartySize={maxPartySize}
        onStateChange={({ date: nextDate, partySize: nextParty }) => {
          if (nextDate && nextDate !== date) setDate(nextDate);
          if (nextParty !== partySize) setPartySize(nextParty);
        }}
        onSelectSlot={(slot) => {
          setPickedSlot(slot);
          setTime(slot.display_time);
        }}
      />

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
    </div>
  );
}
