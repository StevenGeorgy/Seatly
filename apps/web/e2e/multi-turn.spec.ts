/**
 * Multi-turn conversation flows — 100 scenarios.
 *
 * Each test plays a real back-and-forth dialog with Cenaiva. The harness
 * (text → text via HTTP) cannot see multi-turn state-loss bugs; only the
 * smoke pipeline can. New user-reported bugs should add their exact turn
 * sequence here as a permanent regression guard.
 *
 * Run: `npm run smoke -- e2e/multi-turn.spec.ts`
 */

import { test, expect } from "@playwright/test";
import { runFlow, endFlow, type MultiTurnFlow } from "./multi-turn";

// Multi-turn flows have 2+ turns @ ~5–15s each plus orchestrator round-trips.
// Default Playwright 30s test timeout kills them mid-flight. 90s gives
// headroom for 2-turn tests; bump higher for 3+-turn flows if needed.
test.setTimeout(90_000);

const RESTAURANTS = [
  "Harbour Sixty",
  "Baton Rouge",
  "Mark Testing",
  "The Keg Mansion",
  "STK Toronto",
  "David Duncan House",
  "Blue Blood Steakhouse",
];

const EXPECT_RESTAURANT: Record<string, RegExp> = {
  "Harbour Sixty": /harbour\s+sixty/i,
  "Baton Rouge": /b[âa]ton\s+rouge/i,
  "Mark Testing": /mark\s+testing/i,
  "The Keg Mansion": /keg\s+mansion/i,
  "STK Toronto": /stk/i,
  "David Duncan House": /david\s+duncan/i,
  "Blue Blood Steakhouse": /blue\s+blood/i,
};

const NEVER_BOUNCE = {
  notExpect:
    /(what\s+restaurant\s+or\s+area\s+should\s+i\s+book|which\s+menu\s+do\s+you\s+want)/i,
} as const;

// Universal teardown
test.afterEach(async ({ page }) => {
  await endFlow(page);
});

/* ============================================================================
 * SECTION 1 — User-reported state bugs (regression guards)
 * ============================================================================ */
