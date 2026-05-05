import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RequestBody = {
  reservation_id?: unknown;
  reservationId?: unknown;
};

type ReservationRow = {
  id: string;
  guest_id: string;
  reserved_at: string;
  status: string | null;
  table_id: string | null;
};

type ReservationTableRow = {
  table_id: string;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!bearerToken) return json({ error: "Authentication required" }, 401);

    const {
      data: { user },
      error: userError,
    } = await adminClient.auth.getUser(bearerToken);
    if (userError || !user) return json({ error: "Invalid or expired session" }, 401);

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const reservationId = cleanString(body.reservation_id ?? body.reservationId);
    if (!reservationId) return json({ error: "reservation_id is required" }, 400);

    const { data: profile, error: profileError } = await adminClient
      .from("user_profiles")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (profileError) return json({ error: profileError.message }, 400);
    if (!profile) return json({ error: "User profile not found" }, 403);

    const { data: reservation, error: reservationError } = await adminClient
      .from("reservations")
      .select("id, guest_id, reserved_at, status, table_id")
      .eq("id", reservationId)
      .maybeSingle<ReservationRow>();
    if (reservationError) return json({ error: reservationError.message }, 400);
    if (!reservation) return json({ error: "Reservation not found" }, 404);

    const { data: guest, error: guestError } = await adminClient
      .from("guests")
      .select("id")
      .eq("id", reservation.guest_id)
      .eq("user_profile_id", profile.id)
      .maybeSingle();
    if (guestError) return json({ error: guestError.message }, 400);
    if (!guest) return json({ error: "You can only cancel your own reservations" }, 403);

    if (reservation.status === "cancelled") {
      return json({ ok: true, reservation_id: reservationId, status: "cancelled" });
    }

    const reservedAt = new Date(reservation.reserved_at);
    if (Number.isNaN(reservedAt.getTime())) {
      return json({ error: "Reservation date is invalid" }, 400);
    }
    if (reservedAt.getTime() < Date.now()) {
      return json({ error: "Past reservations cannot be cancelled" }, 400);
    }

    const { error: updateError } = await adminClient
      .from("reservations")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancellation_reason: "Cancelled by diner",
      })
      .eq("id", reservationId);
    if (updateError) return json({ error: updateError.message }, 400);

    const { error: rpcReleaseError } = await adminClient.rpc("release_reservation_tables", {
      p_reservation_id: reservationId,
    });
    if (!rpcReleaseError) {
      return json({ ok: true, reservation_id: reservationId, status: "cancelled" });
    }

    const { data: assignedTables, error: assignedTablesError } = await adminClient
      .from("reservation_tables")
      .select("table_id")
      .eq("reservation_id", reservationId)
      .is("released_at", null)
      .returns<ReservationTableRow[]>();
    if (assignedTablesError && assignedTablesError.code !== "42P01") {
      return json({ error: assignedTablesError.message }, 400);
    }

    const tableIds = Array.from(
      new Set([
        ...((assignedTables ?? []).map((row) => row.table_id)),
        ...(reservation.table_id ? [reservation.table_id] : []),
      ]),
    );

    const { error: linkReleaseError } = await adminClient
      .from("reservation_tables")
      .update({ released_at: new Date().toISOString() })
      .eq("reservation_id", reservationId)
      .is("released_at", null);
    if (linkReleaseError && linkReleaseError.code !== "42P01") {
      return json({ error: linkReleaseError.message }, 400);
    }

    if (tableIds.length > 0) {
      const { error: tableUpdateError } = await adminClient
        .from("tables")
        .update({
          status: "empty",
          seated_count: 0,
          combined_with: null,
          updated_at: new Date().toISOString(),
        })
        .in("id", tableIds)
        .neq("status", "blocked");
      if (tableUpdateError) return json({ error: tableUpdateError.message }, 400);
    }

    return json({ ok: true, reservation_id: reservationId, status: "cancelled" });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
