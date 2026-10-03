import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const {
  prepareRuntimeMigrationDirectories,
} = require("./runtime-migration-directories")

describe("compiled runtime migration directories", () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rr-migrations-"))
    fs.mkdirSync(path.join(root, "src", "modules"), { recursive: true })
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it("prepares missing directories and preserves existing migration bytes", () => {
    const modules = path.join(root, "src", "modules")
    fs.mkdirSync(path.join(modules, "provider"))
    fs.mkdirSync(path.join(modules, "catalog", "migrations"), {
      recursive: true,
    })
    const migration = path.join(
      modules,
      "catalog",
      "migrations",
      "Migration.js"
    )
    fs.writeFileSync(migration, "reviewed migration")
    fs.writeFileSync(path.join(modules, "README.md"), "modules")
    expect(prepareRuntimeMigrationDirectories(root)).toBe(2)
    expect(prepareRuntimeMigrationDirectories(root)).toBe(2)
    expect(
      fs.readdirSync(path.join(modules, "provider", "migrations"))
    ).toEqual([])
    expect(fs.readFileSync(migration, "utf8")).toBe("reviewed migration")
  })

  it.each(["module", "migrations", "root"])(
    "rejects a %s symlink",
    (location) => {
      const modules = path.join(root, "src", "modules")
      const outside = path.join(root, "outside")
      fs.mkdirSync(outside)
      if (location === "root") {
        const alias = path.join(root, "alias")
        fs.symlinkSync(root, alias)
        expect(() => prepareRuntimeMigrationDirectories(alias)).toThrow()
        return
      }
      const module = path.join(modules, "provider")
      if (location === "module") fs.symlinkSync(outside, module)
      else {
        fs.mkdirSync(module)
        fs.symlinkSync(outside, path.join(module, "migrations"))
      }
      expect(() => prepareRuntimeMigrationDirectories(root)).toThrow()
      expect(fs.readdirSync(outside)).toEqual([])
    }
  )

  it("prepares installed Medusa distributions and deduplicates internal links", () => {
    const store = path.join(root, "node_modules", ".pnpm")
    const scope = path.join(store, "provider@1", "node_modules", "@medusajs")
    const provider = path.join(scope, "provider")
    fs.mkdirSync(path.join(provider, "dist"), { recursive: true })
    fs.symlinkSync(provider, path.join(scope, "alias"))
    expect(
      prepareRuntimeMigrationDirectories(root, { includeDependencies: true })
    ).toBe(1)
    expect(fs.readdirSync(path.join(provider, "dist", "migrations"))).toEqual(
      []
    )
  })

  it("rejects an installed module escaping the packaged dependency store", () => {
    const scope = path.join(
      root,
      "node_modules",
      ".pnpm",
      "provider@1",
      "node_modules",
      "@medusajs"
    )
    const outside = path.join(root, "outside")
    fs.mkdirSync(scope, { recursive: true })
    fs.mkdirSync(path.join(outside, "dist"), { recursive: true })
    fs.symlinkSync(outside, path.join(scope, "provider"))
    expect(() =>
      prepareRuntimeMigrationDirectories(root, { includeDependencies: true })
    ).toThrow("escaped")
    expect(fs.readdirSync(path.join(outside, "dist"))).toEqual([])
  })

  it("rejects a migration-directory path occupied by a file", () => {
    const module = path.join(root, "src", "modules", "provider")
    fs.mkdirSync(module)
    fs.writeFileSync(path.join(module, "migrations"), "do not replace")
    expect(() => prepareRuntimeMigrationDirectories(root)).toThrow()
    expect(fs.readFileSync(path.join(module, "migrations"), "utf8")).toBe(
      "do not replace"
    )
  })
})
