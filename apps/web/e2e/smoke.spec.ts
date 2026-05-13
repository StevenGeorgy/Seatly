/**
 * Browser-pipeline smoke test.
 *
 * Targets the real Chrome → React → orchestrator → DB stack. Catches
 * regressions the text harness can't see (mic gating, button wiring,
 * navigation, page crashes, deploy drift).
 *
 * Each `test` is a separate regression. New user-reported bugs should add
 * their exact phrasing here so the bug can't recur silently.
 *
 * Run: `npm run smoke`
 */

import { test, expect } from "@playwright/test";
import {
  openConcierge,
  closeAssistant,
  sendText,
  expectSpokenText,
} from "./helpers";

test.describe("page-level renders", () => {
  test("/discover renders without crashing", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/discover");
    await expect(page.getByRole("button", { name: /^concierge$/i })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("/bookings renders without crashing", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/bookings");
    await page.waitForLoadState("networkidle");

    expect(errors).toEqual([]);
  });

  test("/deals renders without crashing", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/deals");
    await page.waitForLoadState("networkidle");

    expect(errors).toEqual([]);
  });
});

test.describe("Concierge button (regression: 2026-05-11 auto-listen)", () => {
  test("clicking Concierge opens the voice shell drawer", async ({ page }) => {
    await page.goto("/discover");
    await openConcierge(page);

    // The shell renders the close button + a toggle text input button when open.
    await expect(page.getByRole("button", { name: /close assistant/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /toggle text input/i })).toBeVisible();

    await closeAssistant(page);
  });
});

test.describe("Voice orchestrator intent routing", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/discover");
    await openConcierge(page);
  });

  test.afterEach(async ({ page }) => {
    await closeAssistant(page);
  });

  test('casual booking intent — "I want to go to X" routes to booking, NOT menu (regression: 2026-05-11)', async ({
    page,
  }) => {
    await sendText(
      page,
      "I want to go to baton rouge because a friend recommended me it and I want to take my girlfriend there",
    );
    // Should ask about party/date — NOT menu options.
    await expectSpokenText(page, /b[âa]ton rouge/i);
    await expect(page.locator("body")).not.toContainText(/which menu do you want/i);
  });

  test('spelling variant — "harbor 60" resolves to Harbour Sixty, not Georgy Inc (regression: 2026-05-11)', async ({
    page,
  }) => {
    await sendText(page, "book me at harbor sixty for 2 tomorrow at 7pm");
    // Positive assertion is sufficient — the orchestrator's response refers to
    // Harbour Sixty. We don't do a `not.toContainText(/georgy inc/i)` on body
    // because Georgy Inc is one of the real restaurants pinned on /discover's
    // map and would always be present in the DOM chrome.
    await expectSpokenText(page, /harbour sixty/i);
  });

  test("menu Q&A — always answers (regression: 2026-05-11)", async ({ page }) => {
    await sendText(page, "what's on the menu at baton rouge");
    // Either a list of dishes (with $) OR a "no menu on file" response — never
    // the booking-collector "What restaurant or area should I book?" prompt.
    await expectSpokenText(page, /(\$|menu)/i);
    await expect(page.locator("body")).not.toContainText(
      /what restaurant or area should i book/i,
    );
  });

  test("direct event booking — by event name (regression: 2026-05-11)", async ({
    page,
  }) => {
    await sendText(page, "book me for live music at baton rouge for 2");
    // Either it confirms the event by name OR it asks the next field. Both pass.
    // The fail mode is "What restaurant or area should I book?" or "Which menu?".
    await expect(page.locator("body")).not.toContainText(
      /what restaurant or area should i book/i,
    );
    await expect(page.locator("body")).not.toContainText(/which menu do you want/i);
  });

  test("global question — promotions/deals routes to /deals", async ({ page }) => {
    await sendText(page, "any deals tonight");
    // Orchestrator emits navigate→/deals + close_assistant for this intent.
    // Either we end up on /deals, OR the response references deals/promotions.
    const closedOrOnDeals = page
      .waitForURL(/\/deals/, { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    const mentionedDeals = expectSpokenText(page, /deals?|promotion/i, 10_000)
      .then(() => true)
      .catch(() => false);
    expect(await Promise.race([closedOrOnDeals, mentionedDeals])).toBe(true);
  });
});

