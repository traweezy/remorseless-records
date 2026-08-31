import { defineConfig, devices } from "@playwright/test"

import {
  ciMedusaFixtureWebServer,
  ciStorefrontProviderEnv,
} from "./playwright.ci-provider"

const baseURL = "http://127.0.0.1:3000"
const criticalFlowPattern =
  /homepage hydrates|cart drawer stays usable|adding from quick shop|desktop filters preserve position|music release detail exposes|checkout remains accessible/

export default defineConfig({
  testDir: "./e2e/ci",
  fullyParallel: false,
  forbidOnly: true,
  retries: 1,
  retryStrategy: "isolated",
  workers: 1,
  reporter: "line",
  outputDir: "test-results/critical-browsers",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "Desktop Chromium critical",
      grep: criticalFlowPattern,
      use: { ...devices["Desktop Chrome"], browserName: "chromium" },
    },
    {
      name: "Desktop Firefox critical",
      grep: criticalFlowPattern,
      use: { ...devices["Desktop Firefox"], browserName: "firefox" },
    },
    {
      name: "Desktop WebKit critical",
      grep: criticalFlowPattern,
      use: { ...devices["Desktop Safari"], browserName: "webkit" },
    },
  ],
  webServer: [
    ciMedusaFixtureWebServer,
    {
      command: "pnpm run start --hostname 127.0.0.1 --port 3000",
      env: ciStorefrontProviderEnv,
      url: `${baseURL}/live`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