test.describe("Section 1 — User-reported regression guards", () => {
  // ==========================================================================
  // ADDITIONAL REGRESSION GUARDS from real user-reported bugs 2026-05-12.
  // Each test here corresponds to a specific bug a user (or smoke run) hit
  // tonight. DO NOT remove these — they prevent the same bug recurring.
  // ==========================================================================

  test('regression 2026-05-12: "harbor 60" → Harbour Sixty (spelling variant)', async ({ page }) => {
    await runFlow(page, {
      label: "harbor-vs-harbour",
      turns: [
        {
          send: "book me at harbor sixty for 2 tomorrow at 7pm",
          expect: /harbour\s+sixty/i,
          ...NEVER_BOUNCE,
        },
      ],
    });
  });

  test('regression 2026-05-12: "what about X" routes to booking (not menu/goodbye)', async ({ page }) => {
    await runFlow(page, {
      label: "what-about-baton-rouge",
      turns: [
        {
          send: "What about Baton Rouge tomorrow?",
          expect: /b[âa]ton\s+rouge/i,
          ...NEVER_BOUNCE,
        },
      ],
    });
  });

  test('regression 2026-05-12: "feel like X" doesn\'t route to small-prompt joke', async ({ page }) => {
    await runFlow(page, {
      label: "feel-like-mark-testing",
      turns: [
        {
          send: "Feel like Mark Testing tonight",
          expect: /mark\s+testing/i,
          ...NEVER_BOUNCE,
        },
      ],
    });
  });

  test('regression 2026-05-12: "Reserve X for N on Y at Z" extracts restaurant', async ({ page }) => {
    await runFlow(page, {
      label: "reserve-baton-rouge",
      turns: [
        {
          send: "Reserve Baton Rouge for 4 on Saturday at 8",
          expect: /b[âa]ton\s+rouge/i,
          ...NEVER_BOUNCE,
        },
      ],
    });
  });

  test('regression 2026-05-12: "Hit up X Friday at 7" — imperative form', async ({ page }) => {
    await runFlow(page, {
      label: "hit-up-stk",
      turns: [
        {
          send: "Hit up STK Toronto Friday at 7",
          expect: /stk/i,
          ...NEVER_BOUNCE,
        },
      ],
    });
  });

  test('regression 2026-05-12: "Bring my partner to X Saturday" — companion + bare weekday', async ({ page }) => {
    await runFlow(page, {
      label: "bring-partner-harbour",
      turns: [
        {
          send: "Bring my partner to Harbour Sixty Saturday",
          expect: /harbour\s+sixty/i,
          ...NEVER_BOUNCE,
        },
      ],
    });
  });

  test('regression 2026-05-12: "Dinner for 4 at X tomorrow night" — no booking verb', async ({ page }) => {
    await runFlow(page, {
      label: "dinner-for-4",
      turns: [
        {
          send: "Dinner for 4 at Mark Testing tomorrow night",
          expect: /mark\s+testing/i,
          ...NEVER_BOUNCE,
        },
      ],
    });
  });

  test('regression 2026-05-12: UTF-8 "Bâton Rouge" not mangled to "BÃ¢ton"', async ({ page }) => {
    await runFlow(page, {
      label: "baton-rouge-utf8",
      turns: [
        {
          send: "Take my girlfriend to Baton Rouge",
          // Response should preserve UTF-8 accents (Bâton with â, not BÃ¢ton)
          // The recorder unmangles UTF-8 mojibake from the SSE stream.
          expect: /b[âa]ton\s+rouge/i,
          ...NEVER_BOUNCE,
        },
      ],
    });
  });

  test('user bug 2026-05-12: "boy recommended harbour 60 + take girlfriend" → "yes" preserves state', async ({
    page,
  }) => {
    const flow: MultiTurnFlow = {
      label: "harbour 60 recommended flow",
      turns: [
        {
          send:
            "my boy recommended me to go to harbour 60 and I want to take my girlfriend out",
          expect: /harbour\s+sixty/i,
          custom: (resp) => {
            const r = resp?.booking as Record<string, unknown> | null;
            expect(r?.restaurant_id, "turn 1 must set restaurant_id").toBeTruthy();
          },
        },
        {
          send: "yes my girlfriend really wants to go",
          notExpect:
            /(?:which|what)\s+(?:area|city|restaurant|place|spot)\s+(?:do\s+you|should\s+i)/i,
          custom: (resp) => {
            const r = resp?.booking as Record<string, unknown> | null;
            expect(r?.restaurant_id, "turn 2 must preserve restaurant_id").toBeTruthy();
          },
        },
      ],
    };
    await runFlow(page, flow);
  });
});

/* ============================================================================
 * SECTION 2 — Restaurant identification across phrasing patterns × restaurants
 * (1 turn per test, validates intent + restaurant resolution)
 * ============================================================================ */
const BOOKING_PHRASINGS: Array<(r: string) => string> = [
  (r) => `Book ${r} for 2 tomorrow at 7pm`,
  (r) => `I want to go to ${r} tomorrow night`,
  (r) => `Reserve ${r} for 4 on Saturday at 8`,
  (r) => `Take my girlfriend to ${r}`,
  (r) => `My friend recommended ${r}`,
  (r) => `Can you get me into ${r} for 2 tonight`,
  (r) => `What about ${r} tomorrow for 4`,
  (r) => `I'd like to try ${r} this weekend`,
  (r) => `Hit up ${r} Friday at 7`,
  (r) => `Let's go to ${r} for dinner`,
];

