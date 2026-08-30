import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  copyNewRegularFile,
  createNewRegularFile,
  readExistingRegularFile,
  updateExistingRegularFile,
} from "./secure-file-operations"

describe("updateExistingRegularFile", () => {
  let testDirectory: string

  beforeEach(() => {
    testDirectory = mkdtempSync(join(tmpdir(), "safe-file-update-"))
  })

  afterEach(() => {
    rmSync(testDirectory, { force: true, recursive: true })
  })

  it("updates the inode opened for reading without re-resolving its path", () => {
    const filePath = join(testDirectory, "package.json")
    writeFileSync(filePath, '{"pnpm":{"overrides":{}}}\n', "utf8")

    expect(
      updateExistingRegularFile(filePath, (contents: string) =>
        contents.replace('{"pnpm":{"overrides":{}}}', "{}")
      )
    ).toBe(true)
    expect(readFileSync(filePath, "utf8")).toBe("{}\n")
  })

  it("allows explicitly optional files to be absent", () => {
    expect(
      updateExistingRegularFile(
        join(testDirectory, "missing.html"),
        (contents: string) => contents,
        { missingOkay: true }
      )
    ).toBe(false)
  })

  it("refuses to follow a symbolic-link target", () => {
    const targetPath = join(testDirectory, "target.html")
    const linkPath = join(testDirectory, "index.html")
    writeFileSync(targetPath, "unchanged", "utf8")
    symlinkSync(targetPath, linkPath)

    expect(() =>
      updateExistingRegularFile(linkPath, () => "compromised")
    ).toThrow()
    expect(readFileSync(targetPath, "utf8")).toBe("unchanged")
  })

  it("creates new files without replacing an existing target", () => {
    const filePath = join(testDirectory, "pnpm-workspace.yaml")
    createNewRegularFile(filePath, "packages:\n  - .\n")

    expect(readFileSync(filePath, "utf8")).toBe("packages:\n  - .\n")
    expect(() => createNewRegularFile(filePath, "replaced")).toThrow()
    expect(readFileSync(filePath, "utf8")).toBe("packages:\n  - .\n")
  })

  it("copies only regular non-symlink sources to a new target", () => {
    const sourcePath = join(testDirectory, "source.patch")
    const linkPath = join(testDirectory, "source-link.patch")
    const targetPath = join(testDirectory, "target.patch")
    writeFileSync(sourcePath, "reviewed patch", "utf8")
    symlinkSync(sourcePath, linkPath)

    expect(() => copyNewRegularFile(linkPath, targetPath)).toThrow()
    copyNewRegularFile(sourcePath, targetPath)
    expect(readFileSync(targetPath, "utf8")).toBe("reviewed patch")
    expect(() => copyNewRegularFile(sourcePath, targetPath)).toThrow()
  })

  it("reads regular files without following a symbolic link", () => {
    const sourcePath = join(testDirectory, "pnpm-lock.yaml")
    const linkPath = join(testDirectory, "pnpm-lock-link.yaml")
    writeFileSync(sourcePath, "lockfileVersion: 9", "utf8")
    symlinkSync(sourcePath, linkPath)

    expect(readExistingRegularFile(sourcePath, "utf8")).toBe(
      "lockfileVersion: 9"
    )
    expect(() => readExistingRegularFile(linkPath, "utf8")).toThrow()
  })
})