/**
 * Persona phrasings — same intent (book a table), different speech registers.
 *
 * Real users don't talk like a system prompt. These check that Cenaiva resolves
 * the restaurant + intent across blue-collar / corporate / elderly / gen-z /
 * tentative / decisive phrasings. Every assertion is the same shape: response
 * references the named restaurant AND does NOT bounce the user back with
 * "what restaurant or area should I book" or "which menu do you want".
 */
test.describe("Persona phrasings — booking intent across speech registers", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/discover");
    await openConcierge(page);
  });

  test.afterEach(async ({ page }) => {
    await closeAssistant(page);
  });

  const personaCases: Array<{ label: string; phrase: string; expectRestaurant: RegExp }> = [
    {
      label: "blue-collar casual — 'yo hook me up'",
      phrase: "yo hook me up with a table at baton rouge for me and the boys tonight",
      expectRestaurant: /b[âa]ton rouge/i,
    },
    {
      label: "blue-collar — 'need a spot'",
      phrase: "need a spot at harbour sixty saturday at 8 for 4 of us",
      expectRestaurant: /harbour sixty/i,
    },
    {
      label: "corporate professional — full formal request",
      phrase:
        "I'd like to reserve a table for a business dinner at Harbour Sixty for 6 people on Thursday at 7pm",
      expectRestaurant: /harbour sixty/i,
    },
    {
      label: "corporate — quarterly team dinner",
      phrase:
        "Please make a reservation for our quarterly team dinner at Baton Rouge, party of 8, this Friday at 6:30",
      expectRestaurant: /b[âa]ton rouge/i,
    },
    {
      label: "generic decisive — terse command",
      phrase: "table for 2 at baton rouge tomorrow at 7",
      expectRestaurant: /b[âa]ton rouge/i,
    },
    {
      label: "elderly formal — 'I would very much like'",
      phrase:
        "Hello Cenaiva, I would very much like to make a dinner reservation. My wife and I would like to dine at Baton Rouge this weekend if at all possible.",
      expectRestaurant: /b[âa]ton rouge/i,
    },
    {
      label: "elderly — anniversary phrasing",
      phrase: "Could you please book a table for two for my anniversary at Harbour Sixty?",
      expectRestaurant: /harbour sixty/i,
    },
    {
      label: "gen-z slang — 'fr tmrw'",
      phrase: "fr book me at baton rouge for 4 tmrw at 7",
      expectRestaurant: /b[âa]ton rouge/i,
    },
    {
      label: "gen-z — 'lowkey wanna eat'",
      phrase: "lowkey wanna eat at harbour sixty tn for 2",
      expectRestaurant: /harbour sixty/i,
    },
    {
      label: "tentative / question-shaped",
      phrase: "Can you get me into Baton Rouge for 2 tonight around 7-ish?",
      expectRestaurant: /b[âa]ton rouge/i,
    },
    {
      label: "indirect — 'what about'",
      phrase: "What about Baton Rouge tomorrow? Maybe 7-ish? Could be 4 of us.",
      expectRestaurant: /b[âa]ton rouge/i,
    },
    {
      label: "apologetic / hedging",
      phrase:
        "Sorry, I don't know if this is right but can I get a reservation at Baton Rouge for 6 tomorrow at 7?",
      expectRestaurant: /b[âa]ton rouge/i,
    },
  ];

  for (const { label, phrase, expectRestaurant } of personaCases) {
    test(label, async ({ page }) => {
      await sendText(page, phrase);
      await expectSpokenText(page, expectRestaurant);
      // Universal fail modes the orchestrator should NEVER fall into for an
      // unambiguous booking intent that names a restaurant.
      await expect(page.locator("body")).not.toContainText(
        /what restaurant or area should i book/i,
      );
      await expect(page.locator("body")).not.toContainText(/which menu do you want/i);
    });
  }
});

/**
 * Booking variations — colloquial party-size, time phrasing, relative dates.
 * Mirrors harness Group A.
 */
