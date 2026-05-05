import { useCallback, useEffect, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import type { AvailabilitySlot } from "@/hooks/useAvailability";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

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
  guests?: { full_name: string | null; email: string | null; phone: string | null } | null;
  reservation_tables?: Array<{
    table_id: string;
    is_primary: boolean;
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
  search?: string;
};

export function useReservations(filters?: ReservationFilters) {
  const { selectedRestaurantId } = useRestaurantScope();
  const filterStatus = filters?.status;
  const filterDate = filters?.date;
  const filterSearch = filters?.search;
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchReservations = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setReservations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();

    let query = client
      .from("reservations")
      .select("*, guests(full_name, email, phone), tables(id, table_number, label, section, capacity), reservation_tables(table_id, is_primary, tables(id, table_number, label, section, capacity))")
      .eq("restaurant_id", selectedRestaurantId)
      .order("reserved_at", { ascending: true });

    if (filterStatus && filterStatus !== "all") {
      query = query.eq("status", filterStatus);
    } else {
      // Keep cancellations visible to staff for the selected service day.
      query = query.not("status", "in", '("completed","no_show")');
    }

    if (filterDate) {
      const dayStart = `${filterDate}T00:00:00`;
      const dayEnd = `${filterDate}T23:59:59`;
      query = query.gte("reserved_at", dayStart).lte("reserved_at", dayEnd);
    }

    const { data, error: qErr } = await query;

    if (qErr) {
      setError(new Error(qErr.message));
      setReservations([]);
    } else {
      let rows = ((data ?? []) as ReservationRow[]).map((reservation) => ({
        ...reservation,
        reservation_tables: reservation.reservation_tables?.filter((assignment) => assignment.tables) ?? [],
      }));
      if (filterSearch) {
        const s = filterSearch.toLowerCase();
        rows = rows.filter(
          (r) =>
            r.guests?.full_name?.toLowerCase().includes(s) ||
            r.guest_full_name?.toLowerCase().includes(s) ||
            r.guest_phone?.toLowerCase().includes(s) ||
            r.guest_email?.toLowerCase().includes(s) ||
            r.reservation_tables?.some((assignment) =>
              assignment.tables?.label?.toLowerCase().includes(s) ||
              assignment.tables?.table_number?.toLowerCase().includes(s),
            ) ||
            r.tables?.label?.toLowerCase().includes(s) ||
            r.tables?.table_number?.toLowerCase().includes(s) ||
            r.confirmation_code?.toLowerCase().includes(s),
        );
      }
      setReservations(rows);
    }
    setLoading(false);
  }, [selectedRestaurantId, filterStatus, filterDate, filterSearch]);

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

  const updateStatus = async (id: string, status: string, approvalToken?: string) => {
    if (!isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    const { error: statusError } = await client.rpc("update_staff_reservation_status", {
      p_reservation_id: id,
      p_status: status,
      p_approval_token: approvalToken ?? null,
    });
    if (statusError) {
      throw new Error(statusError.message);
    }

    void fetchReservations();
  };

  const seatReservation = async (
    reservationId: string,
    tableId: string,
    partySize: number,
  ) => {
    if (!isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    const { error: seatError } = await client.rpc("seat_staff_reservation", {
      p_reservation_id: reservationId,
      p_table_id: tableId,
    });
    if (seatError) {
      throw new Error(seatError.message);
    }
    void partySize;
    void fetchReservations();
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
      throw new Error(reservationError.message);
    }

    const reservationId = typeof data === "string" ? data : null;
    if (reservationId && payload.availability_slot) {
      const slotTableIds = (payload.availability_slot.table_ids ?? []).filter(Boolean);
      const { error: shiftUpdateError } = await client
        .from("reservations")
        .update({ shift_id: payload.availability_slot.shift_id })
        .eq("id", reservationId);
      if (shiftUpdateError) throw new Error(shiftUpdateError.message);

      if (slotTableIds.length > 0) {
        const { data: activeAssignments, error: assignmentCheckError } = await client
          .from("reservation_tables")
          .select("table_id")
          .eq("reservation_id", reservationId)
          .is("released_at", null);
        if (assignmentCheckError) throw new Error(assignmentCheckError.message);
        const assignedTableIds = (activeAssignments ?? [])
          .map((row) => row.table_id)
          .filter((id): id is string => Boolean(id));
        const expected = [...slotTableIds].sort().join(",");
        const actual = [...assignedTableIds].sort().join(",");
        if (expected !== actual) {
          throw new Error("Reservation table assignment changed before booking completed. Refresh availability and try again.");
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
          source: "host_view",
        },
        p_approval_profile_id: null,
      });
      if (auditError) throw new Error(auditError.message);
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
      throw new Error(body.error ?? "Manager approval failed.");
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
    createReservation,
    requestManagerApproval,
  };
}