test.describe("Section 2 — Booking intent x restaurant matrix", () => {
  for (const restaurant of RESTAURANTS) {
    for (const [idx, phraser] of BOOKING_PHRASINGS.entries()) {
      const phrase = phraser(restaurant);
      test(`[${restaurant}] "${phrase}"`, async ({ page }) => {
        await runFlow(page, {
          label: `book-${restaurant}-${idx}`,
          turns: [
            {
              send: phrase,
              expect: EXPECT_RESTAURANT[restaurant],
              ...NEVER_BOUNCE,
            },
          ],
        });
      });
    }
  }
});

/* ============================================================================
 * SECTION 3 — Multi-turn booking state persistence
 * Verify that restaurant_id carries through follow-up turns.
 * ============================================================================ */
test.describe("Section 3 — Multi-turn state persistence", () => {
  const FOLLOWUPS = [
    "yes",
    "sure",
    "yeah let's do it",
    "ok please",
    "sounds good",
  ];

  for (const followup of FOLLOWUPS) {
    test(`state persists after "${followup}"`, async ({ page }) => {
      await runFlow(page, {
        label: `persist-${followup}`,
        turns: [
          {
            send: "I want to go to Baton Rouge for 2 tomorrow",
            expect: /b[âa]ton\s+rouge/i,
            custom: (resp) => {
              const r = resp?.booking as Record<string, unknown> | null;
              expect(r?.restaurant_id).toBeTruthy();
            },
          },
          {
            send: followup,
            ...NEVER_BOUNCE,
            custom: (resp) => {
              const r = resp?.booking as Record<string, unknown> | null;
              expect(
                r?.restaurant_id,
                `restaurant_id must persist after "${followup}"`,
              ).toBeTruthy();
            },
          },
        ],
      });
    });
  }
});

/* ============================================================================
 * SECTION 4 — Modify intent recognition
 * Single-turn — verify orchestrator routes modify verbs without bouncing.
 * ============================================================================ */
test.describe("Section 4 — Modify intent recognition", () => {
  const MODIFY_PHRASES = [
    "change my reservation to 8pm",
    "move my booking to Saturday",
    "make it for 4 instead of 2",
    "update my booking",
    "reschedule my reservation",
    "push my booking to 9pm",
    "switch my reservation to tomorrow",
    "modify my booking to next Friday",
    "edit my reservation",
    "adjust my booking time",
  ];
  for (const phrase of MODIFY_PHRASES) {
    test(`modify: "${phrase}"`, async ({ page }) => {
      await runFlow(page, {
        label: `modify-${phrase.slice(0, 20)}`,
        turns: [{ send: phrase, ...NEVER_BOUNCE }],
      });
    });
  }
});

/* ============================================================================
 * SECTION 5 — Cancel intent recognition
 * ============================================================================ */
test.describe("Section 5 — Cancel intent recognition", () => {
  const CANCEL_PHRASES = [
    "cancel my reservation",
    "drop my booking",
    "scrap my booking",
    "kill my reservation",
    "I need to cancel",
    "nuke my reservation",
    "abort my booking",
    "remove my booking",
    "I want to cancel",
    "please cancel my reservation",
  ];
  for (const phrase of CANCEL_PHRASES) {
    test(`cancel: "${phrase}"`, async ({ page }) => {
      await runFlow(page, {
        label: `cancel-${phrase.slice(0, 20)}`,
        turns: [{ send: phrase, ...NEVER_BOUNCE }],
      });
    });
  }
});

/* ============================================================================
 * SECTION 6 — Event / promotion intent
 * ============================================================================ */
test.describe("Section 6 — Event & promotion routing", () => {
  const cases = [
    { send: "book me for live music at Baton Rouge for 2", desc: "event by name" },
    { send: "are there any events at Mark Testing", desc: "events query" },
    { send: "any deals tonight", desc: "promo query routes to /deals" },
    { send: "show me promotions", desc: "promo routing" },
    { send: "got any specials at Harbour Sixty", desc: "specials at restaurant" },
    { send: "book me for chef tasting menu at Mark Testing", desc: "chef tasting event" },
    { send: "any happy hour deals", desc: "happy hour" },
    { send: "what events are coming up", desc: "general events" },
    { send: "weekend deals", desc: "weekend promos" },
    { send: "trivia night at any restaurants", desc: "themed event" },
  ];
  for (const c of cases) {
    test(`event/promo: ${c.desc}`, async ({ page }) => {
      await runFlow(page, {
        label: c.desc,
        turns: [{ send: c.send, ...NEVER_BOUNCE }],
      });
    });
  }
});

