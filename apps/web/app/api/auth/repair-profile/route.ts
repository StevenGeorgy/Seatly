import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { loadMonorepoEnv } from "@/lib/server/load-monorepo-env";

const STAFF_ROLES = new Set(["owner", "host", "waiter", "kitchen", "admin"]);

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s.trim()
  );
}

/**
 * 1) Link user_profiles row when email matches Auth but auth_user_id was wrong.
 * 2) Create user_profiles when staff has Auth only (metadata.restaurant_id or dev single-restaurant).
 */
export async function POST(req: Request) {
  loadMonorepoEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Server not configured" }, { status: 503 });
  }

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "")?.trim();
  if (!token) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }

  const admin = createClient(url, serviceKey);
  const {
    data: { user },
    error: userErr,
  } = await admin.auth.getUser(token);

  if (userErr || !user?.email) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  const email = user.email.trim().toLowerCase();
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;

  const { data: byAuth } = await admin
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (byAuth) {
    return NextResponse.json({ repaired: false, reason: "profile_exists" });
  }

  const emailVariants = [
    ...new Set([email, user.email.trim(), user.email.trim().toLowerCase()]),
  ];
  const { data: byEmail, error: emailErr } = await admin
    .from("user_profiles")
    .select("id, auth_user_id, email")
    .in("email", emailVariants)
    .limit(10);

  if (emailErr) {
    return NextResponse.json({ error: emailErr.message }, { status: 500 });
  }

  const emailRows = (byEmail ?? []).filter(
    (r) => (r.email ?? "").trim().toLowerCase() === email
  );

  if (emailRows.length === 1) {
    const row = emailRows[0];
    if (row.auth_user_id !== user.id) {
      const { error: upErr } = await admin
        .from("user_profiles")
        .update({ auth_user_id: user.id })
        .eq("id", row.id);
      if (upErr) {
        return NextResponse.json({ error: upErr.message }, { status: 500 });
      }
    }
    return NextResponse.json({ repaired: true, created: false });
  }

  if (emailRows.length > 1) {
    return NextResponse.json({ repaired: false, reason: "multiple_profiles_same_email" });
  }

  const metaRestaurant =
    (typeof meta.restaurant_id === "string" && meta.restaurant_id) ||
    (typeof meta.staff_restaurant_id === "string" && meta.staff_restaurant_id) ||
    (typeof meta.seatly_restaurant_id === "string" && meta.seatly_restaurant_id);

  let restaurantId: string | null = null;
  let role = "host";

  if (metaRestaurant && isUuid(metaRestaurant)) {
    restaurantId = metaRestaurant.trim();
    const mr = typeof meta.seatly_role === "string" ? meta.seatly_role : "";
    const mr2 = typeof meta.role === "string" ? meta.role : "";
    const r = (mr || mr2).toLowerCase();
    if (STAFF_ROLES.has(r)) role = r;
  }

  const envRestaurant = process.env.SEATLY_STAFF_RESTAURANT_ID?.trim();
  if (!restaurantId && envRestaurant && isUuid(envRestaurant)) {
    restaurantId = envRestaurant;
  }

  if (!restaurantId) {
    const allowAuto =
      process.env.SEATLY_AUTO_STAFF_PROFILE === "1" ||
      process.env.NODE_ENV === "development";
    if (allowAuto) {
      const { data: rests } = await admin
        .from("restaurants")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1);
      if (rests?.[0]?.id) {
        restaurantId = rests[0].id;
      }
    }
  }

  if (!restaurantId) {
    return NextResponse.json({
      repaired: false,
      reason: "no_profile",
      hint:
        "No restaurants in DB, or production without metadata. Add SEATLY_STAFF_RESTAURANT_ID to .env (restaurant UUID), or User Metadata restaurant_id on this Auth user.",
    });
  }

  const { data: restRow } = await admin
    .from("restaurants")
    .select("id")
    .eq("id", restaurantId)
    .maybeSingle();

  if (!restRow) {
    return NextResponse.json({ error: "Invalid restaurant_id" }, { status: 400 });
  }

  const fullName =
    (typeof meta.full_name === "string" && meta.full_name.trim()) ||
    email.split("@")[0] ||
    "Staff";

  const { error: insErr } = await admin.from("user_profiles").insert({
    auth_user_id: user.id,
    email: user.email.trim(),
    full_name: fullName,
    role,
    restaurant_id: restaurantId,
  });

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ repaired: true, created: true });
}
