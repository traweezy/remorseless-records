import { mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { writePrivateJsonArtifact } from "./private-json-artifact"

describe("writePrivateJsonArtifact", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true }))
    )
  })

  const makeTemporaryDirectory = async (): Promise<string> => {
    const directory = await mkdtemp(join(tmpdir(), "private-json-test-"))
    temporaryDirectories.push(directory)
    return directory
  }

  it("atomically writes a private JSON file under the trusted base", async () => {
    const baseDirectory = await makeTemporaryDirectory()
    const artifactPath = await writePrivateJsonArtifact({
      baseDirectory,
      fileName: "completed.json",
      relativeDirectory: "reports",
      value: { indexedCount: 42 },
    })

    await expect(readFile(artifactPath, "utf8")).resolves.toBe(
      '{\n  "indexedCount": 42\n}\n'
    )
    expect((await stat(artifactPath)).mode & 0o777).toBe(0o600)
  })

  it("rejects path traversal and symbolic-link directories", async () => {
    const baseDirectory = await makeTemporaryDirectory()
    const outsideDirectory = await makeTemporaryDirectory()

    await expect(
      writePrivateJsonArtifact({
        baseDirectory,
        fileName: "../completed.json",
        relativeDirectory: "reports",
        value: {},
      })
    ).rejects.toThrow("single non-empty path segment")

    await symlink(outsideDirectory, join(baseDirectory, "reports"))
    await expect(
      writePrivateJsonArtifact({
        baseDirectory,
        fileName: "completed.json",
        relativeDirectory: "reports",
        value: {},
      })
    ).rejects.toThrow("must not contain symbolic links")
  })
})