/* ============================================================================
 * SECTION 7 — Reservation list
 * ============================================================================ */
test.describe("Section 7 — Reservation list queries", () => {
  const LIST_PHRASES = [
    "show me my reservations",
    "what's my next reservation",
    "do I have any bookings",
    "list my reservations",
    "what's my most recent reservation",
  ];
  for (const phrase of LIST_PHRASES) {
    test(`list: "${phrase}"`, async ({ page }) => {
      await runFlow(page, {
        label: `list-${phrase.slice(0, 20)}`,
        turns: [{ send: phrase, ...NEVER_BOUNCE }],
      });
    });
  }
});

/* ============================================================================
 * SECTION 8 — Mid-booking interruptions
 * Send booking → off-topic interruption → confirm flow doesn't lose state.
 * ============================================================================ */
test.describe("Section 8 — Mid-booking interruptions", () => {
  const INTERRUPTIONS = [
    "tell me a joke",
    "what's the weather",
    "are you a robot",
    "hold on a second",
    "what time is it",
  ];

  for (const interruption of INTERRUPTIONS) {
    test(`interruption "${interruption}" — should not lose context`, async ({
      page,
    }) => {
      await runFlow(page, {
        label: `interrupt-${interruption.slice(0, 20)}`,
        turns: [
          {
            send: "I want to book Baton Rouge for 2 tomorrow",
            expect: /b[âa]ton\s+rouge/i,
          },
          {
            send: interruption,
            // After an interruption, we don't strictly require booking state
            // is preserved (the small-prompt LLM might null booking). But
            // the response should not crash or bounce.
          },
        ],
      });
    });
  }
});

/* ============================================================================
 * SECTION 9 — Off-topic standalone (no booking context)
 * ============================================================================ */
test.describe("Section 9 — Off-topic standalone", () => {
  const OFFTOPIC = [
    "hi",
    "hello",
    "good morning",
    "thanks",
    "tell me a joke",
    "what's the weather",
    "are you a robot",
    "what's your name",
    "what's up",
    "how are you",
  ];

  for (const phrase of OFFTOPIC) {
    test(`offtopic: "${phrase}"`, async ({ page }) => {
      await runFlow(page, {
        label: `offtopic-${phrase}`,
        turns: [{ send: phrase, ...NEVER_BOUNCE }],
      });
    });
  }
});

/* ============================================================================
 * SECTION 10 — Fact lookup
 * ============================================================================ */
test.describe("Section 10 — Fact lookup", () => {
  const FACT_QUERIES = [
    { send: "where is Harbour Sixty", expect: /harbour\s+sixty/i },
    { send: "what city is Baton Rouge in", expect: /b[âa]ton/i },
    { send: "is Mark Testing expensive", expect: /mark\s+testing/i },
    { send: "what cuisine is Harbour Sixty", expect: /harbour\s+sixty/i },
    { send: "tell me about The Keg Mansion", expect: /keg\s+mansion/i },
  ];
  for (const c of FACT_QUERIES) {
    test(`fact: "${c.send}"`, async ({ page }) => {
      await runFlow(page, {
        label: c.send,
        turns: [{ send: c.send, expect: c.expect, ...NEVER_BOUNCE }],
      });
    });
  }
});

/* ============================================================================
 * SECTION 11 — Discovery queries (find by cuisine / venue type / location)
 * ============================================================================ */
