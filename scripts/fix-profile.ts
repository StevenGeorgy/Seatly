/**
 * Create a user_profile for an existing Supabase Auth user who has no profile.
 * Use when you see "Profile not found. Please contact support." on login.
 *
 * Run with: npx tsx scripts/fix-profile.ts <email>
 * Example:  npx tsx scripts/fix-profile.ts markhabbi2@gmail.com
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env
 *
 * This script will:
 * 1. Find the auth user by email
 * 2. Create a restaurant (or use the first existing one)
 * 3. Create a user_profile linking the auth user to the restaurant as owner
 */

import dotenv from "dotenv";
import path from "path";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Add to .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findAuthUserByEmail(email: string) {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) {
    throw new Error(`Failed to list users: ${error.message}`);
  }
  const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  return user ?? null;
}

async function main() {
  const email = process.argv[2]?.trim();
  if (!email) {
    console.error("Usage: npx tsx scripts/fix-profile.ts <email>");
    console.error("Example: npx tsx scripts/fix-profile.ts markhabbi2@gmail.com");
    process.exit(1);
  }

  console.log(`Looking up auth user for: ${email}`);

  const authUser = await findAuthUserByEmail(email);
  if (!authUser) {
    console.error(`No auth user found with email: ${email}`);
    console.error("Make sure the user has signed up (or was created in Supabase Auth) first.");
    process.exit(1);
  }

  const { data: existingProfile } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", authUser.id)
    .maybeSingle();

  if (existingProfile) {
    console.log("Profile already exists for this user. No action needed.");
    process.exit(0);
  }

  let restaurantId: string;
  const { data: restaurants } = await supabase.from("restaurants").select("id, name").limit(1);

  if (restaurants && restaurants.length > 0) {
    restaurantId = restaurants[0].id;
    console.log(`Using existing restaurant: ${restaurants[0].name}`);
  } else {
    const slug = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "-") || "restaurant";
    const { data: newRestaurant, error: restaurantError } = await supabase
      .from("restaurants")
      .insert({
        name: `${email.split("@")[0]}'s Restaurant`,
        slug,
        plan: "free",
        is_active: true,
        timezone: "America/Toronto",
        currency: "CAD",
        country: "Canada",
      })
      .select("id")
      .single();

    if (restaurantError || !newRestaurant) {
      console.error("Failed to create restaurant:", restaurantError?.message);
      process.exit(1);
    }
    restaurantId = newRestaurant.id;
    console.log(`Created new restaurant for ${email}`);
  }

  const fullName = authUser.user_metadata?.full_name ?? email.split("@")[0];

  const { error: profileError } = await supabase.from("user_profiles").insert({
    auth_user_id: authUser.id,
    full_name: fullName,
    email: authUser.email ?? email,
    role: "owner",
    restaurant_id: restaurantId,
  });

  if (profileError) {
    console.error("Failed to create profile:", profileError.message);
    process.exit(1);
  }

  console.log("\nProfile created successfully!");
  console.log("You can now sign in at http://localhost:3001/login");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
