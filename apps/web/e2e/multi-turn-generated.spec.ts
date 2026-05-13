/**
 * Generated multi-turn scenarios — pseudo-random combinations of
 * (restaurant × phrasing × party × date × time) to surface bugs that the
 * curated 132-test suite doesn't cover.
 *
 * Uses a deterministic seed so a failing test can always be reproduced.
 * Override via SCENARIO_SEED env var.
 *
 * Run: `npm run smoke -- multi-turn-generated.spec.ts`
 *      `SCENARIO_SEED=42 npm run smoke -- multi-turn-generated.spec.ts`
 */

import { test, expect } from "@playwright/test";
import { runFlow, endFlow, type MultiTurnFlow } from "./multi-turn";

test.setTimeout(90_000);

const SEED = Number(process.env.SCENARIO_SEED ?? "1");
const NUM_SCENARIOS = Number(process.env.NUM_SCENARIOS ?? "100");

const RESTAURANTS: Array<{ token: string; matcher: RegExp }> = [
  { token: "Harbour Sixty", matcher: /harbour\s+sixty/i },
  { token: "Baton Rouge", matcher: /b[âa]ton\s+rouge/i },
  { token: "Mark Testing", matcher: /mark\s+testing/i },
  { token: "The Keg Mansion", matcher: /keg\s+mansion/i },
  { token: "STK Toronto", matcher: /stk/i },
  { token: "David Duncan House", matcher: /david\s+duncan/i },
  { token: "Blue Blood Steakhouse", matcher: /blue\s+blood/i },
];

const PARTY_SIZES = [2, 3, 4, 5, 6, 8, "two", "four", "six"] as const;
const DATES = [
  "tomorrow",
  "Friday",
  "Saturday",
  "Sunday",
  "this weekend",
  "next Friday",
  "tonight",
  "tomorrow night",
];
const TIMES = ["7pm", "7:30pm", "8pm", "6:30pm", "noon", "5pm", "9pm"];
const COMPANIONS = [
  "my girlfriend",
  "my boyfriend",
  "my wife",
  "my husband",
  "my partner",
  "my friend",
  "my family",
  "my parents",
  "my kids",
  "my date",
];

// Phrasing templates — {R}=restaurant, {P}=party, {D}=date, {T}=time, {C}=companion
const TEMPLATES: string[] = [
  "Book {R} for {P} {D} at {T}",
  "Reserve {R} for {P} on {D} at {T}",
  "Book me a table at {R} for {P} {D} at {T}",
  "I want to go to {R} {D}",
  "I'd like to go to {R} {D}",
  "Let's go to {R} {D}",
  "Take {C} to {R} {D}",
  "Going to take {C} to {R}",
  "My friend recommended {R}",
  "My boy recommended {R}",
  "My coworker said {R} is great",
  "Heard about {R}",
  "Been meaning to try {R}",
  "What about {R} {D}",
  "How about {R} {D}",
  "Can you get me into {R} for {P} {D}",
  "Can you fit us in at {R} {D}",
  "Any chance of a table at {R} {D}",
  "Thinking of going to {R}",
  "Feel like {R}",
  "Hit up {R} {D} at {T}",
  "Snag a table at {R} for {P}",
  "Grab us a spot at {R} for {P}",
  "Set me up at {R} {D}",
  "Hold a table at {R} {D}",
  "Dinner for {P} at {R} {D}",
  "I want to take {C} out to {R}",
  "Treat {C} to {R}",
  "Bring {C} to {R} {D}",
  "Reserve a table at {R} for {P} {D} at {T}",
];

const NEVER_BOUNCE = {
  notExpect:
    /(what\s+restaurant\s+or\s+area\s+should\s+i\s+book|which\s+menu\s+do\s+you\s+want)/i,
} as const;

// Seeded LCG so the same SEED → same scenario list.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function render(template: string, rand: () => number, restaurantToken: string): string {
  return template
    .replace("{R}", restaurantToken)
    .replace("{P}", String(pick(rand, PARTY_SIZES)))
    .replace("{D}", pick(rand, DATES))
    .replace("{T}", pick(rand, TIMES))
    .replace("{C}", pick(rand, COMPANIONS));
}

const rand = rng(SEED);
const scenarios: Array<{ phrase: string; matcher: RegExp; restaurant: string }> = [];
for (let i = 0; i < NUM_SCENARIOS; i++) {
  const r = pick(rand, RESTAURANTS);
  const template = pick(rand, TEMPLATES);
  scenarios.push({
    phrase: render(template, rand, r.token),
    matcher: r.matcher,
    restaurant: r.token,
  });
}

test.describe(`Generated scenarios (seed=${SEED}, n=${NUM_SCENARIOS})`, () => {
  test.afterEach(async ({ page }) => {
    await endFlow(page);
  });

  for (const [idx, scn] of scenarios.entries()) {
    test(`#${idx + 1} [${scn.restaurant}] "${scn.phrase}"`, async ({ page }) => {
      const flow: MultiTurnFlow = {
        label: `gen-${idx}`,
        turns: [
          {
            send: scn.phrase,
            expect: scn.matcher,
            ...NEVER_BOUNCE,
          },
        ],
      };
      await runFlow(page, flow);
    });
  }
});