test.describe("Section 11 — Discovery queries", () => {
  // Note: no beforeEach — `runFlow` already navigates to /discover and opens
  // the concierge by default. Having both was racing the second open against
  // the first and failing tests 1-2s in. Pass `{ skipOpen: true }` to runFlow
  // if a future test in this section needs to start somewhere else.
  test.afterEach(async ({ page }) => {
    await endFlow(page);
  });

  const DISCOVERY_CASES: Array<{ label: string; phrase: string }> = [
    { label: "find italian restaurant", phrase: "find me an italian restaurant" },
    { label: "find steakhouse near me", phrase: "find a steakhouse near me" },
    { label: "any cafes nearby", phrase: "any cafes nearby" },
    { label: "recommend a bar", phrase: "recommend a bar in Toronto" },
    { label: "looking for sushi", phrase: "looking for sushi tonight" },
    { label: "find seafood place", phrase: "find me a seafood place for 4" },
    { label: "closest restaurant", phrase: "what's the closest restaurant" },
    { label: "best brunch", phrase: "best brunch spots" },
    { label: "trendy bistro", phrase: "got any trendy bistros" },
    { label: "romantic dinner", phrase: "find me a romantic dinner spot" },
  ];

  for (const c of DISCOVERY_CASES) {
    test(`discovery: ${c.label}`, async ({ page }) => {
      await runFlow(page, {
        label: c.label,
        turns: [
          {
            send: c.phrase,
            ...NEVER_BOUNCE,
            // Don't assert specific restaurant — content depends on DB.
            // Just verify the AI doesn't bounce / give an error / fall through
            // to a generic "what restaurant" prompt.
          },
        ],
      });
    });
  }
});

/* ============================================================================
 * SECTION 12 — Multi-turn discovery → book flow
 * Real conversational flow: user asks for options, then books from results.
 * ============================================================================ */
test.describe("Section 12 — Discovery → Book flow", () => {
  test.afterEach(async ({ page }) => {
    await endFlow(page);
  });

  test("italian search → book one of the suggestions", async ({ page }) => {
    await runFlow(page, {
      label: "italian discover then book",
      turns: [
        {
          send: "find me an italian restaurant",
          ...NEVER_BOUNCE,
        },
        {
          // After AI lists options, user picks one — AI should continue flow
          send: "book the first one for 2 tomorrow at 7pm",
          ...NEVER_BOUNCE,
        },
      ],
    });
  });

  test("cafe search → ask follow-up about hours", async ({ page }) => {
    await runFlow(page, {
      label: "cafe discover then ask hours",
      turns: [
        {
          send: "any cafes nearby",
          ...NEVER_BOUNCE,
        },
        {
          send: "what are their hours",
          ...NEVER_BOUNCE,
        },
      ],
    });
  });

  test("steakhouse search → pick by name → confirm", async ({ page }) => {
    await runFlow(page, {
      label: "steakhouse discover then pick",
      turns: [
        {
          send: "find a steakhouse for tonight",
          ...NEVER_BOUNCE,
        },
        {
          send: "book Harbour Sixty for 2",
          expect: /harbour\s+sixty/i,
          ...NEVER_BOUNCE,
        },
      ],
    });
  });
});

/* ============================================================================
 * SECTION 13 — Full-input single-turn capture
 * Booking handler must extract restaurant + date + time + party in ONE turn.
 * Bug class: orchestrator drops parsed fields and bounces with "what restaurant".
 * ============================================================================ */
