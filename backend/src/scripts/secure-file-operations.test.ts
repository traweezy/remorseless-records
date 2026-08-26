import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { updateExistingRegularFile } from "./secure-file-operations"

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
})
