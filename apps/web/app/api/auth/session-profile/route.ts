import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { loadMonorepoEnv } from "@/lib/server/load-monorepo-env";

/**
 * Returns user_profiles for the JWT subject. Uses service role so login works
 * even when the browser client has not yet attached the session to PostgREST (RLS would hide the row).
 */
export async function GET(req: Request) {
  loadMonorepoEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Server not configured" }, { status: 503 });
  }

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "")?.trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createClient(url, serviceKey);
  const {
    data: { user },
    error: userErr,
  } = await admin.auth.getUser(token);

  if (userErr || !user?.id) {
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });
  }

  const { data: row, error } = await admin
    .from("user_profiles")
    .select("id, email, full_name, role, restaurant_id, avatar_url")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({ profile: null }, { status: 404 });
  }

  return NextResponse.json({ profile: row });
}
