import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { resolve } from "node:path"
import { createNativeSettingsFixture } from "./helpers/native-settings-fixture"
import { registerNativeSettingsHttpTests } from "./helpers/native-settings-http"

if (process.env.INTEGRATION_TESTS_ENABLED !== "1" || !process.env.REDIS_URL)
  throw new Error(
    "Native Settings requires the guarded disposable service runner"
  )

medusaIntegrationTestRunner({
  cwd: process.cwd(),
  dbName: "rr_disposable_settings",
  moduleName: "RemorselessNativeSettings",
  env: {
    INTEGRATION_TESTS_ENABLED: "1",
    NODE_ENV: "test",
    REDIS_URL: process.env.REDIS_URL,
    MEDUSA_FF_RBAC: "true",
  },
  testSuite: ({ api, getContainer }) => {
    registerNativeSettingsHttpTests({ api, getContainer })
    const browserMode = process.env.RR_NATIVE_SETTINGS_BROWSER
    if (browserMode !== undefined && browserMode !== "1")
      throw new Error("RR_NATIVE_SETTINGS_BROWSER must be omitted or exactly 1")
    if (browserMode === "1") {
      describe("compiled native Settings against the same initialized database", () => {
        for (const mode of [
          "desktop-light",
          "desktop-dark",
          "phone-light",
          "phone-dark",
        ]) {
          it(`persists native UI changes and checks permissions in ${mode}`, async () => {
            const adminRoot = process.env.RR_NATIVE_SETTINGS_ADMIN_ROOT
            const artifactRoot = process.env.RR_NATIVE_SETTINGS_ARTIFACT_ROOT
            if (!adminRoot || !artifactRoot)
              throw new Error(
                "Explicit compiled and private evidence roots are required"
              )
            const fixture = await createNativeSettingsFixture(
              getContainer(),
              api
            )
            // Resolve the single owned QA entry at runtime so backend rootDir
            // does not absorb the root JS project. No user-selected module is
            // imported, and this explicit browser gate never replaces HTTP QA.
            const browserEntry = resolve(
              process.cwd(),
              "../qa/native-settings-browser.mjs"
            )
            const { runNativeSettingsBrowserAcceptance } = await import(
              browserEntry
            )
            await runNativeSettingsBrowserAcceptance({
              fixture,
              adminRoot,
              artifactRoot,
              mode,
            })
          }, 240_000)
        }
      })
    }
  },
})
