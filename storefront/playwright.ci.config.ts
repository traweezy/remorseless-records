import { defineConfig, devices } from "@playwright/test"

import {
  ciMedusaFixtureWebServer,
  ciStorefrontProviderEnv,
} from "./playwright.ci-provider"

const localBaseURL = "http://127.0.0.1:3000"
const deployedBaseURL = process.env.PLAYWRIGHT_BASE_URL?.trim() || null
const baseURL = deployedBaseURL ?? localBaseURL
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

if (deployedBaseURL && !isHttpsUrl(deployedBaseURL)) {
  throw new Error(
    "Deployed browser smoke tests require an HTTPS PLAYWRIGHT_BASE_URL."
  )
}

export default defineConfig({
  testDir: "./e2e/ci",
  fullyParallel: false,
  forbidOnly: true,
  retries: 1,
  retryStrategy: "isolated",
  workers: 1,
  reporter: "line",
  outputDir: "test-results/ci",
  use: {
    baseURL,
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "Desktop Chrome checkout",
      grep: /checkout remains accessible|desktop filters preserve|discography header precedes|virtual (catalog|discography)|Stripe loader|UI runtime/,
      use: { ...devices["Desktop Chrome"], browserName: "chromium" },
    },
    {
      name: "Pixel 7",
      grepInvert: /desktop filters preserve/,
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
    {
      name: "iPhone 15 Pro",
      grepInvert: /desktop filters preserve/,
      use: { ...devices["iPhone 15 Pro"], browserName: "chromium" },
    },
  ],
  ...(deployedBaseURL
    ? {}
    : {
        webServer: [
          ciMedusaFixtureWebServer,
          {
            command:
              "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000",
            env: ciStorefrontProviderEnv,
            url: `${localBaseURL}/live`,
            reuseExistingServer: false,
            timeout: 120_000,
          },
        ],
      }),
})
