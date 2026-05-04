import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

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

    const email = user.email?.trim().toLowerCase() ?? "";
    const phone = user.phone?.trim() ?? "";
    if (!email && !phone) return json({ invites: [] });

    let query = adminClient
      .from("staff_invitations")
      .select("id, restaurant_id, role, email, phone, token, status, expires_at, permission_overrides_json, restaurants(name)")
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(20);

    if (email && phone) {
      query = query.or(`email.eq.${email},phone.eq.${phone}`);
    } else if (email) {
      query = query.eq("email", email);
    } else {
      query = query.eq("phone", phone);
    }

    const { data, error } = await query;
    if (error) return json({ error: error.message }, 400);

    const invites = (data ?? []).map((invite) => ({
      id: invite.id,
      restaurant_id: invite.restaurant_id,
      restaurant_name: invite.restaurants?.name ?? "this restaurant",
      role: invite.role,
      token: invite.token,
      expires_at: invite.expires_at,
      permission_overrides_json: invite.permission_overrides_json ?? {},
    }));

    return json({ invites });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
