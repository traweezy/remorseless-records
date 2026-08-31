import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"

const localRequire = createRequire(import.meta.url)
const radixPackage = localRequire.resolve("radix-ui/package.json")
const radixRequire = createRequire(radixPackage)
const selectEntry = radixRequire.resolve("@radix-ui/react-select")
const selectRoot = dirname(dirname(selectEntry))

describe("pinned Radix Select Trusted Types boundary", () => {
  it("keeps the patched runtime free of injected style sinks", () => {
    const packageJson = JSON.parse(
      readFileSync(join(selectRoot, "package.json"), "utf8")
    ) as { version?: unknown }
    const commonJsSource = readFileSync(
      join(selectRoot, "dist/index.js"),
      "utf8"
    )
    const esmSource = readFileSync(join(selectRoot, "dist/index.mjs"), "utf8")

    expect(packageJson.version).toBe("2.3.7")
    expect(commonJsSource).not.toContain("dangerouslySetInnerHTML")
    expect(esmSource).not.toContain("dangerouslySetInnerHTML")
    expect(commonJsSource).not.toContain(
      "[data-radix-select-viewport]{scrollbar-width"
    )
    expect(esmSource).not.toContain(
      "[data-radix-select-viewport]{scrollbar-width"
    )
  })

  it("keeps the equivalent static viewport rules in application CSS", () => {
    const globalStyles = readFileSync(
      join(process.cwd(), "src/styles/globals.css"),
      "utf8"
    )

    expect(globalStyles).toContain("[data-radix-select-viewport]")
    expect(globalStyles).toContain("scrollbar-width: none")
    expect(globalStyles).toContain("-ms-overflow-style: none")
    expect(globalStyles).toContain("-webkit-overflow-scrolling: touch")
    expect(globalStyles).toContain(
      "[data-radix-select-viewport]::-webkit-scrollbar"
    )
  })
})
