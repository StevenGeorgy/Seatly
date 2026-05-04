import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

    const body = await req.json().catch(() => ({}));
    const token = String(body.token ?? "").trim();
    if (!token) return json({ error: "Invite token is required" }, 400);

    const { data: invite, error: inviteError } = await adminClient
      .from("staff_invitations")
      .select("id, restaurant_id, role, email, phone, token, status, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (inviteError || !invite) return json({ error: "Invite not found" }, 404);
    if (invite.status !== "pending") return json({ error: "This invite is no longer active" }, 400);

    const expiresAt = new Date(invite.expires_at);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      await adminClient
        .from("staff_invitations")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", invite.id);
      return json({ error: "This invite has expired" }, 400);
    }

    if (invite.email && user.email && invite.email.toLowerCase() !== user.email.toLowerCase()) {
      return json({ error: "Sign in with the email address this invite was sent to" }, 403);
    }

    const metadataName = user.user_metadata?.full_name;
    const fullName = typeof metadataName === "string" ? metadataName.trim() : "";
    const { data: existingProfile } = await adminClient
      .from("user_profiles")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    let profileId = existingProfile?.id as string | undefined;
    if (!profileId) {
      const { data: newProfile, error: profileError } = await adminClient
        .from("user_profiles")
        .insert({
          auth_user_id: user.id,
          full_name: fullName || null,
          email: user.email ?? invite.email ?? null,
          phone: user.phone ?? invite.phone ?? null,
          role: "customer",
        })
        .select("id")
        .single();
      if (profileError || !newProfile) {
        return json({ error: profileError?.message ?? "Could not create user profile" }, 400);
      }
      profileId = newProfile.id;
    } else {
      await adminClient
        .from("user_profiles")
        .update({
          email: user.email ?? invite.email ?? null,
          phone: user.phone ?? invite.phone ?? null,
        })
        .eq("id", profileId);
    }

    const { error: roleError } = await adminClient.from("user_restaurant_roles").upsert(
      {
        user_id: profileId,
        restaurant_id: invite.restaurant_id,
        role: "host",
        is_primary: false,
      },
      { onConflict: "user_id,restaurant_id" },
    );
    if (roleError) return json({ error: roleError.message }, 400);

    const { error: acceptError } = await adminClient
      .from("staff_invitations")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        accepted_by: profileId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", invite.id);
    if (acceptError) return json({ error: acceptError.message }, 400);

    return json({
      ok: true,
      restaurant_id: invite.restaurant_id,
      role: "host",
      redirect_to: "/dashboard/reservations",
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
