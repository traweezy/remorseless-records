import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  assertCanonicalPathInside,
  renderPnpmWorkspaceConfig,
  rewriteLockfile,
} from "./post-build-configuration"

const lockfileFixture = `lockfileVersion: "9.0"

importers:

  .:
    devDependencies:
      root-only:
        specifier: 1.0.0
        version: 1.0.0

  backend:
    dependencies:
      backend-only:
        specifier: 2.0.0
        version: 2.0.0

  storefront:
    dependencies:
      storefront-only:
        specifier: 3.0.0
        version: 3.0.0

packages:
  backend-only@2.0.0: {}
`

describe("post-build configuration", () => {
  it("isolates the exact backend importer without guessing", () => {
    const rewritten = rewriteLockfile(lockfileFixture, "backend")

    expect(rewritten).toContain("importers:\n\n  .:")
    expect(rewritten).toContain("backend-only:")
    expect(rewritten).not.toContain("root-only:")
    expect(rewritten).not.toContain("storefront-only:")
    expect(rewritten).toContain("packages:\n")
  })

  it("fails closed when the required importer is absent", () => {
    expect(() => rewriteLockfile(lockfileFixture, "missing")).toThrow(
      "Required pnpm importer not found: missing"
    )
    expect(() => rewriteLockfile("lockfileVersion: 9", "backend")).toThrow(
      "pnpm lockfile has no importers section"
    )
  })

  it("renders stable sorted policy while preserving explicit denials", () => {
    const config = {
      allowBuilds: { sharp: true, puppeteer: false, esbuild: true },
      hoistPattern: ["*", "!@types/react"],
      minimumReleaseAgeExclude: ["z@1", "a@1"],
      overrides: { z: "2.0.0", a: "1.0.0" },
      packageExtensions: {
        z: { peerDependencies: { react: "*" } },
        a: { dependencies: { typescript: "5.9.3" } },
      },
      patchedDependencies: {
        z: "patches/z.patch",
        a: "patches/a.patch",
      },
      resolvePeersFromWorkspaceRoot: false,
    }

    const rendered = renderPnpmWorkspaceConfig(config)
    expect(renderPnpmWorkspaceConfig(config)).toBe(rendered)
    expect(rendered).toContain('  "puppeteer": false')
    expect(rendered.indexOf('  "a": "1.0.0"')).toBeLessThan(
      rendered.indexOf('  "z": "2.0.0"')
    )
    expect(rendered.indexOf('  - "a@1"')).toBeLessThan(
      rendered.indexOf('  - "z@1"')
    )
  })

  it("rejects a canonical patch path outside the reviewed workspace", () => {
    const testDirectory = mkdtempSync(join(tmpdir(), "rr-post-build-"))
    try {
      const workspace = join(testDirectory, "workspace")
      const outside = join(testDirectory, "outside")
      mkdirSync(workspace)
      mkdirSync(outside)
      const reviewedPatch = join(workspace, "reviewed.patch")
      const escapedPatch = join(outside, "escaped.patch")
      writeFileSync(reviewedPatch, "reviewed", "utf8")
      writeFileSync(escapedPatch, "escaped", "utf8")
      symlinkSync(outside, join(workspace, "linked-directory"))

      expect(() =>
        assertCanonicalPathInside(workspace, reviewedPatch)
      ).not.toThrow()
      expect(() =>
        assertCanonicalPathInside(
          workspace,
          join(workspace, "linked-directory", "escaped.patch")
        )
      ).toThrow("Path escapes the reviewed workspace")
    } finally {
      rmSync(testDirectory, { force: true, recursive: true })
    }
  })
})
