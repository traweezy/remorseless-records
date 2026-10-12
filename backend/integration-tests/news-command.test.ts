import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { resolve } from "node:path"
import {
  createNativeNewsFixture,
  registerNewsCommandHttpTests,
} from "./helpers/news-command-http"

if (process.env.INTEGRATION_TESTS_ENABLED !== "1" || !process.env.REDIS_URL)
  throw new Error("News commands require the guarded disposable service runner")

medusaIntegrationTestRunner({
  cwd: process.cwd(),
  dbName: "rr_disposable_news",
  moduleName: "RemorselessNewsCommands",
  env: {
    INTEGRATION_TESTS_ENABLED: "1",
    NODE_ENV: "test",
    REDIS_URL: process.env.REDIS_URL,
    MEDUSA_FF_RBAC: "true",
  },
  testSuite: ({ api, getContainer }) => {
    registerNewsCommandHttpTests({ api, getContainer })
    const browserMode = process.env.RR_NATIVE_NEWS_BROWSER
    if (browserMode !== undefined && browserMode !== "1")
      throw new Error("RR_NATIVE_NEWS_BROWSER must be omitted or exactly 1")
    const editorMode = process.env.RR_NATIVE_NEWS_EDITOR_BROWSER
    if (editorMode !== undefined && editorMode !== "1")
      throw new Error(
        "RR_NATIVE_NEWS_EDITOR_BROWSER must be omitted or exactly 1"
      )
    if (browserMode === "1" && editorMode === "1")
      throw new Error(
        "Run native recovery and editor browser families separately"
      )
    if (editorMode === "1") {
      describe("compiled native rich-text commands and persistence", () => {
        for (const mode of [
          "desktop-light",
          "desktop-dark",
          "phone-light",
          "phone-dark",
        ]) {
          it(`exercises real editor controls and public readback in ${mode}`, async () => {
            const adminRoot = process.env.RR_NATIVE_NEWS_ADMIN_ROOT
            const artifactRoot = process.env.RR_NATIVE_NEWS_ARTIFACT_ROOT
            if (!adminRoot || !artifactRoot)
              throw new Error(
                "Explicit compiled and private editor roots are required"
              )
            const fixture = await createNativeNewsFixture(getContainer(), api)
            const browserEntry = resolve(
              process.cwd(),
              "../qa/native-news-browser.mjs"
            )
            const { runNativeNewsBrowserAcceptance } = await import(
              browserEntry
            )
            await runNativeNewsBrowserAcceptance({
              fixture,
              adminRoot,
              artifactRoot,
              mode,
              scenario: "editor",
            })
          }, 240_000)
        }
      })
    }
    if (browserMode === "1") {
      describe("compiled native News against the same initialized database", () => {
        for (const mode of [
          "desktop-light",
          "desktop-dark",
          "phone-light",
          "phone-dark",
        ]) {
          it(`recovers real native UI command replies in ${mode}`, async () => {
            const adminRoot = process.env.RR_NATIVE_NEWS_ADMIN_ROOT
            const artifactRoot = process.env.RR_NATIVE_NEWS_ARTIFACT_ROOT
            if (!adminRoot || !artifactRoot)
              throw new Error(
                "Explicit compiled and private News evidence roots are required"
              )
            const fixture = await createNativeNewsFixture(getContainer(), api)
            // Only the owned News entry is resolved; this opt-in browser proof
            // never replaces or suppresses the ordinary initialized HTTP gate.
            const browserEntry = resolve(
              process.cwd(),
              "../qa/native-news-browser.mjs"
            )
            const { runNativeNewsBrowserAcceptance } = await import(
              browserEntry
            )
            await runNativeNewsBrowserAcceptance({
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
