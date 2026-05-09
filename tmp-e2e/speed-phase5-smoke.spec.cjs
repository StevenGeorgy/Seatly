const { test, expect } = require("@playwright/test");

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:5174";

test("preview Continue navigates before slow availability revalidation finishes", async ({ page, context }) => {
  test.setTimeout(120_000);
  const client = await context.newCDPSession(page);
  await client.send("Network.enable");

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) {
      consoleErrors.push(`${msg.type()}: ${msg.text()}`);
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  let delayPostClickAvailability = false;
  let delayedAvailabilityRequests = 0;
  await page.route("**/functions/v1/get-availability**", async (route) => {
    if (delayPostClickAvailability) {
      delayedAvailabilityRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 4_000));
    }
    await route.continue();
  });

  await page.goto(`${BASE_URL}/discover`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1_000);
  if (await page.locator("#login-email").isVisible().catch(() => false)) {
    await page.fill("#login-email", "cenaiva.e2e.customer@test.local");
    await page.fill("#login-password", "TestPassword123!");
    await page.click("button[type='submit']");
    await page.waitForURL(/\/discover(?:\?|$)/, { timeout: 20_000 });
  }

  const previewButtons = page
    .locator("[role='button']")
    .filter({ hasText: /Cenaiva Reservation Capacity Test/ });
  await expect(previewButtons.first()).toBeVisible({ timeout: 20_000 });

  let continueButton = null;
  for (let i = 0; i < Math.min(await previewButtons.count(), 8); i += 1) {
    await previewButtons.nth(i).click();
    const candidate = page.getByRole("button", { name: /^Continue with / }).first();
    try {
      await expect(candidate).toBeVisible({ timeout: 20_000 });
      await expect(candidate).toBeEnabled({ timeout: 20_000 });
      continueButton = candidate;
      break;
    } catch {
      const closeButton = page.getByRole("button", { name: /close/i }).first();
      if (await closeButton.isVisible().catch(() => false)) {
        await closeButton.click();
      } else {
        await page.keyboard.press("Escape");
      }
    }
  }

  expect(continueButton, "expected at least one preview with an available slot").not.toBeNull();

  await client.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 400,
    downloadThroughput: (400 * 1024) / 8,
    uploadThroughput: (400 * 1024) / 8,
    connectionType: "cellular3g",
  });

  delayPostClickAvailability = true;
  const beforeClick = Date.now();
  await continueButton.click();
  await page.waitForFunction(() => window.location.pathname !== "/discover", null, { timeout: 1_500 });
  const navigationMs = Date.now() - beforeClick;

  await expect(page.getByText("Book your table")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Checking table availability|That preview time is no longer available|Guests/).first()).toBeVisible({
    timeout: 30_000,
  });

  expect(navigationMs).toBeLessThan(1_500);
  expect(delayedAvailabilityRequests).toBeGreaterThanOrEqual(1);
  expect(consoleErrors.filter((line) => line.startsWith("pageerror:"))).toEqual([]);
});
