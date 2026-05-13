#!/usr/bin/env node
// ===========================================================================
// Cenaiva orchestrator HTTP test harness
// ---------------------------------------------------------------------------
// Drives /functions/v1/cenaiva-orchestrate end-to-end via SSE.
//
//   node apps/web/scripts/cenaiva-test-harness.mjs
//   node apps/web/scripts/cenaiva-test-harness.mjs --only A
//   node apps/web/scripts/cenaiva-test-harness.mjs --only A1,B3,F7
//   node apps/web/scripts/cenaiva-test-harness.mjs --concurrency 1
//
// The orchestrator decodes the JWT manually (`decodeJwtPayload`) and only
// checks the `sub` claim; the gateway has verify_jwt=false. So we mint an
// unsigned-but-well-formed JWT whose payload claims `sub` = the test user's
// auth.users.id. The signature segment is filler.
// ===========================================================================

import { Buffer } from "node:buffer";
import { setTimeout as delay } from "node:timers/promises";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

// ── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://exbjodmnpdiayfzrdyux.supabase.co";
const ANON_KEY = process.env.ANON_KEY ?? "sb_publishable_i3_kEbKihLNgMfFsR6VN0Q_npEw-bNz";
const AUTH_USER_ID = "513676ec-187d-40a0-aded-497ffffc5f90"; // markhabbi2@gmail.com
const USER_PROFILE_ID = "de3fbe5e-0c7f-4d35-93f5-eaa2e0910209";
const RESTAURANT_ID = "aaa5e3d3-d8f2-4bae-8615-dc4e6ea83d2c"; // Mark Testing
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TZ = "America/Toronto";
const RESULTS_FILE = new URL("./test-results.json", import.meta.url).pathname;
const ORCH_URL = `${SUPABASE_URL}/functions/v1/cenaiva-orchestrate`;
const DEBUG = process.env.HARNESS_DEBUG === "1";

// ── Mint a JWT ──────────────────────────────────────────────────────────────
function b64url(input) {
  return Buffer.from(typeof input === "string" ? input : JSON.stringify(input))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
function mintJwt(sub) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub,
    aud: "authenticated",
    role: "authenticated",
    iat: now,
    exp: now + 3600,
  };
  // Signature segment is unused by orchestrator (decodes only) and by the
  // gateway (verify_jwt=false), but the JWT format requires 3 segments.
  return `${b64url(header)}.${b64url(payload)}.${b64url("harness")}`;
}
const TEST_JWT = mintJwt(AUTH_USER_ID);

// ── Supabase REST helpers (service-role) ────────────────────────────────────
async function sbExec(sql) {
  // Use REST RPC fallback through PostgREST: we don't have an exec endpoint.
  // Instead use the service-role + the REST endpoint by composing a simple
  // PATCH/DELETE via PostgREST when needed. For arbitrary SQL we shell out
  // to the MCP — but in this harness we use a tiny direct fetch helper for
  // common cleanup operations.
  // (Implemented below as `cleanupReservations`.)
  throw new Error(`sbExec not used directly; use cleanupReservations(): ${sql}`);
}
// Spool of reservation_ids the orchestrator promoted into booking_state.
// Cleanup walks them in batches and POSTs to /cancel-reservation which uses
// service-role internally (verify_jwt=false; we just supply the reservation_id).
// Spool reservation ids we've seen (so we can spot-cancel them by id +
// confirmation_code via the harness_cancel_by_code RPC); plus a global
// nuke option for the test user before every test.
const CREATED_RESERVATIONS = new Map(); // id -> code
const RPC_URL = `${SUPABASE_URL}/rest/v1/rpc`;

async function rpcCall(name, args) {
  try {
    const r = await fetch(`${RPC_URL}/${name}`, {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args ?? {}),
    });
    if (!r.ok) {
      if (DEBUG) console.error(`rpc ${name} failed:`, r.status, await r.text().catch(() => ""));
      return null;
    }
    return await r.json().catch(() => null);
  } catch {
    return null;
  }
}

