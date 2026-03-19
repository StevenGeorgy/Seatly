import { NextResponse } from "next/server";
import { loadMonorepoEnv } from "@/lib/server/load-monorepo-env";
import {
  signupRestaurantOwner,
  type SignupRestaurantOwnerFailure,
} from "@/lib/server/signup-restaurant-owner";

export async function POST(req: Request) {
  loadMonorepoEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url?.trim() || !serviceKey?.trim()) {
    const missing: string[] = [];
    if (!url?.trim()) missing.push("NEXT_PUBLIC_SUPABASE_URL");
    if (!serviceKey?.trim()) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    return NextResponse.json(
      {
        error: `Missing env: ${missing.join(", ")}. Put them in Seatly/.env (folder with package.json), save, restart dev server.`,
      },
      { status: 503 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const restaurant_name = String(body.restaurant_name ?? body.restaurantName ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const full_name = String(body.full_name ?? body.fullName ?? "").trim();

  const result = await signupRestaurantOwner(
    { restaurant_name, email, password, full_name },
    url,
    serviceKey
  );

  if ("ok" in result && result.ok) {
    return NextResponse.json(result);
  }

  const failure = result as SignupRestaurantOwnerFailure;
  return NextResponse.json({ error: failure.error }, { status: failure.status });
}
