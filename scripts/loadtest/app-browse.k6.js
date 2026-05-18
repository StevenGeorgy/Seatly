// k6 load test for the non-Cenaiva path — what a diner does when they BROWSE
// the app (Discover → restaurant detail → check availability).
//
// Each VU iterates through:
//   1. GET /restaurants?is_active=eq.true        (Discover list)
//   2. GET /restaurants?slug=eq.<one>            (Restaurant page)
//   3. GET /menu_categories + /menu_items        (menu sections)
//   4. RPC /get_available_slots_for_restaurants_compact  (Discover slot pills)
//   5. RPC /get_available_slots_cached           (per-restaurant slots)
//
// No authentication needed — all of these are anon-readable. No writes.
// No reservations created. Stops short of POSTing to create-public-booking.
//
// Usage:
//   k6 run scripts/loadtest/app-browse.k6.js
//
// Env vars:
//   STAGE       — baseline (10 VUs), ramp (10→500), or target (TARGET_VUS const)
//   TARGET_VUS  — used when STAGE=target

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";

const SUPABASE_URL = "https://exbjodmnpdiayfzrdyux.supabase.co";
const ANON_KEY = "sb_publishable_i3_kEbKihLNgMfFsR6VN0Q_npEw-bNz";

const STAGE = __ENV.STAGE ?? "ramp";
const TARGET_VUS = Number.parseInt(__ENV.TARGET_VUS ?? "100", 10);

const discover_latency = new Trend("discover_latency", true);
const detail_latency = new Trend("detail_latency", true);
const menu_latency = new Trend("menu_latency", true);
const compact_slots_latency = new Trend("compact_slots_latency", true);
const cached_slots_latency = new Trend("cached_slots_latency", true);

const step_success = new Rate("step_success");
const step_429 = new Counter("step_429");
const step_500 = new Counter("step_500");
const step_400 = new Counter("step_400");
const step_timeout = new Counter("step_timeout");

const HEADERS = {
  "Content-Type": "application/json",
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
};

function trackErr(res) {
  if (res.status === 429) step_429.add(1);
  else if (res.status >= 500) step_500.add(1);
  else if (res.status === 400) step_400.add(1);
  else if (res.status === 0) step_timeout.add(1);
}

function rampStages() {
  return [
    { duration: "30s", target: 10 },
    { duration: "45s", target: 10 },
    { duration: "30s", target: 50 },
    { duration: "45s", target: 50 },
    { duration: "30s", target: 100 },
    { duration: "60s", target: 100 },
    { duration: "30s", target: 250 },
    { duration: "60s", target: 250 },
    { duration: "30s", target: 500 },
    { duration: "60s", target: 500 },
    { duration: "30s", target: 0 },
  ];
}

export const options = {
  scenarios: {
    browse:
      STAGE === "baseline"
        ? { executor: "constant-vus", vus: 10, duration: "60s" }
        : STAGE === "target"
          ? { executor: "constant-vus", vus: TARGET_VUS, duration: "90s" }
          : { executor: "ramping-vus", startVUs: 0, stages: rampStages() },
  },
  thresholds: {
    step_success: ["rate>0.95"],
    "http_req_duration{tag:read}": ["p(95)<3000"],
  },
};

