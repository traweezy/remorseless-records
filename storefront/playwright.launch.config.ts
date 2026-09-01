import { defineConfig, devices } from "@playwright/test"

import {
  ciMedusaFixtureWebServer,
  ciStorefrontProviderEnv,
} from "./playwright.ci-provider"

const baseURL = "http://127.0.0.1:3000"
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH

export default defineConfig({
  testDir: "./e2e/launch",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "line",
  outputDir: "test-results/launch-acceptance",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "Storefront launch acceptance",
      use: { browserName: "chromium" },
    },
  ],
  webServer: [
    ciMedusaFixtureWebServer,
    {
      command: "pnpm run start --hostname 127.0.0.1 --port 3000",
      env: {
        ...ciStorefrontProviderEnv,
        // Never inherit repository-level staging search credentials here. An
        // unavailable loopback endpoint exercises the app's deterministic
        // Medusa catalog fallback without contacting staging or loading its
        // media through the local Next image optimizer.
        MEILISEARCH_HOST: "http://127.0.0.1:7700",
        MEILISEARCH_SEARCH_KEY: "ci-launch-search-key-20260831",
      },
      url: `${baseURL}/live`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
