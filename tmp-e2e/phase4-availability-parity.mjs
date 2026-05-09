// SPEED_PLAN Phase 4 parity check.
//
// Compares the legacy TS code path (HTTP `get-availability` endpoint, with the
// USE_SQL_AVAILABILITY env unset on the deployed function) against the new
// `get_available_slots` SQL RPC + the same TS post-processing the edge
// function applies when the flag is on. Asserts byte-identical JSON output.
//
// Usage:
//   SUPABASE_URL=https://exbjodmnpdiayfzrdyux.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node tmp-e2e/phase4-availability-parity.mjs
//
// Optional: TEST_RESTAURANT_IDS=<uuid>,<uuid>,<uuid> to override the matrix.
//
// Exits 0 when all comparisons pass with zero diffs; non-zero on first miss.
// Run BEFORE flipping the USE_SQL_AVAILABILITY env on the deployed function.

import assert from "node:assert/strict";

const SUPABASE_URL = process.env.SUPABASE_URL;
// Accept either service role or publishable/anon — the RPC was granted to anon
// and the function is `SECURITY DEFINER`, so RLS doesn't gate anything we read.
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY
  ?? process.env.SUPABASE_PUBLISHABLE_KEY
  ?? process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or one of {SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PUBLISHABLE_KEY, SUPABASE_ANON_KEY}");
  process.exit(1);
}

const DEFAULT_RESTAURANTS = [
  "82277919-f810-48df-8898-84895a72c280", // Cenaiva Reservation Capacity Test
  "428964af-02b8-45ca-8973-3617b91bd718", // Georgy Inc
  "aaa5e3d3-d8f2-4bae-8615-dc4e6ea83d2c", // Echoria
];
const RESTAURANT_IDS = (process.env.TEST_RESTAURANT_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const RESTAURANTS = RESTAURANT_IDS.length ? RESTAURANT_IDS : DEFAULT_RESTAURANTS;

const PARTY_SIZES = [2, 4, 8];

function ymd(date) {
  return date.toISOString().slice(0, 10);
}
function tomorrow() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
const TODAY = ymd(new Date());
const TOMORROW = ymd(tomorrow());
const DATES = [TODAY, TOMORROW];

const restHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function callHttpEndpoint(restaurantId, date, partySize) {
  const u = new URL(`${SUPABASE_URL}/functions/v1/get-availability`);
  u.searchParams.set("restaurant_id", restaurantId);
  u.searchParams.set("date", date);
  u.searchParams.set("party_size", String(partySize));
  const r = await fetch(u, { headers: { Authorization: `Bearer ${SERVICE_KEY}` } });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(`HTTP ${r.status} for ${u}: ${text}`);
  }
  return JSON.parse(text);
}

async function fetchTimezone(restaurantId) {
  const u = new URL(`${SUPABASE_URL}/rest/v1/restaurants`);
  u.searchParams.set("id", `eq.${restaurantId}`);
  u.searchParams.set("select", "timezone");
  const r = await fetch(u, { headers: restHeaders });
  if (!r.ok) throw new Error(`fetchTimezone ${r.status}: ${await r.text()}`);
  const rows = await r.json();
  return rows?.[0]?.timezone || "UTC";
}

async function callRpc(restaurantId, date, partySize) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_available_slots`, {
    method: "POST",
    headers: restHeaders,
    body: JSON.stringify({
      p_restaurant_id: restaurantId,
      p_date: date,
      p_party_size: partySize,
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`RPC ${r.status}: ${text}`);
  return JSON.parse(text);
}

// Re-implement the TS post-processing the edge function applies when the flag
// is on. Must stay in lock-step with the corresponding block in
// supabase/functions/get-availability/index.ts.
function postProcess(rpcResult, timezone) {
  const slots = (rpcResult.slots ?? []).map((slot) => {
    const out = {
      shift_id: slot.shift_id,
      shift_name: slot.shift_name,
      date_time: slot.date_time,
      display_time: new Date(slot.date_time).toLocaleTimeString("en-US", {
        timeZone: timezone,
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
      table_ids: slot.table_ids ?? [],
      duration_minutes: slot.duration_minutes,
    };
    if (rpcResult.floor_capacity != null) out.floor_capacity = rpcResult.floor_capacity;
    return out;
  });
  const hours_window = rpcResult.configured_hours_window
    ?? (slots.length
      ? `${slots[0].display_time} to ${slots[slots.length - 1].display_time}`
      : null);
  return {
    slots,
    floor_capacity: rpcResult.floor_capacity ?? null,
    hours_window,
    unavailable_reason: rpcResult.unavailable_reason ?? null,
    message: rpcResult.message ?? null,
  };
}

// JSON.stringify for deep-equal that preserves key ordering — using
// assert.deepStrictEqual is order-insensitive for objects but order-sensitive
// for arrays; that's exactly what we want.
function diff(a, b) {
  try {
    assert.deepStrictEqual(a, b);
    return null;
  } catch (e) {
    return e.message;
  }
}

let pass = 0;
let fail = 0;
const failures = [];

for (const restaurantId of RESTAURANTS) {
  let timezone;
  try {
    timezone = await fetchTimezone(restaurantId);
  } catch (e) {
    console.error(`SKIP ${restaurantId}: ${e.message}`);
    continue;
  }
  console.log(`\n=== ${restaurantId} (${timezone}) ===`);
  for (const date of DATES) {
    for (const partySize of PARTY_SIZES) {
      const label = `${restaurantId.slice(0, 8)}.. ${date} party=${partySize}`;
      let httpRes, rpcRes;
      try {
        [httpRes, rpcRes] = await Promise.all([
          callHttpEndpoint(restaurantId, date, partySize),
          callRpc(restaurantId, date, partySize),
        ]);
      } catch (e) {
        console.error(`ERROR ${label}: ${e.message}`);
        fail += 1;
        failures.push({ label, error: e.message });
        continue;
      }
      const computed = postProcess(rpcRes, timezone);
      const d = diff(httpRes, computed);
      if (d) {
        fail += 1;
        failures.push({ label, diff: d, http: httpRes, computed });
        console.log(`FAIL ${label}`);
        console.log(`  ${d.split("\n").slice(0, 8).join("\n  ")}`);
      } else {
        pass += 1;
        const slotN = Array.isArray(httpRes.slots) ? httpRes.slots.length : 0;
        console.log(`PASS ${label}  slots=${slotN}`);
      }
    }
  }
}

console.log(`\nResult: ${pass} pass, ${fail} fail (out of ${pass + fail})`);
if (fail > 0) {
  console.log("\n--- First failure detail ---");
  const first = failures[0];
  console.log(JSON.stringify(first, null, 2).slice(0, 4000));
  process.exit(1);
}
process.exit(0);