export default function () {
  // 1. Discover list
  const tA = Date.now();
  const r1 = http.get(
    `${SUPABASE_URL}/rest/v1/restaurants?select=id,name,slug,logo_url,cover_photo_url,description,address,city,cuisine_type,price_range,avg_rating,total_reviews,lat,lng&is_active=eq.true&is_published=eq.true&limit=20`,
    { headers: HEADERS, tags: { tag: "read" }, timeout: "20s" },
  );
  discover_latency.add(Date.now() - tA);
  trackErr(r1);
  const ok1 = check(r1, { "discover 200": (r) => r.status === 200 });
  step_success.add(ok1);
  if (!ok1) {
    sleep(2);
    return;
  }

  // Parse and pick a random restaurant
  let restaurants = [];
  try {
    restaurants = r1.json();
  } catch {
    return;
  }
  if (!restaurants.length) return;
  const r = restaurants[Math.floor(Math.random() * restaurants.length)];

  sleep(0.3);

  // 2. Restaurant detail — use the same safe-column projection the frontend does
  const tB = Date.now();
  const r2 = http.get(
    `${SUPABASE_URL}/rest/v1/restaurants?select=id,name,slug,logo_url,cover_photo_url,description,address,city,province,country,phone,email,hours_json,settings_json,deposit_tiers,cuisine_type,business_type,price_range,timezone,currency,lat,lng&slug=eq.${r.slug}&limit=1`,
    { headers: HEADERS, tags: { tag: "read" }, timeout: "20s" },
  );
  detail_latency.add(Date.now() - tB);
  trackErr(r2);
  step_success.add(check(r2, { "detail 200": (rr) => rr.status === 200 }));

  sleep(0.3);

  // 3. Menu categories + items
  const tC = Date.now();
  const r3 = http.get(
    `${SUPABASE_URL}/rest/v1/menu_items?select=id,name,description,price,category_id,photo_url,is_active,is_available&restaurant_id=eq.${r.id}&is_active=eq.true&limit=50`,
    { headers: HEADERS, tags: { tag: "read" }, timeout: "20s" },
  );
  menu_latency.add(Date.now() - tC);
  trackErr(r3);
  step_success.add(check(r3, { "menu 200": (rr) => rr.status === 200 }));

  sleep(0.3);

  // 4. Discover slot pills (the batched RPC)
  const ids = restaurants.slice(0, 6).map((x) => x.id);
  const tD = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const nowTime = new Date().toISOString().slice(11, 19);
  const r4 = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/get_available_slots_for_restaurants_compact`,
    JSON.stringify({
      p_restaurant_ids: ids,
      p_date: today,
      p_party_size: 2,
      p_target_time: nowTime,
    }),
    { headers: HEADERS, tags: { tag: "read" }, timeout: "20s" },
  );
  compact_slots_latency.add(Date.now() - tD);
  trackErr(r4);
  step_success.add(check(r4, { "compact slots ok": (rr) => rr.status < 400 }));

  sleep(0.5);

  // 5. Per-restaurant slot lookup (cached version)
  const tE = Date.now();
  const r5 = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/get_available_slots_cached`,
    JSON.stringify({
      p_restaurant_id: r.id,
      p_date: today,
      p_party_size: 2,
    }),
    { headers: HEADERS, tags: { tag: "read" }, timeout: "20s" },
  );
  cached_slots_latency.add(Date.now() - tE);
  trackErr(r5);
  step_success.add(check(r5, { "cached slots ok": (rr) => rr.status < 400 }));

  sleep(1.0);
}

export function handleSummary(data) {
  return {
    "stdout": textSummary(data),
    "scripts/loadtest/last-browse-run.json": JSON.stringify(data, null, 2),
  };
}

function textSummary(data) {
  const m = data.metrics ?? {};
  const dur = m["http_req_duration{tag:read}"]?.values ?? {};
  const success = m.step_success?.values ?? {};

  const trend = (name) => {
    const t = m[name]?.values ?? {};
    return `p50=${Math.round(t.med ?? 0)}ms  p95=${Math.round(t["p(95)"] ?? 0)}ms  p99=${Math.round(t["p(99)"] ?? 0)}ms`;
  };

  return `
═════════════════════════════════════════════════════════════
  APP BROWSE LOAD TEST (no Cenaiva)
═════════════════════════════════════════════════════════════
  Stage:           ${STAGE}
  Iterations:      ${m.iterations?.values?.count ?? 0}
  Total reqs:      ${m.http_reqs?.values?.count ?? 0}
  Step success:    ${((success.rate ?? 0) * 100).toFixed(1)}%

  HTTP p50:        ${Math.round(dur.med ?? 0)}ms
  HTTP p95:        ${Math.round(dur["p(95)"] ?? 0)}ms
  HTTP p99:        ${Math.round(dur["p(99)"] ?? 0)}ms

  Discover list:        ${trend("discover_latency")}
  Restaurant detail:    ${trend("detail_latency")}
  Menu items:           ${trend("menu_latency")}
  Compact slots RPC:    ${trend("compact_slots_latency")}
  Cached slots RPC:     ${trend("cached_slots_latency")}

  429 rate-limited:     ${m.step_429?.values?.count ?? 0}
  5xx server error:     ${m.step_500?.values?.count ?? 0}
  400 validation:       ${m.step_400?.values?.count ?? 0}
  timeouts:             ${m.step_timeout?.values?.count ?? 0}
═════════════════════════════════════════════════════════════
`;
}