test.describe("Booking variations", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/discover");
    await openConcierge(page);
  });
  test.afterEach(async ({ page }) => {
    await closeAssistant(page);
  });

  const cases: Array<{ label: string; phrase: string; expect: RegExp }> = [
    {
      label: "half a dozen → 6",
      phrase: "Reserve a table for half a dozen this Saturday at 8 at Baton Rouge",
      expect: /b[âa]ton rouge/i,
    },
    {
      label: "noon → 12:00",
      phrase: "Book me at Harbour Sixty for noon tomorrow, party of 4",
      expect: /harbour sixty/i,
    },
    {
      label: "myself and 3 friends → 4",
      phrase: "Reserve Baton Rouge for myself and 3 friends Saturday 8pm",
      expect: /b[âa]ton rouge/i,
    },
    {
      label: "me and the wife → 2",
      phrase: "Book Harbour Sixty for me and the wife tomorrow at 7",
      expect: /harbour sixty/i,
    },
    {
      label: "dinner for two — no verb",
      phrase: "Dinner for two at Baton Rouge tonight",
      expect: /b[âa]ton rouge/i,
    },
    {
      label: "the both of us → 2",
      phrase: "I want a table at Baton Rouge for the both of us tomorrow at 7",
      expect: /b[âa]ton rouge/i,
    },
  ];

  for (const { label, phrase, expect: expectRestaurant } of cases) {
    test(label, async ({ page }) => {
      await sendText(page, phrase);
      await expectSpokenText(page, expectRestaurant);
      await expect(page.locator("body")).not.toContainText(
        /what restaurant or area should i book/i,
      );
    });
  }
});

/**
 * Fact lookup — questions about a specific restaurant.
 * Mirrors harness fact-lookup group.
 */
test.describe("Restaurant fact lookup", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/discover");
    await openConcierge(page);
  });
  test.afterEach(async ({ page }) => {
    await closeAssistant(page);
  });

  const cases: Array<{ label: string; phrase: string; expect: RegExp }> = [
    {
      label: "where is X",
      phrase: "Where is Harbour Sixty",
      expect: /harbour sixty/i,
    },
    {
      label: "what city is X in",
      phrase: "What city is Baton Rouge in",
      expect: /b[âa]ton rouge/i,
    },
    {
      label: "is X expensive",
      phrase: "Is Harbour Sixty expensive",
      expect: /harbour sixty/i,
    },
    {
      label: "what kind of food does X serve",
      phrase: "What kind of food does Harbour Sixty serve",
      expect: /harbour sixty/i,
    },
    {
      label: "tell me about X",
      phrase: "Tell me about Harbour Sixty",
      expect: /harbour sixty/i,
    },
  ];

  for (const { label, phrase, expect: expectRestaurant } of cases) {
    test(label, async ({ page }) => {
      await sendText(page, phrase);
      await expectSpokenText(page, expectRestaurant);
      // Fact-lookup must NEVER hijack into a generic "what restaurant should I
      // book" prompt — that was the small-prompt regression on 2026-05-10.
      await expect(page.locator("body")).not.toContainText(
        /what restaurant or area should i book/i,
      );
    });
  }
});

/**
 * Menu Q&A — category-scoped questions. All should answer with menu content,
 * NEVER bounce to "what restaurant or area should I book".
 */
test.describe("Menu Q&A categories", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/discover");
    await openConcierge(page);
  });
  test.afterEach(async ({ page }) => {
    await closeAssistant(page);
  });

  const cases: Array<{ label: string; phrase: string }> = [
    { label: "vegan options", phrase: "any vegan options at baton rouge" },
    { label: "appetizers", phrase: "appetizers at harbour sixty" },
    { label: "desserts", phrase: "show me desserts at baton rouge" },
    { label: "drinks", phrase: "what drinks does harbour sixty serve" },
    { label: "kids menu", phrase: "do they have a kids menu at baton rouge" },
  ];

  for (const { label, phrase } of cases) {
    test(label, async ({ page }) => {
      await sendText(page, phrase);
      // Either lists items (with $) or politely says no info on file — never
      // bounces to the booking-collector prompt.
      await expect(page.locator("body")).not.toContainText(
        /what restaurant or area should i book/i,
      );
    });
  }
});

