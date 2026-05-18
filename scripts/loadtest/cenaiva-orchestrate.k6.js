// k6 load test for the Cenaiva orchestrator pipeline.
// Reads scripts/loadtest/test-users.json (created by create-test-users.mjs)
// and simulates N concurrent diners, each doing a 3-turn conversation:
//   Turn 1: "what restaurants are near me?"
//   Turn 2: "tell me about a steakhouse"
//   Turn 3: "what times work for 4 people tomorrow at 7pm?"
//
// Stops short of actually booking — no reservations are created.
//
// Usage:
//   k6 run scripts/loadtest/cenaiva-orchestrate.k6.js
//
// Env vars:
//   STAGE       (default: ramp) — one of: baseline, ramp, target
//   TARGET_VUS  (default: 50)   — used when STAGE=target

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";
import { SharedArray } from "k6/data";
import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

const SUPABASE_URL = "https://exbjodmnpdiayfzrdyux.supabase.co";
const ORCHESTRATE_URL = `${SUPABASE_URL}/functions/v1/cenaiva-orchestrate`;
const ANON_KEY = "sb_publishable_i3_kEbKihLNgMfFsR6VN0Q_npEw-bNz";

// Load the pre-minted test user pool. Each VU picks one round-robin.
const users = new SharedArray("test-users", () =>
  JSON.parse(open("./test-users.json")).users,
);

// Custom metrics so we can see per-turn timing in the summary.
const turn1_latency = new Trend("turn1_latency", true);
const turn2_latency = new Trend("turn2_latency", true);
const turn3_latency = new Trend("turn3_latency", true);
const turn_success = new Rate("turn_success");
const turn_429 = new Counter("turn_429_rate_limited");
const turn_500 = new Counter("turn_500_server_error");
const turn_400 = new Counter("turn_400_validation");
const turn_timeout = new Counter("turn_timeout");

const STAGE = __ENV.STAGE ?? "ramp";
const TARGET_VUS = Number.parseInt(__ENV.TARGET_VUS ?? "50", 10);

function rampStages() {
  return [
    { duration: "30s", target: 5 },
    { duration: "60s", target: 5 },
    { duration: "30s", target: 10 },
    { duration: "60s", target: 10 },
    { duration: "30s", target: 25 },
    { duration: "90s", target: 25 },
    { duration: "30s", target: 50 },
    { duration: "90s", target: 50 },
    { duration: "30s", target: 100 },
    { duration: "60s", target: 100 },
    { duration: "30s", target: 0 },
  ];
}

export const options = {
  scenarios: {
    cenaiva:
      STAGE === "baseline"
        ? { executor: "constant-vus", vus: 5, duration: "90s" }
        : STAGE === "target"
          ? { executor: "constant-vus", vus: TARGET_VUS, duration: "120s" }
          : { executor: "ramping-vus", startVUs: 0, stages: rampStages() },
  },
  thresholds: {
    turn_success: ["rate>0.9"], // at least 90% turns succeed
    "http_req_duration{tag:orchestrate}": ["p(95)<15000"], // p95 < 15s
  },
  // 30s timeout per request — orchestrator p99 is ~8s, so 30s catches stuck calls
  noConnectionReuse: false,
};

function callOrchestrate(token, transcript, conversation_id, screen = "discover") {
  const body = JSON.stringify({
    transcript,
    transcript_alternatives: [],
    screen,
    booking_state: {},
    map_state: {},
    visible_restaurant_ids: [],
    selected_restaurant_id: null,
    user_location: null,
    timezone: "America/Toronto",
    conversation_id,
    has_saved_card: false,
    recommendation_mode: null,
    assistant_memory: null,
  });

  const res = http.post(ORCHESTRATE_URL, body, {
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    timeout: "30s",
    tags: { tag: "orchestrate" },
  });

  // Track failure types
  if (res.status === 429) turn_429.add(1);
  else if (res.status >= 500) turn_500.add(1);
  else if (res.status === 400) turn_400.add(1);
  else if (res.status === 0) turn_timeout.add(1);

  return res;
}

