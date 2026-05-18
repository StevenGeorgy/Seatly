// Creates N test users via Supabase admin API and mints session JWTs.
// Saves to scripts/loadtest/test-users.json for k6 to consume.
//
// Usage:
//   node scripts/loadtest/create-test-users.mjs 100
//
// To clean up afterwards:
//   node scripts/loadtest/delete-test-users.mjs
//
// SAFETY: All test users use the email pattern `cenaiva_loadtest_<id>@example.com`
// so they're easy to find and delete. The password is the same for all of them.

import { createClient } from "@supabase/supabase-js";
import { writeFile } from "node:fs/promises";
import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: new URL("../../.env", import.meta.url) });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
  console.error("Missing required env vars. Need SUPABASE_URL, SERVICE_ROLE_KEY, ANON_KEY.");
  process.exit(1);
}

const N = Number.parseInt(process.argv[2] ?? "100", 10);
if (!Number.isFinite(N) || N < 1 || N > 200) {
  console.error(`Invalid user count: ${process.argv[2]}. Must be 1-200.`);
  process.exit(1);
}

const PASSWORD = "loadtest_2026_05_18_change_me";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const users = [];
console.log(`Creating ${N} test users...`);

for (let i = 0; i < N; i++) {
  const email = `cenaiva_loadtest_${String(i).padStart(3, "0")}@example.com`;
  let userId = null;

  // Try to create — if already exists, fetch instead
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { is_loadtest_user: true, full_name: `Load Test ${i}` },
  });

  if (error) {
    if (/already|registered|exists/i.test(error.message)) {
      // Find existing user
      const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = listed?.users?.find((u) => u.email === email);
      if (existing) {
        userId = existing.id;
      } else {
        console.error(`[${i}] create failed: ${error.message}`);
        continue;
      }
    } else {
      console.error(`[${i}] create failed: ${error.message}`);
      continue;
    }
  } else {
    userId = data.user?.id;
  }

  if (!userId) {
    console.error(`[${i}] no user id`);
    continue;
  }

  // Sign in via anon to get a session JWT
  const { data: session, error: signinErr } = await anon.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signinErr || !session?.session) {
    console.error(`[${i}] signin failed: ${signinErr?.message ?? "no session"}`);
    continue;
  }

  users.push({
    index: i,
    email,
    user_id: userId,
    access_token: session.session.access_token,
    refresh_token: session.session.refresh_token,
  });

  if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${N}`);
}

await writeFile(
  new URL("./test-users.json", import.meta.url),
  JSON.stringify({ created_at: new Date().toISOString(), count: users.length, users }, null, 2),
);

console.log(`\n✅ ${users.length}/${N} test users saved to scripts/loadtest/test-users.json`);
console.log(`Each user has a JWT valid for ~1 hour.`);
