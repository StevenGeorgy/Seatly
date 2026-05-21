import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { InviteHostSchema } from "../_shared/validation/staff-invites.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type StaffInvite = {
  id: string;
  restaurant_id: string;
  email: string | null;
  phone: string | null;
  token: string;
  status: string;
  expires_at: string;
};

type DeliveryResult = {
  status: "sent" | "setup_required" | "failed";
  error: string | null;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function siteUrl(): string {
  return (
    Deno.env.get("SITE_URL") ??
    Deno.env.get("PUBLIC_SITE_URL") ??
    Deno.env.get("APP_URL") ??
    "http://localhost:5173"
  ).replace(/\/+$/, "");
}

function normalizeEmail(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  const digits = trimmed.replace(/[^\d+]/g, "");
  const numeric = digits.replace(/\D/g, "");
  if (numeric.length < 10) return null;
  return digits.startsWith("+") ? digits : `+${numeric}`;
}

function acceptUrl(token: string): string {
  return `${siteUrl()}/accept-invite?token=${encodeURIComponent(token)}`;
}

async function sendSmsInvite(phone: string, url: string): Promise<DeliveryResult> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromPhone =
    Deno.env.get("TWILIO_FROM_PHONE") ??
    Deno.env.get("TWILIO_PHONE_NUMBER") ??
    Deno.env.get("TWILIO_FROM_NUMBER");

  if (!accountSid || !authToken || !fromPhone) {
    return {
      status: "setup_required",
      error:
        "SMS is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER as Supabase Edge Function secrets.",
    };
  }

  const params = new URLSearchParams({
    To: phone,
    From: fromPhone,
    Body: `You have been invited to host on Cenaiva. Accept here: ${url}`,
  });
  const auth = btoa(`${accountSid}:${authToken}`);
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    },
  );

  if (!res.ok) {
    const text = await res.text();
    return { status: "failed", error: text || "SMS provider rejected the invite." };
  }

  return { status: "sent", error: null };
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

    const parsed = await parseJsonBody(req, InviteHostSchema, {
      jsonRes: (b, s) => json(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const body = parsed.data;
    const action = body.action ?? "create";
    const restaurantId = (body.restaurant_id ?? body.restaurantId ?? "").trim();
    const inviteId = (body.invite_id ?? body.inviteId ?? "").trim();

    const { data: profile, error: profileError } = await adminClient
      .from("user_profiles")
      .select("id, email, full_name")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (profileError || !profile) return json({ error: "User profile not found" }, 403);

    const targetRestaurantId = restaurantId;
    if (!targetRestaurantId && action === "create") {
      return json({ error: "restaurant_id is required" }, 400);
    }

    let invite: StaffInvite | null = null;
    if (inviteId) {
      const { data, error } = await adminClient
        .from("staff_invitations")
        .select("id, restaurant_id, email, phone, token, status, expires_at")
        .eq("id", inviteId)
        .maybeSingle();
      if (error || !data) return json({ error: "Invite not found" }, 404);
      invite = data as StaffInvite;
    }

    const restaurantToCheck = invite?.restaurant_id ?? targetRestaurantId;
    const { data: roleRows, error: roleError } = await adminClient
      .from("user_restaurant_roles")
      .select("id")
      .eq("restaurant_id", restaurantToCheck)
      .eq("user_id", profile.id)
      .in("role", ["owner", "manager"])
      .limit(1);
    if (roleError || !roleRows || roleRows.length === 0) {
      return json({ error: "Only owners or managers can manage host invites" }, 403);
    }

    if (action === "cancel") {
      if (!invite) return json({ error: "invite_id is required" }, 400);
      const { data, error } = await adminClient
        .from("staff_invitations")
        .update({
          status: "cancelled",
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", invite.id)
        .select("*")
        .single();
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, invite: data });
    }

    if (action === "create") {
      const contact = String(body.contact ?? "").trim();
      const email = normalizeEmail(contact);
      const phone = email ? null : normalizePhone(contact);
      if (!email && !phone) {
        return json({ error: "Enter a valid email or phone number" }, 400);
      }

      let existingQuery = adminClient
        .from("staff_invitations")
        .select("id, restaurant_id, email, phone, token, status, expires_at")
        .eq("restaurant_id", targetRestaurantId)
        .eq("status", "pending");
      existingQuery = email
        ? existingQuery.eq("email", email)
        : existingQuery.eq("phone", phone);

      const { data: existing } = await existingQuery.maybeSingle();
      if (existing) {
        invite = existing as StaffInvite;
      } else {
        const { data, error } = await adminClient
          .from("staff_invitations")
          .insert({
            restaurant_id: targetRestaurantId,
            role: "host",
            email,
            phone,
            invited_by: profile.id,
            invited_by_email: profile.email ?? user.email ?? null,
            message_channel: email ? "email" : "sms",
            status: "pending",
          })
          .select("id, restaurant_id, email, phone, token, status, expires_at")
          .single();
        if (error || !data) return json({ error: error?.message ?? "Could not create invite" }, 400);
        invite = data as StaffInvite;
      }
    }

    if (!invite) return json({ error: "invite_id is required" }, 400);
    if (invite.status !== "pending") return json({ error: "Only pending invites can be resent" }, 400);

    const url = acceptUrl(invite.token);
    let delivery: DeliveryResult;
    if (invite.email) {
      const { error } = await adminClient.auth.admin.inviteUserByEmail(invite.email, {
        redirectTo: url,
      });
      delivery = error
        ? { status: "failed", error: error.message }
        : { status: "sent", error: null };
    } else if (invite.phone) {
      delivery = await sendSmsInvite(invite.phone, url);
    } else {
      delivery = { status: "failed", error: "Invite has no contact method." };
    }

    const { data: updatedInvite } = await adminClient
      .from("staff_invitations")
      .update({
        delivery_status: delivery.status,
        delivery_error: delivery.error,
        updated_at: new Date().toISOString(),
      })
      .eq("id", invite.id)
      .select("*")
      .single();

    const statusCode = delivery.status === "setup_required" ? 424 : delivery.status === "failed" ? 400 : 200;
    return json(
      {
        ok: delivery.status === "sent",
        setup_required: delivery.status === "setup_required",
        error: delivery.error,
        invite: updatedInvite,
      },
      statusCode,
    );
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
