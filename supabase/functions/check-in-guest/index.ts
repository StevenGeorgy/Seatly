import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { parseJsonBody } from "../_shared/validation/parse.ts";
import { CheckInGuestSchema } from "../_shared/validation/reservation-hold.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Authn — verify the JWT signature via supabase-js. Reject anon callers.
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!bearerToken) return jsonRes({ error: "auth_required" }, 401);
    const { data: { user }, error: authError } = await supabase.auth.getUser(bearerToken);
    if (authError || !user) return jsonRes({ error: "invalid_token" }, 401);

    const parsed = await parseJsonBody(req, CheckInGuestSchema, {
      jsonRes: (b, s) => jsonRes(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const reservationId = parsed.data.reservation_id;
    if (!reservationId) return jsonRes({ error: "reservation_id required" }, 400);

    const { data: resv, error: resvErr } = await supabase
      .from("reservations")
      .select("id, restaurant_id, guest_id, table_id, status, party_size")
      .eq("id", reservationId)
      .single();

    if (resvErr || !resv) return jsonRes({ error: "Reservation not found" }, 404);

    // Authz — caller must have a staff role at this restaurant. Any staff
    // (owner / manager / host / server / etc.) can check guests in; the
    // dashboard already filters by role for the button visibility, but the
    // backend gates it here regardless. Previously this endpoint had ZERO
    // ownership check — any authenticated diner could check in any
    // reservation at any restaurant (security audit finding 2026-05-20).
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!profile) return jsonRes({ error: "User profile not found" }, 403);

    const { data: role } = await supabase
      .from("user_restaurant_roles")
      .select("role")
      .eq("user_id", (profile as { id: string }).id)
      .eq("restaurant_id", resv.restaurant_id)
      .maybeSingle();
    if (!role) {
      return jsonRes(
        { error: "You don't have permission to check in reservations at this restaurant" },
        403,
      );
    }

    if (!["pending", "confirmed"].includes(resv.status)) {
      return jsonRes({ error: "Reservation already checked in or completed" }, 400);
    }

    const { error: updateErr } = await supabase
      .from("reservations")
      .update({
        checked_in_at: new Date().toISOString(),
        seated_at: new Date().toISOString(),
        status: "seated",
      })
      .eq("id", reservationId);
    if (updateErr) return jsonRes({ error: updateErr.message }, 500);

    await supabase.rpc("mark_reservation_tables_seated", {
      p_reservation_id: reservationId,
      p_party_size: resv.party_size ?? 0,
    });

    const { data: existingOrder } = await supabase
      .from("orders")
      .select("id")
      .eq("reservation_id", reservationId)
      .single();

    if (!existingOrder) {
      await supabase.from("orders").insert({
        reservation_id: reservationId,
        restaurant_id: resv.restaurant_id,
        guest_id: resv.guest_id,
        table_id: resv.table_id,
        status: "pending",
        is_preorder: false,
      });
    }

    return jsonRes({ ok: true, reservation_id: reservationId, checked_in_at: new Date().toISOString() });
  } catch (err) {
    return jsonRes({ error: String(err) }, 500);
  }
});
