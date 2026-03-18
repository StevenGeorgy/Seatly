import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const restaurantId = url.searchParams.get("restaurant_id");
    const dateStr = url.searchParams.get("date");
    const partySize = parseInt(url.searchParams.get("party_size") || "2", 10);

    if (!restaurantId || !dateStr) {
      return new Response(
        JSON.stringify({ error: "restaurant_id and date required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const date = new Date(dateStr);
    const dayOfWeek = date.getDay() === 0 ? 7 : date.getDay();
    const dateOnly = dateStr.slice(0, 10);

    const { data: shifts } = await supabase
      .from("shifts")
      .select("id, name, start_time, end_time, slot_duration_minutes, turn_time_minutes, min_party_size, max_party_size, max_covers")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .contains("days_of_week", [dayOfWeek]);

    if (!shifts?.length) {
      return new Response(
        JSON.stringify({ slots: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const start = `${dateOnly}T00:00:00`;
    const end = `${dateOnly}T23:59:59`;
    const { data: reservations } = await supabase
      .from("reservations")
      .select("shift_id, reserved_at, party_size")
      .eq("restaurant_id", restaurantId)
      .in("status", ["pending", "confirmed", "seated"])
      .gte("reserved_at", start)
      .lte("reserved_at", end);

    const slots: { shift_id: string; shift_name: string; time: string }[] = [];

    for (const shift of shifts) {
      if (partySize < (shift.min_party_size || 1) || partySize > (shift.max_party_size || 20)) continue;

      const [sH, sM] = (shift.start_time || "17:00").split(":").map(Number);
      const [eH, eM] = (shift.end_time || "23:00").split(":").map(Number);
      const slotMins = shift.slot_duration_minutes || 30;
      const turnMins = shift.turn_time_minutes || 90;
      const maxCovers = shift.max_covers || 100;

      let slotMin = sH * 60 + sM;
      const endMin = eH * 60 + eM;

      while (slotMin + slotMins <= endMin) {
        const slotStart = new Date(date);
        slotStart.setHours(Math.floor(slotMin / 60), slotMin % 60, 0, 0);
        const slotEnd = new Date(slotStart.getTime() + turnMins * 60 * 1000);

        const shiftResvs = (reservations || []).filter((r) => r.shift_id === shift.id);
        let totalCovers = partySize;
        let available = true;
        for (const r of shiftResvs) {
          const resvStart = new Date(r.reserved_at);
          const resvEnd = new Date(resvStart.getTime() + turnMins * 60 * 1000);
          if (slotStart < resvEnd && slotEnd > resvStart) {
            totalCovers += r.party_size || 0;
            if (totalCovers > maxCovers) {
              available = false;
              break;
            }
          }
        }
        if (available && totalCovers <= maxCovers) {
          slots.push({
            shift_id: shift.id,
            shift_name: shift.name || "Shift",
            time: slotStart.toISOString().slice(0, 19).replace("T", " "),
          });
        }
        slotMin += slotMins;
      }
    }

    return new Response(JSON.stringify({ slots }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