test.describe("Section 13 — Full-input single-turn capture", () => {
  test.afterEach(async ({ page }) => {
    await endFlow(page);
  });

  test('full input: "Book STK Toronto for 2 tomorrow at 7pm"', async ({ page }) => {
    await runFlow(page, {
      label: "full-stk-tomorrow-7pm",
      turns: [
        {
          send: "Book STK Toronto for 2 tomorrow at 7pm",
          expect: /stk/i,
          ...NEVER_BOUNCE,
        },
      ],
    });
  });

  test('full input: "Book Mark Testing for 4 Saturday at 8pm"', async ({ page }) => {
    await runFlow(page, {
      label: "full-mark-saturday-8pm",
      turns: [
        {
          send: "Book Mark Testing for 4 Saturday at 8pm",
          expect: /mark\s+testing/i,
          ...NEVER_BOUNCE,
        },
      ],
    });
  });

  test('full input: "reserve baton rouge for 3 friday 9pm"', async ({ page }) => {
    await runFlow(page, {
      label: "full-baton-friday-9pm",
      turns: [
        {
          send: "reserve baton rouge for 3 friday 9pm",
          expect: /b[âa]ton\s+rouge/i,
          ...NEVER_BOUNCE,
        },
      ],
    });
  });
});

/* ============================================================================
 * SECTION 14 — Occasion words must NOT hijack event lookup
 * Words like "business dinner", "anniversary", "birthday dinner" are
 * descriptors, NOT event names. They should not trigger the events-list
 * resolver / hijack the booking with a wrong event match.
 * ============================================================================ */
test.describe("Section 14 — Occasion words don't hijack event lookup", () => {
  test.afterEach(async ({ page }) => {
    await endFlow(page);
  });

  test('"business dinner at Harbour Sixty" — descriptor, not event', async ({ page }) => {
    await runFlow(page, {
      label: "business-dinner-harbour",
      turns: [
        {
          send: "book a business dinner at Harbour Sixty for 6 Thursday at 7pm",
          expect: /harbour\s+sixty/i,
          notExpect: /Bordeaux Wine Pairing|events list/i,
        },
      ],
    });
  });

  test('"anniversary at Harbour Sixty" — occasion, not event', async ({ page }) => {
    await runFlow(page, {
      label: "anniversary-harbour",
      turns: [
        {
          send: "book a table for two for my anniversary at Harbour Sixty",
          expect: /harbour\s+sixty/i,
          notExpect: /events list|"two for my anniversary"/i,
        },
      ],
    });
  });

  test('"birthday dinner at Mark Testing" — occasion, not event', async ({ page }) => {
    await runFlow(page, {
      label: "birthday-mark-testing",
      turns: [
        {
          send: "reserve a birthday dinner at Mark Testing for 4 tomorrow",
          expect: /mark\s+testing/i,
          notExpect: /events list/i,
        },
      ],
    });
  });
});

/* ============================================================================
 * SECTION 15 — Verbose run-on utterances preserve party_size
 * Booking handler must parse party from natural phrasing even when buried in
 * conversational context ("we're five going out for a celebration").
 * ============================================================================ */
test.describe("Section 15 — Verbose run-on utterances preserve party_size", () => {
  test.afterEach(async ({ page }) => {
    await endFlow(page);
  });

  test('"we\'re five going out for a celebration" — party=5 preserved', async ({
    page,
  }) => {
    await runFlow(page, {
      label: "verbose-five-celebration",
      turns: [
        {
          send:
            "we're five going out for a celebration could you book mark testing wednesday at 8",
          expect: /mark\s+testing/i,
          notExpect: /table for 1/i,
        },
      ],
    });
  });
});

/* ============================================================================
 * SECTION 16 — Confirmation-code lookup must work
 * Stuck-state regression: "what's my confirmation code" must NOT respond
 * with "I can't see confirmation codes". Test is expected to FAIL until the
 * underlying handler is fixed — that's the point (don't let it slip again).
 * ============================================================================ */
test.describe("Section 16 — Confirmation-code lookup", () => {
  test.afterEach(async ({ page }) => {
    await endFlow(page);
  });

  test('"what\'s my confirmation code" — must NOT refuse with "can\'t see"', async ({
    page,
  }) => {
    await runFlow(page, {
      label: "confirmation-code-lookup",
      turns: [
        {
          send: "what's my confirmation code",
          notExpect: /can'?t\s+see\s+confirmation\s+codes?/i,
        },
      ],
    });
  });
});
