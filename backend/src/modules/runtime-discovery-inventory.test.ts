import { readdirSync } from "node:fs"
import { resolve } from "node:path"

const DISCOVERED_DIRECTORIES = ["models", "repositories", "services"] as const
const TEST_MODULE_PATTERN = /\.(?:spec|test)\.[cm]?[jt]sx?$/u

const discoveredTestModules = (): string[] => {
  const modulesRoot = resolve(process.cwd(), "src", "modules")
  return readdirSync(modulesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((moduleEntry) =>
      DISCOVERED_DIRECTORIES.flatMap((directoryName) => {
        const directory = resolve(modulesRoot, moduleEntry.name, directoryName)
        try {
          return readdirSync(directory, { withFileTypes: true })
            .filter(
              (entry) => entry.isFile() && TEST_MODULE_PATTERN.test(entry.name)
            )
            .map(
              (entry) => `${moduleEntry.name}/${directoryName}/${entry.name}`
            )
        } catch (error: unknown) {
          const code =
            error && typeof error === "object" && "code" in error
              ? error.code
              : undefined
          if (code === "ENOENT") {
            return []
          }
          throw error
        }
      })
    )
    .sort()
}

describe("Medusa module discovery inventory", () => {
  it("keeps test modules outside runtime-discovered directories", () => {
    expect(discoveredTestModules()).toEqual([])
  })
})
