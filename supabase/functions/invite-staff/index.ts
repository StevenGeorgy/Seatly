import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type StaffRole = "owner" | "manager" | "host";
type PermissionKey =
  | "overview"
  | "reservations"
  | "floorPlan"
  | "staffInvites"
  | "orders"
  | "menu"
  | "crm"
  | "analytics"
  | "expenses"
  | "events"
  | "promotions"
  | "export"
  | "restaurant"
  | "settings";
type PermissionOverrides = {
  allow?: PermissionKey[];
  deny?: PermissionKey[];
};
type StaffInvite = {
  id: string;
  restaurant_id: string;
  role: StaffRole;
  email: string | null;
  phone: string | null;
  token: string;
  status: string;
  expires_at: string;
  permission_overrides_json: PermissionOverrides;
};
type DeliveryResult = {
  status: "sent" | "setup_required" | "failed";
  error: string | null;
};

const VALID_ROLES: readonly StaffRole[] = ["owner", "manager", "host"];
const VALID_PERMISSION_KEYS: readonly PermissionKey[] = [
  "overview",
  "reservations",
  "floorPlan",
  "staffInvites",
  "orders",
  "menu",
  "crm",
  "analytics",
  "expenses",
  "events",
  "promotions",
  "export",
  "restaurant",
  "settings",
];
const MANAGER_GRANTABLE_ROLES: readonly StaffRole[] = ["host"];
const MANAGER_GRANTABLE_PERMISSIONS: readonly PermissionKey[] = ["reservations", "floorPlan"];

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

function emailAuthRedirectUrl(token: string): string {
  return `${siteUrl()}/auth/callback?from=${encodeURIComponent(`/accept-invite?token=${token}`)}`;
}

function parseRole(value: unknown): StaffRole | null {
  return typeof value === "string" && (VALID_ROLES as readonly string[]).includes(value)
    ? (value as StaffRole)
    : null;
}

function sanitizePermissionOverrides(value: unknown): PermissionOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as { allow?: unknown; deny?: unknown };
  const allow = Array.isArray(source.allow)
    ? source.allow.filter((key): key is PermissionKey =>
        (VALID_PERMISSION_KEYS as readonly string[]).includes(String(key)),
      )
    : [];
  const deny = Array.isArray(source.deny)
    ? source.deny.filter((key): key is PermissionKey =>
        (VALID_PERMISSION_KEYS as readonly string[]).includes(String(key)),
      )
    : [];

  return {
    ...(allow.length > 0 ? { allow: [...new Set(allow)] } : {}),
    ...(deny.length > 0 ? { deny: [...new Set(deny)] } : {}),
  };
}

function overridesWithinManagerGrant(overrides: PermissionOverrides): boolean {
  const allow = overrides.allow ?? [];
  return allow.every((key) => MANAGER_GRANTABLE_PERMISSIONS.includes(key));
}

async function sendSmsInvite(phone: string, role: StaffRole, url: string): Promise<DeliveryResult> {
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
    Body: `You have been invited as ${role} on Cenaiva. Accept here: ${url}`,
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

function isExistingAuthUserError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("already") && normalized.includes("registered");
}

async function sendEmailInvite(
  adminClient: ReturnType<typeof createClient>,
  email: string,
  url: string,
): Promise<DeliveryResult> {
  const { error } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: url,
  });

  if (!error) return { status: "sent", error: null };
  if (!isExistingAuthUserError(error.message)) {
    return { status: "failed", error: error.message };
  }

  const { error: magicLinkError } = await adminClient.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: url,
      shouldCreateUser: false,
    },
  });

  return magicLinkError
    ? { status: "failed", error: magicLinkError.message }
    : { status: "sent", error: null };
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
    const action = String(body.action ?? "create");
    const restaurantId = String(body.restaurant_id ?? body.restaurantId ?? "").trim();
    const inviteId = String(body.invite_id ?? body.inviteId ?? "").trim();

    const { data: profile, error: profileError } = await adminClient
      .from("user_profiles")
      .select("id, email")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (profileError || !profile) return json({ error: "User profile not found" }, 403);

    let invite: StaffInvite | null = null;
    if (inviteId) {
      const { data, error } = await adminClient
        .from("staff_invitations")
        .select("id, restaurant_id, role, email, phone, token, status, expires_at, permission_overrides_json")
        .eq("id", inviteId)
        .maybeSingle();
      if (error || !data) return json({ error: "Invite not found" }, 404);
      invite = data as StaffInvite;
    }

    const restaurantToCheck = invite?.restaurant_id ?? restaurantId;
    if (!restaurantToCheck) return json({ error: "restaurant_id is required" }, 400);

    const { data: roleRows, error: roleError } = await adminClient
      .from("user_restaurant_roles")
      .select("role")
      .eq("restaurant_id", restaurantToCheck)
      .eq("user_id", profile.id)
      .in("role", ["owner", "manager"]);
    if (roleError || !roleRows || roleRows.length === 0) {
      return json({ error: "Only owners or managers can manage staff invites" }, 403);
    }
    const requesterIsOwner = roleRows.some((row) => row.role === "owner");

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
      const role = parseRole(body.role) ?? "host";
      const permissionOverrides = sanitizePermissionOverrides(
        body.permission_overrides_json ?? body.permissionOverrides,
      );

      if (!email && !phone) return json({ error: "Enter a valid email or phone number" }, 400);
      if (!requesterIsOwner) {
        if (!MANAGER_GRANTABLE_ROLES.includes(role)) {
          return json({ error: "Managers can only invite hosts" }, 403);
        }
        if (!overridesWithinManagerGrant(permissionOverrides)) {
          return json({ error: "Managers can only grant host service permissions" }, 403);
        }
      }

      let existingQuery = adminClient
        .from("staff_invitations")
        .select("id, restaurant_id, role, email, phone, token, status, expires_at, permission_overrides_json")
        .eq("restaurant_id", restaurantId)
        .eq("status", "pending");
      existingQuery = email ? existingQuery.eq("email", email) : existingQuery.eq("phone", phone);

      const { data: existing } = await existingQuery.maybeSingle();
      if (existing) {
        const { data, error } = await adminClient
          .from("staff_invitations")
          .update({
            role,
            permission_overrides_json: permissionOverrides,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .select("id, restaurant_id, role, email, phone, token, status, expires_at, permission_overrides_json")
          .single();
        if (error || !data) return json({ error: error?.message ?? "Could not update invite" }, 400);
        invite = data as StaffInvite;
      } else {
        const { data, error } = await adminClient
          .from("staff_invitations")
          .insert({
            restaurant_id: restaurantId,
            role,
            email,
            phone,
            invited_by: profile.id,
            invited_by_email: profile.email ?? user.email ?? null,
            message_channel: email ? "email" : "sms",
            permission_overrides_json: permissionOverrides,
            status: "pending",
          })
          .select("id, restaurant_id, role, email, phone, token, status, expires_at, permission_overrides_json")
          .single();
        if (error || !data) return json({ error: error?.message ?? "Could not create invite" }, 400);
        invite = data as StaffInvite;
      }
    }

    if (!invite) return json({ error: "invite_id is required" }, 400);
    if (invite.status !== "pending") return json({ error: "Only pending invites can be resent" }, 400);

    let delivery: DeliveryResult;
    if (invite.email) {
      delivery = await sendEmailInvite(adminClient, invite.email, emailAuthRedirectUrl(invite.token));
    } else if (invite.phone) {
      const url = acceptUrl(invite.token);
      delivery = await sendSmsInvite(invite.phone, invite.role, url);
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
