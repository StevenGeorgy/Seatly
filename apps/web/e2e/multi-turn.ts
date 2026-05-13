import { expect, type Page } from "@playwright/test";
import { openConcierge, closeAssistant, switchToTextMode } from "./helpers";
import { TurnRecorder, type CapturedResponse } from "./turn-recorder";

export interface Turn {
  /** User message to send this turn. */
  send: string;
  /** Substring/regex the assistant response MUST contain. */
  expect?: RegExp | string;
  /** Substring/regex the assistant response MUST NOT contain. */
  notExpect?: RegExp | string;
  /** Optional booking-state assertions (any field that should be set/match). */
  expectBooking?: Record<string, unknown>;
  /** Skip orchestrator wait — used for client-only Stage 1 responses. */
  expectLocal?: boolean;
  /** Custom assertion run with the captured response. */
  custom?: (resp: CapturedResponse | null, page: Page) => Promise<void> | void;
}

export interface MultiTurnFlow {
  label: string;
  turns: Turn[];
  /** After the flow, navigate to /bookings and assert a row exists / doesn't. */
  expectBookingCreated?: boolean;
  expectBookingCancelled?: boolean;
}

/**
 * Execute a multi-turn conversation flow. Opens the assistant, plays each
 * turn in sequence, asserts on each response, and cleans up at the end.
 */
export async function runFlow(
  page: Page,
  flow: MultiTurnFlow,
  options: { skipOpen?: boolean } = {},
): Promise<CapturedResponse[]> {
  const recorder = new TurnRecorder(page);
  const responses: CapturedResponse[] = [];

  if (!options.skipOpen) {
    await page.goto("/discover");
    await openConcierge(page);
    await switchToTextMode(page);
  }

  // Drain any pre-flow noise (prewarm, page-load greetings, etc.) so the
  // first user turn's response is the next thing captured.
  recorder.reset();

  for (const [idx, turn] of flow.turns.entries()) {
    const label = `${flow.label} turn ${idx + 1}/${flow.turns.length}: "${turn.send.slice(0, 60)}…"`;

    await sendTurn(page, turn.send);

    let captured: CapturedResponse | null = null;
    if (!turn.expectLocal) {
      try {
        captured = await recorder.waitForNext(45_000);
        responses.push(captured);
      } catch (err) {
        // No network response within window — could be a Stage 1 local response
        // (which doesn't hit the network). Fall through with captured=null.
        captured = null;
      }
    }

    // Positive assertion (substring or regex)
    if (turn.expect) {
      const pattern =
        typeof turn.expect === "string"
          ? new RegExp(escapeRegex(turn.expect), "i")
          : turn.expect;
      if (captured?.spoken_text) {
        expect(captured.spoken_text, `${label} — expect ${pattern}`).toMatch(pattern);
      } else {
        // No network capture — assert via DOM polling
        await expect
          .poll(
            async () => pattern.test(await page.locator("body").innerText()),
            { timeout: 30_000, intervals: [500, 1000, 2000] },
          )
          .toBeTruthy();
      }
    }

    // Negative assertion
    if (turn.notExpect) {
      const pattern =
        typeof turn.notExpect === "string"
          ? new RegExp(escapeRegex(turn.notExpect), "i")
          : turn.notExpect;
      const haystack =
        captured?.spoken_text ?? (await page.locator("body").innerText());
      expect(haystack, `${label} — notExpect ${pattern}`).not.toMatch(pattern);
    }

    // Booking-state assertions
    if (turn.expectBooking && captured?.booking) {
      for (const [k, v] of Object.entries(turn.expectBooking)) {
        expect(
          (captured.booking as Record<string, unknown>)[k],
          `${label} — booking.${k}`,
        ).toEqual(v);
      }
    }

    // Custom assertion
    if (turn.custom) {
      await turn.custom(captured, page);
    }
  }

  return responses;
}

async function sendTurn(page: Page, text: string): Promise<void> {
  const input = page.getByPlaceholder(/Type a message/i);
  await input.fill(text);

  const sendBtn = page.locator("button", { hasText: /^Send$/ }).first();
  await sendBtn.click();

  // Wait for processing to settle, drawer close, or URL change.
  const startUrl = page.url();
  await Promise.race([
    sendBtn.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
    page
      .getByRole("button", { name: /close assistant/i })
      .waitFor({ state: "detached", timeout: 30_000 })
      .catch(() => undefined),
    page
      .waitForURL((url) => url.toString() !== startUrl, { timeout: 30_000 })
      .catch(() => undefined),
  ]);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * After a flow ends, try to gracefully close the assistant. Safe to call even
 * if the drawer is already gone.
 */
export async function endFlow(page: Page): Promise<void> {
  await closeAssistant(page);
}
