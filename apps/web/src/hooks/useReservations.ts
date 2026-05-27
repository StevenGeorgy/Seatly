import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import type { AvailabilitySlot } from "@/hooks/useAvailability";
import { useUser } from "@/hooks/useUser";
import { toUserFacingEdgeError, toUserFacingError } from "@/lib/errors";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { matchesReservationSearch } from "@/lib/reservations/search";
import { localDayBoundsUtcIso } from "@/lib/utils/time";

/**
 * Typed error thrown when the 2026-05-27 seat/no-show time-window guard
 * blocks the action. Pages catch this to surface a force-confirm prompt
 * (owner/manager can override per `restaurants_seat_window_guard`).
 */
export type SeatingWindowErrorCode =
  | "outside_seating_window"
  | "force_requires_owner_or_manager";

export class SeatingWindowError extends Error {
  readonly code: SeatingWindowErrorCode;
  readonly reservedAt: string | null;
  constructor(code: SeatingWindowErrorCode, message: string, reservedAt: string | null = null) {
    super(message);
    this.name = "SeatingWindowError";
    this.code = code;
    this.reservedAt = reservedAt;
  }
}

function mapSeatingWindowError(
  rpcError: { code?: string | null; message?: string | null } | null | undefined,
  reservedAt: string | null,
): SeatingWindowError | null {
  if (!rpcError) return null;
  const code = (rpcError.code ?? "").toString();
  const message = (rpcError.message ?? "").toString();
  if (code === "P0020" || message.includes("outside_seating_window")) {
    return new SeatingWindowError(
      "outside_seating_window",
      "This reservation is outside the normal seating window (1 hour before to 24 hours after).",
      reservedAt,
    );
  }
  if (code === "P0021" || message.includes("force_requires_owner_or_manager")) {
    return new SeatingWindowError(
      "force_requires_owner_or_manager",
      "Only owners or managers can override the seating window.",
      reservedAt,
    );
  }
  return null;
}

async function fireNoShowNotification(
  reservationId: string,
  accessToken: string | null,
): Promise<void> {
  try {
    const res = await fetch(
      `${getSupabaseProjectUrl()}/functions/v1/notify-no-show`,
      {
        method: "POST",
        headers: {
          apikey: getSupabaseAnonKey(),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reservation_id: reservationId }),
      },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      console.error(
        "[useReservations.notifyNoShow]",
        res.status,
        body?.error ?? "non-ok",
      );
    }
  } catch (err) {
    console.error("[useReservations.notifyNoShow] network", err);
  }
}

type RefundOutcome = {
  payment_id: string;
  status: "refunded" | "already_refunded" | "failed" | "stub_refunded";
  error?: string;
};

type RefundDepositResponse = {
  ok?: boolean;
  refunded_count?: number;
  outcomes?: RefundOutcome[];
  error?: string;
};

async function fireDepositRefundOnArrival(
  reservationId: string,
  accessToken: string | null,
): Promise<{ refundedCount: number; hadFailure: boolean }> {
  try {
    const res = await fetch(
      `${getSupabaseProjectUrl()}/functions/v1/refund-deposit-on-arrival`,
      {
        method: "POST",
        headers: {
          apikey: getSupabaseAnonKey(),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reservation_id: reservationId, source: "owner" }),
      },
    );
    const body = (await res.json().catch(() => ({}))) as RefundDepositResponse;
    if (!res.ok || body.error || body.ok !== true) {
      const friendly = toUserFacingEdgeError(res, body);
      console.error("[useReservations.refundOnArrival]", friendly.code, friendly.technical ?? body, "RAW_BODY", JSON.stringify(body), "STATUS", res.status);
      return { refundedCount: 0, hadFailure: true };
    }
    const refundedCount = typeof body.refunded_count === "number" ? body.refunded_count : 0;
    const hadFailure = (body.outcomes ?? []).some((o) => o.status === "failed");
    return { refundedCount, hadFailure };
  } catch (err) {
    console.error("[useReservations.refundOnArrival] network", err);
    return { refundedCount: 0, hadFailure: true };
  }
}

