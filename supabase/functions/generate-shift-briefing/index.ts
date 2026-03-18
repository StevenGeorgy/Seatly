import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function verifyCronSecret(req: Request): boolean {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return true;
  return req.headers.get("x-cron-secret") === secret;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!verifyCronSecret(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().slice(0, 10);
    const dayName = tomorrow.toLocaleDateString("en-US", { weekday: "long" });

    const { data: restaurants } = await supabaseAdmin
      .from("restaurants")
      .select("id, name, cuisine_type")
      .eq("is_active", true);
    if (!restaurants?.length) {
      return new Response(JSON.stringify({ ok: true, generated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anthropic = new Anthropic({ apiKey });
    let generated = 0;

    for (const r of restaurants) {
      const start = `${dateStr}T00:00:00Z`;
      const end = `${dateStr}T23:59:59Z`;
      const { data: resvs } = await supabaseAdmin
        .from("reservations")
        .select("party_size, occasion, special_request, guest_id")
        .eq("restaurant_id", r.id)
        .gte("reserved_at", start)
        .lte("reserved_at", end)
        .in("status", ["pending", "confirmed"]);
      const { data: shifts } = await supabaseAdmin
        .from("shifts")
        .select("name, start_time, end_time")
        .eq("restaurant_id", r.id)
        .eq("is_active", true);

      const guestIds = [...new Set((resvs || []).map((x: any) => x.guest_id).filter(Boolean))];
      const { data: guestData } = guestIds.length
        ? await supabaseAdmin.from("guests").select("id, full_name, tags").in("id", guestIds)
        : { data: [] };
      const guestMap = new Map((guestData || []).map((g) => [g.id, g]));
      const resvSummary = (resvs || []).map((x: any) => ({
        party: x.party_size,
        occasion: x.occasion,
        note: x.special_request,
        guest: guestMap.get(x.guest_id)?.full_name,
        tags: guestMap.get(x.guest_id)?.tags,
      }));

      const prompt = `You are a restaurant shift briefing assistant. Generate a concise, actionable shift briefing for ${r.name} (${r.cuisine_type}) for ${dayName} ${dateStr}.

Reservations tomorrow: ${JSON.stringify(resvSummary)}
Shifts: ${JSON.stringify(shifts || [])}

Write 3-5 bullet points covering: notable parties (VIPs, birthdays, anniversaries), special requests, allergies to watch for, and any operational notes. Keep it under 300 words. Plain text only, no markdown.`;

      const msg = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      });
      const text = msg.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("")
        .trim();

      await supabaseAdmin
        .from("restaurants")
        .update({ current_shift_briefing: text })
        .eq("id", r.id);
      generated++;
    }

    return new Response(JSON.stringify({ ok: true, generated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