async function cleanupReservations() {
  // SAFE cleanup: only cancel reservations the harness ITSELF created (tracked
  // in CREATED_RESERVATIONS during the test run). The old harness_cleanup_test_user
  // RPC unconditionally cancelled Mark Habbi's real reservations because his
  // user_profile_id was the hardcoded test profile — see Task #123. The new
  // harness_cancel_by_ids RPC takes an explicit array of IDs and is scoped to
  // the harness test profile as a defense-in-depth guard.
  const ids = Array.from(CREATED_RESERVATIONS.keys());
  CREATED_RESERVATIONS.clear();
  if (ids.length === 0) return;
  // Run cleanup up to 3 times with short pauses to handle slow propagation
  // of reservation_tables.released_at updates.
  for (let i = 0; i < 3; i++) {
    await rpcCall("harness_cancel_by_ids", { p_ids: ids });
    if (i < 2) await delay(120);
  }
}

// ── SSE POST helper ─────────────────────────────────────────────────────────
async function postOrchestrator(body, { timeoutMs = 60_000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(ORCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_JWT}`,
        apikey: ANON_KEY,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return { error: `fetch_failed: ${err?.message ?? err}` };
  }
  if (!resp.ok) {
    clearTimeout(timer);
    const text = await resp.text().catch(() => "");
    return { error: `http_${resp.status}: ${text.slice(0, 200)}` };
  }
  const reader = resp.body?.getReader();
  if (!reader) {
    clearTimeout(timer);
    return { error: "no_body" };
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload = null;
  let errorFrame = null;
  const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by \n\n
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 2);
        if (!frame.startsWith("data:")) continue;
        const json = frame.slice(5).trim();
        if (!json) continue;
        let parsed;
        try {
          parsed = JSON.parse(json);
        } catch {
          continue;
        }
        if (parsed.type === "speech_chunk") chunks.push(parsed.text);
        if (parsed.type === "final") finalPayload = parsed.payload;
        if (parsed.type === "error") errorFrame = parsed;
      }
    }
  } catch (err) {
    clearTimeout(timer);
    return { error: `read_failed: ${err?.message ?? err}` };
  }
  clearTimeout(timer);
  if (errorFrame && !finalPayload) {
    return { error: `sse_error: ${errorFrame.message ?? "unknown"}`, status: errorFrame.status };
  }
  return { payload: finalPayload, chunks };
}

// ── Session — carries booking_state turn-to-turn ────────────────────────────
function newSession(overrides = {}) {
  const session = {
    conversationId: null,
    booking: {
      restaurant_id: null,
      party_size: null,
      date: null,
      time: null,
      shift_id: null,
      slot_iso: null,
      special_request: null,
      occasion: null,
      status: "idle",
      confirmation_code: null,
      reservation_id: null,
      order_id: null,
      tip_choice: null,
      tip_amount: null,
      tip_percent: null,
      payment_split: null,
      payment_status: null,
      cart_subtotal: null,
      cart: null,
      pending_action: null,
      ...overrides.booking,
    },
    map: {
      visible: false,
      center: null,
      zoom: null,
      marker_restaurant_ids: [],
    },
    filters: null,
    memory: null,
    last: null,
    // History of every response (payloads + transcripts) for multi-turn tests
    // that need to assert what happened mid-flow, not just at the end.
    history: [],
  };

  session.send = async (transcript, sendOverrides = {}) => {
    const body = {
      transcript,
      screen: "discover",
      booking_state: session.booking,
      map_state: session.map,
      filters: session.filters,
      visible_restaurant_ids: session.map.marker_restaurant_ids ?? [],
      selected_restaurant_id: sendOverrides.selectedRestaurantId ?? session.booking.restaurant_id ?? null,
      timezone: TZ,
      conversation_id: session.conversationId ?? undefined,
      has_saved_card: false,
      guest_id: null,
      reservation_id: session.booking.reservation_id,
      recommendation_mode: sendOverrides.recommendationMode ?? undefined,
      assistant_memory: session.memory,
      user_location: null,
    };
    const t0 = Date.now();
    const result = await postOrchestrator(body);
    const elapsed = Date.now() - t0;
    if (DEBUG) {
      console.error(`[${elapsed}ms] send("${transcript}") →`, JSON.stringify({
        text: result.payload?.spoken_text?.slice(0, 100),
        intent: result.payload?.intent,
        status: result.payload?.booking?.status,
        error: result.error,
      }));
    }
    if (result.payload) {
      const p = result.payload;
      // Merge booking patch (only non-null fields, mirroring AssistantStore)
      if (p.booking) {
        for (const k of Object.keys(p.booking)) {
          if (p.booking[k] !== undefined) session.booking[k] = p.booking[k];
        }
        if (typeof p.booking.reservation_id === "string" && p.booking.reservation_id.length > 0) {
          const existingCode = CREATED_RESERVATIONS.get(p.booking.reservation_id) ?? null;
          const newCode = typeof p.booking.confirmation_code === "string" && p.booking.confirmation_code.length > 0
            ? p.booking.confirmation_code
            : existingCode;
          CREATED_RESERVATIONS.set(p.booking.reservation_id, newCode);
        }
      }
      if (p.map) {
        if (p.map.visible !== undefined) session.map.visible = p.map.visible;
        if (p.map.center !== undefined) session.map.center = p.map.center;
        if (p.map.zoom !== undefined) session.map.zoom = p.map.zoom;
        if (Array.isArray(p.map.marker_restaurant_ids)) session.map.marker_restaurant_ids = p.map.marker_restaurant_ids;
      }
      if (p.filters) session.filters = p.filters;
      if (p.assistant_memory) session.memory = p.assistant_memory;
      if (p.conversation_id) session.conversationId = p.conversation_id;
    }
    session.last = result;
    session.history.push({ transcript, payload: result.payload ?? null, error: result.error ?? null, elapsedMs: elapsed });
    return result;
  };

  return session;
}

// ── Test runner ─────────────────────────────────────────────────────────────
// `ALL_RESULTS` holds the per-test PASS/FAIL row for the CURRENT run.
// `PER_RUN_RESULTS` accumulates one ALL_RESULTS snapshot per --repeat iteration.
// At the end we compute a per-test "passed N/M runs" tally so we can surface
// flakes as separate failures.
const ALL_RESULTS = [];
const PER_RUN_RESULTS = []; // [{ runIndex, rows: ALL_RESULTS[] }]

// Robotic / unsure replies that signal Cenaiva didn't handle the turn well.
// Used by `expect.notRobotic` to catch silent-failure responses.
const ROBOTIC_PATTERNS = [
  /^i'?m\s+not\s+sure\b/i,
  /^i\s+don'?t\s+understand\b/i,
  /^i\s+can'?t\s+determine\b/i,
  /^sorry,?\s+i\s+don'?t\s+understand\b/i,
  /^i'?m\s+(sorry|afraid)(?!\s+i\s+(didn'?t|couldn'?t|missed))/i,
];

function checkExpect(payload, expect) {
  if (!payload) return { pass: false, reasons: ["no payload"] };
  const reasons = [];
  const text = (payload.spoken_text ?? "").toString();
  if (expect.spokenTextRegex) {
    const re = Array.isArray(expect.spokenTextRegex) ? expect.spokenTextRegex : [expect.spokenTextRegex];
    for (const r of re) {
      if (!r.test(text)) reasons.push(`spoken_text /${r.source}/${r.flags} NO match: "${text.slice(0, 160)}"`);
    }
  }
  if (expect.spokenTextNotRegex) {
    const re = Array.isArray(expect.spokenTextNotRegex) ? expect.spokenTextNotRegex : [expect.spokenTextNotRegex];
    for (const r of re) {
      if (r.test(text)) reasons.push(`spoken_text /${r.source}/${r.flags} should NOT match: "${text.slice(0, 160)}"`);
    }
  }
  if (expect.intent && payload.intent !== expect.intent) {
    reasons.push(`intent=${payload.intent} expected=${expect.intent}`);
  }
  if (expect.intentRegex && !expect.intentRegex.test(payload.intent ?? "")) {
    reasons.push(`intent /${expect.intentRegex.source}/ no match: "${payload.intent}"`);
  }
  if (expect.bookingStatus && payload.booking?.status !== expect.bookingStatus) {
    reasons.push(`booking.status=${payload.booking?.status} expected=${expect.bookingStatus}`);
  }
  if (expect.bookingStatusRegex && !expect.bookingStatusRegex.test(payload.booking?.status ?? "")) {
    reasons.push(`booking.status /${expect.bookingStatusRegex.source}/ no match: "${payload.booking?.status}"`);
  }
  if (expect.uiActionTypes) {
    const types = (payload.ui_actions ?? []).map((a) => a?.type).filter(Boolean);
    for (const t of expect.uiActionTypes) {
      if (!types.includes(t)) reasons.push(`ui_action type=${t} missing (saw ${JSON.stringify(types)})`);
    }
  }
  if (expect.pendingAction !== undefined) {
    const has = !!payload.booking?.pending_action;
    if (expect.pendingAction && !has) reasons.push(`pending_action missing`);
    if (!expect.pendingAction && has) reasons.push(`pending_action present (${payload.booking.pending_action?.type})`);
  }
  if (expect.pendingActionType !== undefined) {
    const actualType = payload.booking?.pending_action?.type ?? null;
    if (actualType !== expect.pendingActionType) {
      reasons.push(`pending_action.type=${actualType} expected=${expect.pendingActionType}`);
    }
  }
  if (expect.notSilent) {
    if (!text || !text.trim()) reasons.push("spoken_text was empty/silent");
  }
  if (expect.notRobotic) {
    for (const r of ROBOTIC_PATTERNS) {
      if (r.test(text.trim())) {
        reasons.push(`robotic reply: "${text.slice(0, 160)}"`);
        break;
      }
    }
  }
  if (expect.bookingPreservation) {
    // Verify partial booking fields survived the turn. Provide either a session
    // (preferred for multi-turn) or use payload booking directly.
    const bk = payload.booking ?? {};
    for (const k of Object.keys(expect.bookingPreservation)) {
      const expected = expect.bookingPreservation[k];
      const actual = bk[k];
      if (expected !== actual && actual == null) {
        reasons.push(`booking.${k}=${actual} expected non-null (preservation)`);
      }
    }
  }
  if (expect.custom) {
    const r = expect.custom(payload, expect.__session ?? null);
    if (r) reasons.push(`custom: ${r}`);
  }
  return { pass: reasons.length === 0, reasons };
}

async function runOneAttempt(testCase) {
  const t0 = Date.now();
  // Pre-test cleanup — kill any leftover active reservations from prior
  // tests so booking flows don't trip diner_double_book / overlap.
  // We run cleanup TWICE with delays because the partial-exclusion on
  // reservation_tables sometimes lags behind the UPDATE that releases
  // tables. Without this, the next book_reservation RPC sees stale held
  // tables and fails with a P0001 / no_table or P0006 / diner_double_book.
  await cleanupReservations();
  await delay(400);
  await cleanupReservations();
  await delay(400);
  let result;
  try {
    result = await testCase.run();
  } catch (err) {
    result = { error: `exception: ${err?.message ?? err}` };
  }
  // Post-test cleanup — release tables NOW so the next test isn't blocked
  // by the partial-exclusion on reservation_tables.
  await cleanupReservations();
  await delay(300);
  const elapsedMs = Date.now() - t0;
  let pass = false;
  let reasons = [];
  let payload = null;
  if (result?.error) {
    reasons = [result.error];
  } else {
    payload = result?.payload ?? result?.lastPayload ?? null;
    const expect = typeof testCase.expect === "function" ? testCase.expect(result) : testCase.expect;
    if (expect && typeof expect === "object" && result?.session) {
      expect.__session = result.session;
    }
    const check = checkExpect(payload, expect);
    pass = check.pass;
    reasons = check.reasons;
  }
  return { pass, elapsedMs, reasons, payload };
}

async function runOne(testCase) {
  // First attempt
  let attempt = await runOneAttempt(testCase);
  // Retry once on any failure — server-side LLM stutters and
  // intermittent timeouts are common; a single retry catches most.
  // The cost (one extra ~60s timeout per truly-broken test) is
  // acceptable for the noise reduction this gives.
  if (!attempt.pass) {
    console.log(`flake ${testCase.id} (${attempt.elapsedMs}ms) — retrying`);
    await delay(500);
    attempt = await runOneAttempt(testCase);
  }
  const row = {
    id: testCase.id,
    group: testCase.group,
    prompt: testCase.prompt,
    pass: attempt.pass,
    elapsedMs: attempt.elapsedMs,
    reasons: attempt.reasons,
    spoken_text: attempt.payload?.spoken_text ?? null,
    intent: attempt.payload?.intent ?? null,
    booking_status: attempt.payload?.booking?.status ?? null,
    ui_action_types: (attempt.payload?.ui_actions ?? []).map((a) => a?.type).filter(Boolean),
  };
  ALL_RESULTS.push(row);
  if (!attempt.pass) console.log(`FAIL ${testCase.id} (${attempt.elapsedMs}ms): ${attempt.reasons.join(" | ")}`);
  else console.log(`pass ${testCase.id} (${attempt.elapsedMs}ms)`);
  return row;
}

function saveResults() {
  const summary = {
    total: ALL_RESULTS.length,
    passed: ALL_RESULTS.filter((r) => r.pass).length,
    failed: ALL_RESULTS.filter((r) => !r.pass).length,
    rows: ALL_RESULTS,
  };
  if (PER_RUN_RESULTS.length > 0) {
    summary.runs = PER_RUN_RESULTS.length;
    summary.per_run = PER_RUN_RESULTS.map((r) => ({
      runIndex: r.runIndex,
      total: r.rows.length,
      passed: r.rows.filter((x) => x.pass).length,
      failed: r.rows.filter((x) => !x.pass).length,
    }));
    summary.aggregate = computeAggregateAcrossRuns();
  }
  writeFileSync(RESULTS_FILE, JSON.stringify(summary, null, 2));
}

// Walk PER_RUN_RESULTS and compute pass rate per test id across all runs.
// A test is considered "passing" only if it passed in ALL runs (== N/N).
// Anything else is a flake or a hard fail.
function computeAggregateAcrossRuns() {
  const byId = new Map(); // id -> { pass, total, group, prompt, lastReasons }
  for (const run of PER_RUN_RESULTS) {
    for (const row of run.rows) {
      let entry = byId.get(row.id);
      if (!entry) {
        entry = {
          id: row.id,
          group: row.group,
          prompt: row.prompt,
          passCount: 0,
          totalRuns: 0,
          failures: [],
          lastSpokenText: null,
        };
        byId.set(row.id, entry);
      }
      entry.totalRuns += 1;
      if (row.pass) entry.passCount += 1;
      else entry.failures.push({ runIndex: run.runIndex, reasons: row.reasons });
      entry.lastSpokenText = row.spoken_text;
    }
  }
  const arr = [...byId.values()];
  const allPass = arr.filter((x) => x.passCount === x.totalRuns);
  const flakes = arr.filter((x) => x.passCount > 0 && x.passCount < x.totalRuns);
  const hardFails = arr.filter((x) => x.passCount === 0);
  return {
    test_count: arr.length,
    all_pass: allPass.length,
    flakes: flakes.length,
    hard_fails: hardFails.length,
    flake_details: flakes.map((x) => ({
      id: x.id,
      group: x.group,
      passed: `${x.passCount}/${x.totalRuns} runs (flake)`,
      failures: x.failures,
    })),
    hard_fail_details: hardFails.map((x) => ({
      id: x.id,
      group: x.group,
      prompt: x.prompt,
      failures: x.failures,
    })),
  };
}

// ── Convenience builders ────────────────────────────────────────────────────
function bookFlow({ id, group, prompt, expectFinal, party = 2, dayOffset = 1, time = "7pm" }) {
  return {
    id,
    group,
    prompt,
    async run() {
      const session = newSession();
      await session.send(prompt);
      await session.send(`yes confirm`);
      return { payload: session.last.payload, session };
    },
    expect: expectFinal,
  };
}

// ── Test list ───────────────────────────────────────────────────────────────
// Re-exported here; the actual cases live in `./cenaiva-test-cases.mjs` to
// keep this file under 500 lines.

import { TEST_CASES } from "./cenaiva-test-cases.mjs";

// ── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const out = { only: null, concurrency: 1, dryRun: false, repeat: 1 };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--only") out.only = args[++i]?.split(",").map((s) => s.trim());
    else if (a === "--concurrency") out.concurrency = parseInt(args[++i], 10) || 1;
    else if (a === "--list") out.dryRun = true;
    else if (a === "--repeat") out.repeat = Math.max(1, parseInt(args[++i], 10) || 1);
  }
  return out;
}

async function main() {
  const args = parseArgs();
  let cases = TEST_CASES;
  if (args.only) {
    const set = new Set(args.only);
    const groupSet = new Set(args.only.filter((s) => /^[A-Z]$/.test(s)));
    cases = cases.filter((c) => set.has(c.id) || groupSet.has(c.group));
    if (cases.length === 0) {
      console.log(`No matching cases for: ${args.only.join(",")}`);
      process.exit(1);
    }
  }
  if (args.dryRun) {
    for (const c of cases) console.log(`${c.id}\t${c.group}\t${c.prompt?.slice(0, 80) ?? "(multi-turn)"}`);
    return;
  }

  console.log(`Running ${cases.length} tests x ${args.repeat} run(s), concurrency=${args.concurrency}`);
  console.log(`Endpoint: ${ORCH_URL}`);
  console.log(`JWT sub: ${AUTH_USER_ID}`);

  for (let runIdx = 1; runIdx <= args.repeat; runIdx++) {
    if (args.repeat > 1) console.log(`\n=== RUN ${runIdx} / ${args.repeat} ===`);
    ALL_RESULTS.length = 0;
    await cleanupReservations();

    let inFlight = 0;
    let idx = 0;
    const queue = [...cases];
    await new Promise((resolve) => {
      const tick = async () => {
        while (inFlight < args.concurrency && queue.length > 0) {
          const c = queue.shift();
          inFlight++;
          idx++;
          const myIdx = idx;
          (async () => {
            try {
              if (DEBUG) console.log(`[${myIdx}/${cases.length}] start ${c.id}`);
              await runOne(c);
            } finally {
              inFlight--;
              saveResults();
              tick();
              if (inFlight === 0 && queue.length === 0) resolve();
            }
          })();
        }
      };
      tick();
    });

    // Snapshot this run before the next iteration mutates ALL_RESULTS.
    PER_RUN_RESULTS.push({
      runIndex: runIdx,
      rows: ALL_RESULTS.map((r) => ({ ...r })),
    });
    saveResults();
    const total = ALL_RESULTS.length;
    const passed = ALL_RESULTS.filter((r) => r.pass).length;
    console.log(`\n--- Run ${runIdx} summary: ${passed}/${total} ---`);
    if (passed < total) {
      for (const r of ALL_RESULTS.filter((x) => !x.pass)) {
        console.log(`  FAIL ${r.id} (${r.group}): ${r.reasons.join(" | ")}`);
      }
    }
  }

  saveResults();
  await cleanupReservations();

  // Final aggregate report
  const agg = computeAggregateAcrossRuns();
  const total = agg.test_count;
  const totalAttempts = total * args.repeat;
  const totalPasses = PER_RUN_RESULTS.reduce(
    (sum, run) => sum + run.rows.filter((r) => r.pass).length,
    0,
  );
  console.log(`\n========================================`);
  console.log(`FINAL REPORT (${args.repeat} run(s))`);
  console.log(`========================================`);
  console.log(`Tests: ${total}`);
  console.log(`Total attempts: ${totalPasses} / ${totalAttempts} pass`);
  console.log(`All-pass on every run: ${agg.all_pass} / ${total}`);
  console.log(`Flakes (passed some, failed others): ${agg.flakes}`);
  console.log(`Hard fails (0 / ${args.repeat}): ${agg.hard_fails}`);
  if (agg.flakes > 0) {
    console.log(`\nFLAKES:`);
    for (const f of agg.flake_details) {
      console.log(`  ${f.id} (${f.group}): ${f.passed}`);
    }
  }
  if (agg.hard_fails > 0) {
    console.log(`\nHARD FAILS:`);
    for (const f of agg.hard_fail_details) {
      const r = f.failures[0]?.reasons?.join(" | ") ?? "";
      console.log(`  ${f.id} (${f.group}): ${r}`);
    }
  }
  const allGreen = agg.all_pass === total && agg.flakes === 0 && agg.hard_fails === 0;
  process.exit(allGreen ? 0 : 1);
}

// Export helpers for the cases file
export { newSession, RESTAURANT_ID, USER_PROFILE_ID, AUTH_USER_ID };

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
