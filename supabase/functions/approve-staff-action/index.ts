import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { ApproveStaffActionSchema } from "../_shared/validation/staff-invites.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!bearerToken) return json({ error: "Authentication required" }, 401);

    const {
      data: { user: actorUser },
      error: actorError,
    } = await adminClient.auth.getUser(bearerToken);
    if (actorError || !actorUser) return json({ error: "Invalid or expired session" }, 401);

    const parsed = await parseJsonBody(req, ApproveStaffActionSchema, {
      jsonRes: (b, s) => json(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const restaurantId = parsed.data.restaurant_id;
    const action = parsed.data.action;
    const managerEmail = parsed.data.manager_email;
    const managerPassword = parsed.data.manager_password;

    const managerClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: managerAuth, error: managerAuthError } = await managerClient.auth.signInWithPassword({
      email: managerEmail,
      password: managerPassword,
    });
    if (managerAuthError || !managerAuth.user) {
      return json({ error: "Manager credentials were not accepted." }, 403);
    }

    const { data: actorProfile } = await adminClient
      .from("user_profiles")
      .select("id")
      .eq("auth_user_id", actorUser.id)
      .maybeSingle();

    const { data: managerProfile } = await adminClient
      .from("user_profiles")
      .select("id")
      .eq("auth_user_id", managerAuth.user.id)
      .maybeSingle();

    if (!actorProfile?.id || !managerProfile?.id) {
      return json({ error: "Could not find staff profiles for approval." }, 403);
    }

    const { data: actorRole } = await adminClient
      .from("user_restaurant_roles")
      .select("role")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", actorProfile.id)
      .maybeSingle();
    if (!actorRole?.role) return json({ error: "Actor is not staff at this restaurant." }, 403);

    const { data: managerRole } = await adminClient
      .from("user_restaurant_roles")
      .select("role")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", managerProfile.id)
      .in("role", ["owner", "manager"])
      .maybeSingle();
    if (!managerRole?.role) return json({ error: "Approval requires an owner or manager." }, 403);

    const { data: approval, error: approvalError } = await adminClient
      .from("manager_action_approvals")
      .insert({
        restaurant_id: restaurantId,
        action,
        requested_by: actorProfile.id,
        approved_by: managerProfile.id,
      })
      .select("token")
      .single();
    if (approvalError || !approval?.token) {
      return json({ error: approvalError?.message ?? "Could not create approval." }, 400);
    }

    await adminClient.from("staff_audit_events").insert({
      restaurant_id: restaurantId,
      actor_profile_id: actorProfile.id,
      actor_role: actorRole.role,
      action: "manager.approval.create",
      entity_type: "manager_action_approval",
      before_json: {},
      after_json: { action },
      approval_profile_id: managerProfile.id,
    });

    return json({ ok: true, approval_token: approval.token });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
