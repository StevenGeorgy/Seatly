export type ReservationDisplayStatus = "upcoming" | "current" | "past" | "cancelled";

export type ReservationDisplayStatusInput = {
  status?: string | null;
  reserved_at?: string | null;
  duration_minutes?: number | null;
};

export const DEFAULT_RESERVATION_TURN_TIME_MINUTES = 90;

export function reservationDisplayStatus(
  reservation: ReservationDisplayStatusInput,
  now: Date = new Date(),
  fallbackTurnMinutes = DEFAULT_RESERVATION_TURN_TIME_MINUTES,
): ReservationDisplayStatus {
  if (reservation.status === "cancelled") return "cancelled";

  const reservedAt = reservation.reserved_at ? new Date(reservation.reserved_at) : null;
  if (!reservedAt || Number.isNaN(reservedAt.getTime())) return "upcoming";

  const fallbackDuration = Number.isFinite(fallbackTurnMinutes) && fallbackTurnMinutes > 0
    ? fallbackTurnMinutes
    : DEFAULT_RESERVATION_TURN_TIME_MINUTES;
  const durationMinutes =
    typeof reservation.duration_minutes === "number" && Number.isFinite(reservation.duration_minutes) && reservation.duration_minutes > 0
      ? reservation.duration_minutes
      : fallbackDuration;
  const serviceEnd = new Date(reservedAt.getTime() + durationMinutes * 60_000);

  if (now < reservedAt) return "upcoming";
  if (now <= serviceEnd) return "current";
  return "past";
}

export function reservationDisplayStatusKey(status: ReservationDisplayStatus): `dashboard.reservations.${ReservationDisplayStatus}` {
  return `dashboard.reservations.${status}`;
}