export type ReservationEventRef = {
  id: string;
  name: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  capacity: number | null;
  tickets_sold: number;
  is_active: boolean;
};

export type ReservationPromotionRef = {
  id: string;
  title: string;
  promo_code: string | null;
  promo_type: string | null;
  discount_value: number | null;
  discount_unit: string | null;
  badge_color: string | null;
  is_active: boolean;
};

export type ReservationRow = {
  id: string;
  restaurant_id: string;
  guest_id: string | null;
  table_id: string | null;
  shift_id: string | null;
  party_size: number;
  reserved_at: string;
  duration_minutes: number | null;
  status: string;
  source: string | null;
  confirmation_code: string | null;
  special_request: string | null;
  occasion: string | null;
  dietary_notes: string | null;
  internal_notes: string | null;
  no_show_risk_score: number | null;
  waiter_id: string | null;
  deposit_amount: number | null;
  deposit_amount_cents?: number | null;
  deposit_status: string | null;
  is_guest_checkout: boolean;
  guest_email: string | null;
  guest_phone: string | null;
  guest_full_name: string | null;
  confirmed_at: string | null;
  checked_in_at: string | null;
  seated_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string | null;
  updated_at?: string | null;
  event_id: string | null;
  promotion_id: string | null;
  applied_promo_code: string | null;
  guests?: { full_name: string | null; email: string | null; phone: string | null } | null;
  event?: ReservationEventRef | null;
  promotion?: ReservationPromotionRef | null;
  reservation_tables?: Array<{
    table_id: string;
    is_primary: boolean;
    released_at: string | null;
    tables: {
      id: string;
      table_number: string | null;
      label: string | null;
      section: string | null;
      capacity: number;
    } | null;
  }> | null;
  tables?: {
    id: string;
    table_number: string | null;
    label: string | null;
    section: string | null;
    capacity: number;
  } | null;
};

export type ReservationFilters = {
  status?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  /**
   * IANA timezone the date filters should be interpreted in. Defaults to
   * UTC if omitted — but for restaurant-facing views always pass the
   * restaurant's timezone, otherwise late-night bookings spill onto the
   * next day's view (Sat 22:45 Toronto = Sun 02:45 UTC).
   */
  timezone?: string | null;
};