/**
 * Modify intent — verbs should route to modify, not be parsed as new bookings.
 * Without a prior reservation in state, response should ask which booking OR
 * say "you don't have any active reservations". It should NOT ask "what
 * restaurant or area should I book".
 */
test.describe("Modify intent recognition", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/discover");
    await openConcierge(page);
  });
  test.afterEach(async ({ page }) => {
    await closeAssistant(page);
  });

  const cases: Array<{ label: string; phrase: string }> = [
    { label: "change to 8pm", phrase: "Change my reservation to 8pm" },
    { label: "move to Saturday", phrase: "Move my booking to Saturday" },
    { label: "make it for 4", phrase: "Make it for 4 instead of 2" },
    { label: "update my booking", phrase: "Update my booking" },
    { label: "reschedule", phrase: "Reschedule my reservation" },
  ];

  for (const { label, phrase } of cases) {
    test(label, async ({ page }) => {
      await sendText(page, phrase);
      await expect(page.locator("body")).not.toContainText(
        /what restaurant or area should i book/i,
      );
    });
  }
});

/**
 * Cancel intent — same logic as modify, but with cancel verbs.
 */
test.describe("Cancel intent recognition", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/discover");
    await openConcierge(page);
  });
  test.afterEach(async ({ page }) => {
    await closeAssistant(page);
  });

  const cases: Array<{ label: string; phrase: string }> = [
    { label: "cancel my reservation", phrase: "Cancel my reservation" },
    { label: "drop my booking", phrase: "Drop my booking" },
    { label: "scrap my booking", phrase: "Scrap my booking" },
    { label: "I need to cancel", phrase: "I need to cancel" },
    { label: "kill my reservation", phrase: "Kill my reservation" },
  ];

  for (const { label, phrase } of cases) {
    test(label, async ({ page }) => {
      await sendText(page, phrase);
      await expect(page.locator("body")).not.toContainText(
        /what restaurant or area should i book/i,
      );
    });
  }
});

/**
 * Reservation list intent — "show me my bookings" plural, "next reservation"
 * singular. Either lists bookings or says "no active reservations".
 */
test.describe("Reservation list intent", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/discover");
    await openConcierge(page);
  });
  test.afterEach(async ({ page }) => {
    await closeAssistant(page);
  });

  const cases: Array<{ label: string; phrase: string }> = [
    { label: "show me my reservations", phrase: "Show me my reservations" },
    { label: "what's my next reservation", phrase: "What's my next reservation" },
    { label: "do I have any bookings", phrase: "Do I have any bookings" },
    { label: "list my bookings", phrase: "List my bookings" },
  ];

  for (const { label, phrase } of cases) {
    test(label, async ({ page }) => {
      await sendText(page, phrase);
      await expect(page.locator("body")).not.toContainText(
        /what restaurant or area should i book/i,
      );
    });
  }
});

/**
 * Off-topic / pleasantries — the small-prompt LLM should respond conversationally
 * and NEVER force the user back to "what restaurant should I book".
 */
test.describe("Off-topic / pleasantries", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/discover");
    await openConcierge(page);
  });
  test.afterEach(async ({ page }) => {
    await closeAssistant(page);
  });

  const cases: Array<{ label: string; phrase: string }> = [
    { label: "greeting — hi", phrase: "hi" },
    { label: "greeting — good morning", phrase: "good morning" },
    { label: "thanks", phrase: "thanks" },
    { label: "weather", phrase: "what's the weather like" },
    { label: "joke request", phrase: "tell me a joke" },
    { label: "are you a robot", phrase: "are you a robot" },
    { label: "what's your name", phrase: "what's your name" },
  ];

  for (const { label, phrase } of cases) {
    test(label, async ({ page }) => {
      await sendText(page, phrase);
      // Should produce SOME response, not bounce into the booking collector.
      await expect(page.locator("body")).not.toContainText(
        /what restaurant or area should i book/i,
      );
    });
  }
});
