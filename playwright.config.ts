import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://term.example.com";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: false,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--no-sandbox"] },
      },
    },
    // Mobile emulation project — targets Alice's real pain point (iPhone
    // 16 Pro Max chugs with 4-5 active sessions per bounty
    // hidden-pane-cost-mitigation-empirical-rotation). Playwright ships
    // the exact preset.
    {
      name: "mobile-iphone",
      use: {
        // WebKit engine doesn't take --no-sandbox, unlike Chromium.
        ...devices["iPhone 16 Pro Max"],
      },
    },
  ],
});
