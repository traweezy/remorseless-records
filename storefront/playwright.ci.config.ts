import { defineConfig, devices } from "@playwright/test"

const baseURL = "http://127.0.0.1:3000"
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH

export default defineConfig({
  testDir: "./e2e/ci",
  fullyParallel: false,
  forbidOnly: true,
  retries: 1,
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
      name: "Pixel 7",
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
    {
      name: "iPhone 15 Pro",
      use: { ...devices["iPhone 15 Pro"], browserName: "chromium" },
    },
  ],
  webServer: {
    command: "pnpm run start --hostname 127.0.0.1 --port 3000",
    url: `${baseURL}/api/healthcheck`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
