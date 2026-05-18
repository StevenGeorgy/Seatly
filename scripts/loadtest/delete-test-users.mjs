// Deletes all auth.users rows + their user_profiles where the email matches
// the loadtest pattern. Safe to re-run.

import { createClient } from "@supabase/supabase-js";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: new URL("../../.env", import.meta.url) });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log("Listing all users to find loadtest pattern...");
let page = 1;
const TO_DELETE = [];

while (true) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) {
    console.error("List failed:", error.message);
    process.exit(1);
  }
  if (!data?.users?.length) break;

  for (const u of data.users) {
    if (u.email?.startsWith("cenaiva_loadtest_") && u.email?.endsWith("@example.com")) {
      TO_DELETE.push(u);
    }
  }

  if (data.users.length < 1000) break;
  page++;
}

console.log(`Found ${TO_DELETE.length} loadtest users. Deleting...`);

for (let i = 0; i < TO_DELETE.length; i++) {
  const u = TO_DELETE[i];
  const { error } = await admin.auth.admin.deleteUser(u.id);
  if (error) console.error(`[${i}] failed: ${error.message}`);
  if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${TO_DELETE.length}`);
}

console.log(`\n✅ Deleted ${TO_DELETE.length} loadtest users.`);
console.log(`(Corresponding user_profiles rows were cascade-deleted via FK.)`);
