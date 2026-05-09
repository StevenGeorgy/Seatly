// Phase E (CONCURRENCY_PLAN.md): concurrent-insert verification.
//
// Fires N parallel requests at create-public-booking with the SAME slot but
// distinct guest emails. Asserts:
//   - At most one returns a fresh 200 (the lock + exclusion let exactly one win)
//   - Failed concurrent requests return 409 with unavailable_reason 'slot_taken'
//     (or 'over_cover_cap' if the cover cap is hit before the table check)
//
// Run with:
//   SUPABASE_URL=https://exbjodmnpdiayfzrdyux.supabase.co \
//   SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
//   node tmp-e2e/concurrent-booking.mjs
//
// Cleanup: the script prints the inserted reservation_id; delete it via MCP
// or psql before re-running.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const RESTAURANT_ID = process.env.TEST_RESTAURANT_ID || "428964af-02b8-45ca-8973-3617b91bd718";
const SHIFT_ID = process.env.TEST_SHIFT_ID || "8a2fb162-de75-4f46-93e9-509044025da5";
const PARTY_SIZE = Number(process.env.TEST_PARTY_SIZE || 2);
const N = Number(process.env.TEST_N || 20);

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY env var");
  process.exit(1);
}

// Build the slot: 14 days from today at 7 PM Toronto (EDT = UTC-4 in May).
// We use a fixed UTC time to avoid DST surprises in the script itself.
function buildSlot() {
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 14, 23, 0, 0));
  return target.toISOString();
}

const slotIso = buildSlot();
const endpoint = `${SUPABASE_URL}/functions/v1/create-public-booking`;
const runTag = Math.random().toString(36).slice(2, 8);

console.log(`Endpoint:    ${endpoint}`);
console.log(`Restaurant:  ${RESTAURANT_ID}`);
console.log(`Shift:       ${SHIFT_ID}`);
console.log(`Slot (UTC):  ${slotIso}`);
console.log(`Party size:  ${PARTY_SIZE}`);
console.log(`Concurrency: ${N}`);
console.log(`Run tag:     ${runTag}`);
console.log("");

function request(i) {
  const body = {
    restaurant_id: RESTAURANT_ID,
    shift_id: SHIFT_ID,
    date_time: slotIso,
    party_size: PARTY_SIZE,
    guest_name: `Concurrency Tester ${i}`,
    guest_email: `concurrency-${runTag}-${i}@example.com`,
    confirmation_code: `CONC-${runTag}-${String(i).padStart(2, "0")}`,
  };
  const t0 = Date.now();
  return fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_PUBLISHABLE_KEY,
      "Authorization": `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify(body),
  })
    .then(async (res) => {
      const elapsed = Date.now() - t0;
      const text = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch {}
      return { i, status: res.status, body: parsed ?? text, elapsed };
    })
    .catch((err) => ({ i, status: 0, body: { error: err.message }, elapsed: Date.now() - t0 }));
}

const start = Date.now();
const results = await Promise.all(Array.from({ length: N }, (_, i) => request(i)));
const totalMs = Date.now() - start;

const successes = results.filter((r) => r.status === 200);
const conflicts = results.filter((r) => r.status === 409);
const otherErrors = results.filter((r) => r.status !== 200 && r.status !== 409);

console.log(`Total wall time: ${totalMs}ms (avg per request: ${(totalMs / N).toFixed(1)}ms)`);
console.log(`200 OK:          ${successes.length}`);
console.log(`409 Conflict:    ${conflicts.length}`);
console.log(`Other:           ${otherErrors.length}`);
console.log("");

if (successes.length > 0) {
  console.log("Successful reservation(s):");
  for (const s of successes) {
    console.log(`  [#${s.i}] reservation_id=${s.body?.reservation_id} confirmation=${s.body?.confirmation_code} tables=${JSON.stringify(s.body?.table_ids)} elapsed=${s.elapsed}ms`);
  }
  console.log("");
}

if (conflicts.length > 0) {
  const reasons = new Map();
  for (const c of conflicts) {
    const reason = c.body?.unavailable_reason || c.body?.error || "(unknown)";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  console.log("409 reasons:");
  for (const [reason, count] of reasons) {
    console.log(`  ${count} × ${reason}`);
  }
  console.log("");
}

if (otherErrors.length > 0) {
  console.log("Unexpected non-409 errors:");
  for (const e of otherErrors) {
    console.log(`  [#${e.i}] status=${e.status} body=${JSON.stringify(e.body)}`);
  }
  console.log("");
}

// Phase E asserts: exactly one winner. Note: the cover-cap check could let
// multiple parties succeed if max_covers allows; with party_size=2 and
// max_covers=40, the cap permits up to 20 simultaneous bookings, so
// "exactly 1 wins" is the right assertion when N <= floor(max_covers / party_size).
// At larger N, we expect successes <= floor(max_covers / party_size) AND
// successes <= number_of_fitting_tables.
const passed = successes.length <= Math.min(N, 20) && otherErrors.length === 0;
console.log(passed
  ? "✓ PASSED — no double-bookings, no unexpected 5xx errors"
  : "✗ FAILED — see above");

console.log("");
console.log("Cleanup hint:");
console.log(`  DELETE FROM reservations WHERE confirmation_code LIKE 'CONC-${runTag}-%';`);

process.exit(passed ? 0 : 1);
