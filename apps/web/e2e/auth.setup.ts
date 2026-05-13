import { test as setup, expect } from "@playwright/test";
import { mkdirSync, statSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const AUTH_FILE = ".auth/user.json";

setup("authenticate", async ({ page }) => {
  // Reuse a recent auth state if available — Supabase rate-limits frequent
  // signInWithPassword calls (we ran the suite many times tonight). Fresh
  // sign-in only if no saved state OR it's > 6 hours old.
  if (existsSync(AUTH_FILE)) {
    const ageMs = Date.now() - statSync(AUTH_FILE).mtime.getTime();
    if (ageMs < 6 * 60 * 60 * 1000) {
      console.log(`[auth.setup] reusing existing storage state (age ${Math.round(ageMs / 60_000)}min)`);
      return;
    }
  }

  const email = process.env.PLAYWRIGHT_TEST_EMAIL;
  const password = process.env.PLAYWRIGHT_TEST_PASSWORD;

  if (!email || !password) {
    throw new Error(
      [
        "Missing PLAYWRIGHT_TEST_EMAIL or PLAYWRIGHT_TEST_PASSWORD.",
        "Add them to .env.test.local at the repo root, or export in your shell.",
        "These should be a real Supabase auth user for the test environment.",
      ].join("\n"),
    );
  }

  await page.goto("/login");
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);

  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 }),
    page.locator('form button[type="submit"]').first().click(),
  ]);

  await expect(page).not.toHaveURL(/\/login/);

  mkdirSync(dirname(AUTH_FILE), { recursive: true });
  await page.context().storageState({ path: AUTH_FILE });
});
