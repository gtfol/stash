import { defineConfig, devices } from "@playwright/test";

// Browser tests against a production build (`npm run build` first) and a real Postgres.
// E2E_DATABASE_URL must point at a disposable database; the tests apply db/schema.sql to it.

const port = 3100;
export const baseURL = `http://localhost:${port}`;
// Test-only values: a local secret and placeholder Google credentials so sign-in and sync switch on.
export const authSecret = "stash-e2e-secret-not-for-production-0123456789";

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next start -p ${port}`,
    url: `${baseURL}/api/sync/status`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
      BETTER_AUTH_SECRET: authSecret,
      BETTER_AUTH_URL: baseURL,
      GOOGLE_CLIENT_ID: "e2e-placeholder.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "e2e-placeholder",
    },
  },
});