export default function () {
  // Pick a user from the pool round-robin (VU id 1-based, users 0-based)
  const user = users[(__VU - 1) % users.length];
  if (!user) {
    console.error(`No user for VU ${__VU}`);
    return;
  }

  const conversation_id = uuidv4();

  // Turn 1 — what restaurants
  const t1Start = Date.now();
  const r1 = callOrchestrate(user.access_token, "what restaurants are near me?", conversation_id);
  turn1_latency.add(Date.now() - t1Start);
  const ok1 = check(r1, {
    "turn 1 status 200": (r) => r.status === 200,
    "turn 1 has body": (r) => r.body && r.body.length > 0,
  });
  turn_success.add(ok1);

  if (!ok1) {
    sleep(2);
    return;
  }

  sleep(1); // simulate user reading the response

  // Turn 2 — ask about a specific restaurant
  const t2Start = Date.now();
  const r2 = callOrchestrate(user.access_token, "tell me about a steakhouse", conversation_id);
  turn2_latency.add(Date.now() - t2Start);
  const ok2 = check(r2, {
    "turn 2 status 200": (r) => r.status === 200,
  });
  turn_success.add(ok2);

  if (!ok2) {
    sleep(2);
    return;
  }

  sleep(1);

  // Turn 3 — availability question (stops short of booking)
  const t3Start = Date.now();
  const r3 = callOrchestrate(
    user.access_token,
    "what times work for 4 people tomorrow at 7pm?",
    conversation_id,
  );
  turn3_latency.add(Date.now() - t3Start);
  const ok3 = check(r3, {
    "turn 3 status 200": (r) => r.status === 200,
  });
  turn_success.add(ok3);

  // Pace — give the next iteration some breathing room
  sleep(2);
}

export function handleSummary(data) {
  return {
    "stdout": textSummary(data),
    "scripts/loadtest/last-run.json": JSON.stringify(data, null, 2),
  };
}

// Minimal text summary inline (avoids importing the lib)
function textSummary(data) {
  const m = data.metrics ?? {};
  const t1 = m.turn1_latency?.values ?? {};
  const t2 = m.turn2_latency?.values ?? {};
  const t3 = m.turn3_latency?.values ?? {};
  const dur = m["http_req_duration{tag:orchestrate}"]?.values ?? {};
  const success = m.turn_success?.values ?? {};

  return `
═════════════════════════════════════════════════════════════
  CENAIVA ORCHESTRATE LOAD TEST RESULTS
═════════════════════════════════════════════════════════════
  Stage:          ${STAGE}
  Total iters:    ${m.iterations?.values?.count ?? 0}
  Total reqs:     ${m.http_reqs?.values?.count ?? 0}
  Failed reqs:    ${m.http_req_failed?.values?.passes ?? 0}

  Turn success rate:         ${((success.rate ?? 0) * 100).toFixed(1)}%
  HTTP p50:                  ${Math.round(dur.med ?? 0)}ms
  HTTP p95:                  ${Math.round(dur["p(95)"] ?? 0)}ms
  HTTP p99:                  ${Math.round(dur["p(99)"] ?? 0)}ms

  Turn 1 (what restaurants) p95:  ${Math.round(t1["p(95)"] ?? 0)}ms
  Turn 2 (tell me about)    p95:  ${Math.round(t2["p(95)"] ?? 0)}ms
  Turn 3 (availability)     p95:  ${Math.round(t3["p(95)"] ?? 0)}ms

  Rate-limited (429):        ${m.turn_429_rate_limited?.values?.count ?? 0}
  Server errors (5xx):       ${m.turn_500_server_error?.values?.count ?? 0}
  Validation errors (400):   ${m.turn_400_validation?.values?.count ?? 0}
  Timeouts:                  ${m.turn_timeout?.values?.count ?? 0}
═════════════════════════════════════════════════════════════
`;
}
