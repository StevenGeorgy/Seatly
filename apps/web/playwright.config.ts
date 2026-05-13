import { defineConfig, devices } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Browser-pipeline smoke test config.
 *
 * Catches regressions the harness can't see: provider wiring, useEffect bugs,
 * missing button onClick handlers, navigation race, deploy drift, UI breakage.
 *
 * Run: `npm run smoke` (assumes dev server is up via `npm run dev` OR auto-starts).
 *
 * Required env (in `.env.test.local` at repo root, or shell):
 *   PLAYWRIGHT_TEST_EMAIL=...
 *   PLAYWRIGHT_TEST_PASSWORD=...
 */

// Load .env.test.local from repo root without a dotenv dep — tiny inline parser.
const envFile = resolve(__dirname, "../..", ".env.test.local");
if (existsSync(envFile)) {
  for (const raw of readFileSync(envFile, "utf-8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const PORT = 5173;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  expect: {
    timeout: 15_000,
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "smoke",
      // dependencies: ["setup"] removed — Supabase signInWithPassword rate-
      // limits frequent runs. The saved storage state at .auth/user.json is
      // still valid (Supabase access tokens last ~1 hour, refresh tokens
      // longer). Re-run setup manually with `npx playwright test --project=setup`
      // when the state expires.
      use: {
        ...devices["Desktop Chrome"],
        storageState: ".auth/user.json",
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
