import { defineConfig, devices } from "@playwright/test"

const defaultBaseURL = "https://storefront-staging-41f0.up.railway.app"
const baseURL = process.env.PLAYWRIGHT_BASE_URL?.trim() ?? defaultBaseURL
const desktopSmokePattern =
  /visible interactive controls|cart drawer stays usable|adding from quick shop|desktop filters preserve position|catalog loads the next result window|discography header precedes|checkout remains accessible/
const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === "https:"
  } catch {
    return false
  }
}

if (!isHttpsUrl(baseURL)) {
  throw new Error(
    "Cross-browser smoke tests require an HTTPS PLAYWRIGHT_BASE_URL so production security headers are exercised correctly."
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
  outputDir: "test-results/cross-browser",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "Desktop Firefox",
      grep: desktopSmokePattern,
      use: { ...devices["Desktop Firefox"], browserName: "firefox" },
    },
    {
      name: "Desktop WebKit",
      grep: desktopSmokePattern,
      use: { ...devices["Desktop Safari"], browserName: "webkit" },
    },
  ],
})
