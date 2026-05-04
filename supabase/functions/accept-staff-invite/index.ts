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

function defaultRedirectForRole(role: string): string {
  if (role === "host") return "/dashboard/reservations";
  return "/dashboard";
}

type InviteRow = {
  id: string;
  restaurant_id: string;
  role: string;
  email: string | null;
  phone: string | null;
  token: string;
  status: string;
  expires_at: string;
  permission_overrides_json: Record<string, unknown> | null;
  restaurants?: { name?: string | null } | null;
};

function inviteContact(invite: InviteRow): string | null {
  return invite.email ?? invite.phone ?? null;
}

function isExpired(invite: InviteRow): boolean {
  const expiresAt = new Date(invite.expires_at);
  return Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now();
}

function publicInvitePayload(invite: InviteRow) {
  return {
    id: invite.id,
    restaurant_id: invite.restaurant_id,
    restaurant_name: invite.restaurants?.name ?? "this restaurant",
    role: invite.role,
    contact: inviteContact(invite),
    status: isExpired(invite) && invite.status === "pending" ? "expired" : invite.status,
    expires_at: invite.expires_at,
    permission_overrides_json: invite.permission_overrides_json ?? {},
  };
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

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "accept");
    const token = String(body.token ?? "").trim();
    if (!token) return json({ error: "Invite token is required" }, 400);

    const { data: invite, error: inviteError } = await adminClient
      .from("staff_invitations")
      .select("id, restaurant_id, role, email, phone, token, status, expires_at, permission_overrides_json, restaurants(name)")
      .eq("token", token)
      .maybeSingle();

    if (inviteError || !invite) return json({ error: "Invite not found" }, 404);
    const staffInvite = invite as InviteRow;

    if (staffInvite.status === "pending" && isExpired(staffInvite)) {
      await adminClient
        .from("staff_invitations")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", staffInvite.id);
      staffInvite.status = "expired";
    }

    if (action === "preview") {
      return json({ ok: true, invite: publicInvitePayload(staffInvite) });
    }

    if (action === "decline") {
      if (staffInvite.status !== "pending") return json({ error: "This invite is no longer active" }, 400);
      const { error: declineError } = await adminClient
        .from("staff_invitations")
        .update({
          status: "declined",
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", staffInvite.id);
      if (declineError) return json({ error: declineError.message }, 400);
      return json({ ok: true, invite: { ...publicInvitePayload(staffInvite), status: "declined" } });
    }

    if (action !== "accept") return json({ error: "Unsupported invite action" }, 400);
    if (staffInvite.status !== "pending") return json({ error: "This invite is no longer active" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!bearerToken) return json({ error: "Authentication required" }, 401);

    const {
      data: { user },
      error: userError,
    } = await adminClient.auth.getUser(bearerToken);
    if (userError || !user) return json({ error: "Invalid or expired session" }, 401);

    if (staffInvite.email && user.email && staffInvite.email.toLowerCase() !== user.email.toLowerCase()) {
      return json({ error: "Sign in with the email address this invite was sent to" }, 403);
    }
    if (staffInvite.phone && user.phone && staffInvite.phone !== user.phone) {
      return json({ error: "Sign in with the phone number this invite was sent to" }, 403);
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
          email: user.email ?? staffInvite.email ?? null,
          phone: user.phone ?? staffInvite.phone ?? null,
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
          email: user.email ?? staffInvite.email ?? null,
          phone: user.phone ?? staffInvite.phone ?? null,
        })
        .eq("id", profileId);
    }

    const { error: roleError } = await adminClient.from("user_restaurant_roles").upsert(
      {
        user_id: profileId,
        restaurant_id: staffInvite.restaurant_id,
        role: staffInvite.role,
        is_primary: false,
        permission_overrides_json: staffInvite.permission_overrides_json ?? {},
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
      .eq("id", staffInvite.id);
    if (acceptError) return json({ error: acceptError.message }, 400);

    return json({
      ok: true,
      restaurant_id: staffInvite.restaurant_id,
      role: staffInvite.role,
      redirect_to: defaultRedirectForRole(staffInvite.role),
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