export function useReservations(filters?: ReservationFilters) {
  const { selectedRestaurantId } = useRestaurantScope();
  const { loading: authLoading, session } = useUser();
  const sessionAccessToken = session?.access_token ?? null;
  const filterStatus = filters?.status;
  const filterDate = filters?.date;
  const filterDateFrom = filters?.dateFrom;
  const filterDateTo = filters?.dateTo;
  const filterSearch = filters?.search;
  const filterTimezone = filters?.timezone ?? null;
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const requestSeqRef = useRef(0);

  const fetchReservations = useCallback(async () => {
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;

    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!sessionAccessToken || !selectedRestaurantId || !isSupabaseConfigured()) {
      setReservations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();

    let query = client
      .from("reservations")
      .select(
        "*, guests(full_name, email, phone), tables(id, table_number, label, section, capacity), reservation_tables(table_id, is_primary, released_at, tables(id, table_number, label, section, capacity)), event:events(id, name, date, start_time, end_time, capacity, tickets_sold, is_active), promotion:promotions(id, title, promo_code, promo_type, discount_value, discount_unit, badge_color, is_active)",
      )
      .eq("restaurant_id", selectedRestaurantId)
      .order("reserved_at", { ascending: true });

    if (filterStatus && filterStatus !== "all") {
      query = query.eq("status", filterStatus);
    } else {
      // Keep cancellations and completed bookings visible so staff can distinguish Cancelled and Past.
      query = query.not("status", "eq", "no_show");
    }

    if (filterDateFrom || filterDateTo) {
      const startBounds = filterDateFrom ? localDayBoundsUtcIso(filterDateFrom, filterTimezone) : null;
      const endBounds = filterDateTo ? localDayBoundsUtcIso(filterDateTo, filterTimezone) : null;
      if (startBounds) query = query.gte("reserved_at", startBounds.startIso);
      if (endBounds) query = query.lte("reserved_at", endBounds.endIso);
    } else if (filterDate) {
      const bounds = localDayBoundsUtcIso(filterDate, filterTimezone);
      if (bounds) {
        query = query.gte("reserved_at", bounds.startIso).lte("reserved_at", bounds.endIso);
      }
    }

    const { data, error: qErr } = await query;

    if (requestSeqRef.current !== requestSeq) {
      return;
    }

    if (qErr) {
      const friendly = toUserFacingError(qErr, "Couldn't load reservations.");
      setError(new Error(friendly.message));
      console.error("[useReservations.fetch]", friendly.code, friendly.technical ?? qErr);
      setReservations([]);
    } else {
      let rows = ((data ?? []) as ReservationRow[]).map((reservation) => {
        const assignments = reservation.reservation_tables ?? [];
        const activeAssignments = assignments.filter((assignment) => assignment.tables && assignment.released_at === null);
        return {
          ...reservation,
          reservation_tables: activeAssignments,
        };
      });
      if (filterSearch) {
        rows = rows.filter(
          (r) =>
            matchesReservationSearch(filterSearch, [
              r.guests?.full_name,
              r.guest_full_name,
              r.guest_phone,
              r.guest_email,
              r.guests?.phone,
              r.guests?.email,
              r.tables?.label,
              r.tables?.table_number,
              r.confirmation_code,
              ...(r.reservation_tables?.flatMap((assignment) => [
                assignment.tables?.label,
                assignment.tables?.table_number,
              ]) ?? []),
            ]),
        );
      }
      setReservations(rows);
    }
    setLoading(false);
  }, [
    authLoading,
    sessionAccessToken,
    selectedRestaurantId,
    filterStatus,
    filterDate,
    filterDateFrom,
    filterDateTo,
    filterSearch,
    filterTimezone,
  ]);

  useEffect(() => {
    void Promise.resolve().then(() => fetchReservations());
  }, [fetchReservations]);

  useEffect(() => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) return;

    const client = getSupabaseBrowserClient();
    const channel = client
      .channel(`reservations:${selectedRestaurantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reservations",
          filter: `restaurant_id=eq.${selectedRestaurantId}`,
        },
        () => { void fetchReservations(); },
      )
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, [selectedRestaurantId, fetchReservations]);

  const updateStatus = async (
    id: string,
    status: string,
    approvalToken?: string,
    opts?: { force?: boolean },
  ) => {
    if (!isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();

    // Phase 6 of diner auth overhaul (2026-05-15): owner-initiated
    // cancels MUST refund any paid pre-orders + charged deposits.
    // Route through cancel-reservation edge fn (actor=owner) which
    // owns the refund logic and skips the 24h cliff. Other status
    // transitions (seated, completed, no_show, etc.) keep using the
    // staff RPC.
    if (status === "cancelled") {
      const { data: sessionData } = await client.auth.getSession();
      const token = sessionData.session?.access_token ?? null;
      const res = await fetch(
        `${getSupabaseProjectUrl()}/functions/v1/cancel-reservation`,
        {
          method: "POST",
          headers: {
            apikey: getSupabaseAnonKey(),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reservation_id: id, actor: "owner" }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || body.error || body.ok !== true) {
        const friendly = toUserFacingEdgeError(res, body);
        console.error("[useReservations.cancel]", friendly.code, friendly.technical ?? body);
        throw new Error(friendly.message);
      }
      void fetchReservations();
      return;
    }

    // Look up reserved_at so we can return it on the window-guard error
    // — the UI uses it to phrase "X hours before/after" in the prompt.
    const existing = reservations.find((r) => r.id === id);
    const reservedAt = existing?.reserved_at ?? null;

    const { error: statusError } = await client.rpc("update_staff_reservation_status", {
      p_reservation_id: id,
      p_status: status,
      p_approval_token: approvalToken ?? null,
      p_force: opts?.force ?? false,
    });
    if (statusError) {
      const windowError = mapSeatingWindowError(statusError, reservedAt);
      if (windowError) {
        console.warn("[useReservations.updateStatus]", windowError.code, statusError);
        throw windowError;
      }
      const friendly = toUserFacingError(statusError, "Couldn't update reservation status.");
      console.error("[useReservations.updateStatus]", friendly.code, friendly.technical ?? statusError);
      throw new Error(friendly.message);
    }

    // Fire the no-show notification fire-and-forget after a successful flip.
    // Failures are logged but don't unwind the status change.
    if (status === "no_show") {
      const { data: sessionData } = await client.auth.getSession();
      const token = sessionData.session?.access_token ?? null;
      void fireNoShowNotification(id, token);
    }

    void fetchReservations();
  };

  const seatReservation = async (
    reservationId: string,
    tableId: string,
    partySize: number,
    opts?: { force?: boolean },
  ) => {
    if (!isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    const existing = reservations.find((r) => r.id === reservationId);
    const reservedAt = existing?.reserved_at ?? null;
    const { error: seatError } = await client.rpc("seat_staff_reservation", {
      p_reservation_id: reservationId,
      p_table_id: tableId,
      p_force: opts?.force ?? false,
    });
    if (seatError) {
      const windowError = mapSeatingWindowError(seatError, reservedAt);
      if (windowError) {
        console.warn("[useReservations.seat]", windowError.code, seatError);
        throw windowError;
      }
      const friendly = toUserFacingError(seatError, "Couldn't seat the reservation.");
      console.error("[useReservations.seat]", friendly.code, friendly.technical ?? seatError);
      throw new Error(friendly.message);
    }
    void partySize;

    // After seating succeeds, fire the deposit refund. Failures here do NOT
    // unwind the seat action — surface a toast warning instead so the host
    // sees something is off but the floor flow keeps moving.
    const { data: sessionData } = await client.auth.getSession();
    const token = sessionData.session?.access_token ?? null;
    const { refundedCount, hadFailure } = await fireDepositRefundOnArrival(reservationId, token);
    if (hadFailure) {
      toast.warning("Seated, but the deposit refund couldn't be completed. Check the reservation.");
    } else if (refundedCount > 0) {
      toast.success("Seated. Deposit refunded.");
    } else {
      toast.success("Seated.");
    }

    void fetchReservations();
  };

  const markArrivedFromNoShow = async (reservationId: string) => {
    await updateStatus(reservationId, "completed");

    if (!isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    const { data: sessionData } = await client.auth.getSession();
    const token = sessionData.session?.access_token ?? null;
    const { refundedCount, hadFailure } = await fireDepositRefundOnArrival(reservationId, token);
    if (hadFailure) {
      toast.warning("Marked as arrived, but the deposit refund couldn't be completed.");
    } else if (refundedCount > 0) {
      toast.success("Marked as arrived. Deposit refunded.");
    } else {
      toast.success("Marked as arrived.");
    }
  };

  const createReservation = async (payload: {
    guest_name: string;
    guest_email: string;
    guest_phone: string;
    party_size: number;
    reserved_at: string;
    table_id?: string | null;
    availability_slot?: AvailabilitySlot | null;
    special_request?: string;
  }): Promise<string | null> => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) return null;
    const client = getSupabaseBrowserClient();
    const { data, error: reservationError } = await client.rpc("create_staff_reservation", {
      p_restaurant_id: selectedRestaurantId,
      p_guest_name: payload.guest_name,
      p_guest_email: payload.guest_email || null,
      p_guest_phone: payload.guest_phone || null,
      p_party_size: payload.party_size,
      p_reserved_at: payload.reserved_at,
      p_special_request: payload.special_request || null,
    });

    if (reservationError) {
      const friendly = toUserFacingError(reservationError, "Couldn't create the reservation.");
      console.error("[useReservations.create]", friendly.code, friendly.technical ?? reservationError);
      throw new Error(friendly.message);
    }

    const reservationId = typeof data === "string" ? data : null;
    if (reservationId && payload.availability_slot) {
      const slotTableIds = (payload.availability_slot.table_ids ?? []).filter(Boolean);
      const { error: shiftUpdateError } = await client
        .from("reservations")
        .update({ shift_id: payload.availability_slot.shift_id })
        .eq("id", reservationId);
      if (shiftUpdateError) {
        const friendly = toUserFacingError(shiftUpdateError, "Couldn't link the reservation to a shift.");
        console.error("[useReservations.create.shift]", friendly.code, friendly.technical ?? shiftUpdateError);
        throw new Error(friendly.message);
      }

      if (slotTableIds.length > 0) {
        const { data: activeAssignments, error: assignmentCheckError } = await client
          .from("reservation_tables")
          .select("table_id")
          .eq("reservation_id", reservationId)
          .is("released_at", null);
        if (assignmentCheckError) {
          const friendly = toUserFacingError(assignmentCheckError, "Couldn't verify table assignments.");
          console.error("[useReservations.create.assignments]", friendly.code, friendly.technical ?? assignmentCheckError);
          throw new Error(friendly.message);
        }
        const assignedTableIds = (activeAssignments ?? [])
          .map((row) => row.table_id)
          .filter((id): id is string => Boolean(id));
        const expected = [...slotTableIds].sort().join(",");
        const actual = [...assignedTableIds].sort().join(",");
        if (expected !== actual) {
          throw new Error("Tables for this slot changed while booking. Refresh and try again.");
        }
      }

      const { error: auditError } = await client.rpc("write_staff_audit_event", {
        p_restaurant_id: selectedRestaurantId,
        p_action: "reservation.host_create",
        p_entity_type: "reservation",
        p_entity_id: reservationId,
        p_before_json: {},
        p_after_json: {
          guest_name: payload.guest_name,
          guest_email: payload.guest_email || null,
          guest_phone: payload.guest_phone || null,
          party_size: payload.party_size,
          reserved_at: payload.reserved_at,
          shift_id: payload.availability_slot.shift_id,
          shift_name: payload.availability_slot.shift_name,
          table_ids: slotTableIds,
          duration_minutes: payload.availability_slot.duration_minutes ?? null,
          source: "floor_plan_host",
        },
        p_approval_profile_id: null,
      });
      if (auditError) {
        const friendly = toUserFacingError(auditError, "Couldn't record the audit event.");
        console.error("[useReservations.create.audit]", friendly.code, friendly.technical ?? auditError);
        throw new Error(friendly.message);
      }
    }

    void fetchReservations();
    return reservationId;
  };

  const requestManagerApproval = async (payload: {
    restaurantId: string;
    action: string;
    managerEmail: string;
    managerPassword: string;
  }) => {
    if (!isSupabaseConfigured()) return null;
    const client = getSupabaseBrowserClient();
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session?.access_token) throw new Error("Authentication required.");

    const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/approve-staff-action`, {
      method: "POST",
      headers: {
        apikey: getSupabaseAnonKey(),
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        restaurant_id: payload.restaurantId,
        action: payload.action,
        manager_email: payload.managerEmail,
        manager_password: payload.managerPassword,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      approval_token?: string;
      error?: string;
    };
    if (!res.ok) {
      const friendly = toUserFacingEdgeError(res, body);
      console.error("[useReservations.requestManagerApproval]", friendly.code, friendly.technical ?? body);
      throw new Error(friendly.message);
    }
    return body.approval_token ?? null;
  };

  return {
    reservations,
    loading,
    error,
    refetch: fetchReservations,
    updateStatus,
    seatReservation,
    markArrivedFromNoShow,
    createReservation,
    requestManagerApproval,
  };
}
