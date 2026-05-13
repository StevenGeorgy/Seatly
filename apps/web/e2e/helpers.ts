import { expect, type Page } from "@playwright/test";

/**
 * Click the Concierge button (or wake-equivalent open) and wait for the
 * voice shell drawer to mount with the greeting. Retries once on click
 * timeout — Vite-dev-server slowness after many tests sometimes makes
 * the first click hang.
 */
export async function openConcierge(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  const btn = page.getByRole("button", { name: /^concierge$/i }).first();
  try {
    await btn.click({ timeout: 10_000 });
  } catch {
    // Retry once after a tiny stabilizer
    await page.waitForTimeout(500);
    await btn.click({ timeout: 10_000 });
  }

  await expect(
    page.getByRole("button", { name: /toggle text input/i }),
  ).toBeVisible({ timeout: 10_000 });
}

/**
 * Toggle the text-input panel on. The voice shell defaults to voice mode;
 * for deterministic tests we send text instead.
 */
export async function switchToTextMode(page: Page): Promise<void> {
  const placeholder = page.getByPlaceholder(/Type a message/i);
  if (await placeholder.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: /toggle text input/i }).click();
  await expect(placeholder).toBeVisible();
}

/**
 * Send a message via the text-input panel and wait for the orchestrator
 * round-trip to finish.
 *
 * Returns when ANY of three signals fires:
 *   - Send button returns to "Send" (processing done, drawer still open)
 *   - Assistant drawer closes (orchestrator emitted `close_assistant`)
 *   - URL navigates (orchestrator emitted `navigate` ui_action)
 *
 * 30s upper bound — if none fires by then, the test's downstream assertion
 * polls anyway, so we don't throw here.
 */
export async function sendText(page: Page, text: string): Promise<void> {
  await switchToTextMode(page);
  const input = page.getByPlaceholder(/Type a message/i);
  await input.fill(text);

  const sendBtn = page.locator("button", { hasText: /^Send$/ }).first();
  await sendBtn.click();

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

/**
 * Wait until the visible Cenaiva shell text contains the given substring
 * (case-insensitive). Polls a 2-second debounce so partial SSE chunks have
 * a chance to coalesce.
 */
export async function expectSpokenText(
  page: Page,
  fragment: string | RegExp,
  timeout = 30_000,
): Promise<void> {
  const pattern = typeof fragment === "string" ? new RegExp(fragment, "i") : fragment;
  await expect
    .poll(
      async () => {
        const body = await page.locator("body").innerText();
        return pattern.test(body);
      },
      { timeout, intervals: [500, 1000, 2000] },
    )
    .toBeTruthy();
}

/**
 * Close the assistant via the close button. Safe to call even if already
 * closed.
 */
export async function closeAssistant(page: Page): Promise<void> {
  const close = page.getByRole("button", { name: /close assistant/i });
  if (await close.isVisible().catch(() => false)) {
    await close.click();
  }
}
