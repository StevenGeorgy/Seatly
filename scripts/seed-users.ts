/**
 * Seed test user accounts for Seatly.
 * Creates 4 users: owner1, host1 (La Maison), owner2, host2 (The Local)
 *
 * Run with: npm run seed:users
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env
 *
 * Password for all test accounts: TestPassword123!
 */

import dotenv from "dotenv";
import path from "path";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Add to .env"
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_PASSWORD = "TestPassword123!";

const usersToCreate = [
  {
    email: "owner1@seatly.test",
    fullName: "La Maison Owner",
    role: "owner" as const,
    restaurantSlug: "la-maison",
  },
  {
    email: "host1@seatly.test",
    fullName: "La Maison Host",
    role: "host" as const,
    restaurantSlug: "la-maison",
  },
  {
    email: "owner2@seatly.test",
    fullName: "The Local Owner",
    role: "owner" as const,
    restaurantSlug: "the-local",
  },
  {
    email: "host2@seatly.test",
    fullName: "The Local Host",
    role: "host" as const,
    restaurantSlug: "the-local",
  },
];

async function seedUsers() {
  const { data: restaurants } = await supabase
    .from("restaurants")
    .select("id, slug")
    .in("slug", ["la-maison", "the-local"]);

  if (!restaurants || restaurants.length === 0) {
    console.error("Restaurants not found. Run seed_data migration first.");
    process.exit(1);
  }

  const restaurantBySlug = Object.fromEntries(
    restaurants.map((r) => [r.slug, r.id])
  );

  for (const user of usersToCreate) {
    const restaurantId = restaurantBySlug[user.restaurantSlug];
    if (!restaurantId) {
      console.error(`Restaurant ${user.restaurantSlug} not found`);
      continue;
    }

    const { data: authUser, error: authError } =
      await supabase.auth.admin.createUser({
        email: user.email,
        password: TEST_PASSWORD,
        email_confirm: true,
      });

    if (authError) {
      if (authError.message.includes("already been registered")) {
        console.log(`User ${user.email} already exists, skipping`);
        continue;
      }
      console.error(`Failed to create ${user.email}:`, authError.message);
      continue;
    }

    if (!authUser.user) {
      console.error(`No user returned for ${user.email}`);
      continue;
    }

    const { error: profileError } = await supabase.from("user_profiles").insert({
      auth_user_id: authUser.user.id,
      full_name: user.fullName,
      email: user.email,
      role: user.role,
      restaurant_id: restaurantId,
    });

    if (profileError) {
      console.error(`Failed to create profile for ${user.email}:`, profileError);
      continue;
    }

    console.log(`Created ${user.email} (${user.role}) for ${user.restaurantSlug}`);
  }

  console.log("\nDone. Test accounts use password:", TEST_PASSWORD);
}

seedUsers().catch(console.error);
