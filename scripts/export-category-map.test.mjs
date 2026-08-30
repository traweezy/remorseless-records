import assert from "node:assert/strict"
import { mkdtemp, readFile, stat, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, it } from "node:test"

import { buildCategoryMap, parseCategoryPage } from "./export-category-map.mjs"
import { writePrivateJsonArtifact } from "./lib/private-json-artifact.mjs"

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      const { rm } = await import("node:fs/promises")
      await rm(directory, { force: true, recursive: true })
    })
  )
})

const makeTemporaryDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "category-map-test-"))
  temporaryDirectories.push(directory)
  return directory
}

describe("category map export boundaries", () => {
  it("accepts only bounded category IDs and handles", () => {
    assert.deepEqual(
      parseCategoryPage({
        count: 1,
        product_categories: [{ handle: "death-metal", id: "pcat_01JTEST" }],
      }),
      {
        count: 1,
        productCategories: [{ handle: "death-metal", id: "pcat_01JTEST" }],
      }
    )

    assert.throws(
      () =>
        parseCategoryPage({
          count: 1,
          product_categories: [{ handle: "../escape", id: "pcat_01JTEST" }],
        }),
      /invalid ID or handle/
    )
    assert.throws(
      () =>
        parseCategoryPage({
          count: 10_001,
          product_categories: [],
        }),
      /bounded page schema/
    )
  })

  it("sorts a null-prototype map and rejects ambiguous handles", () => {
    const handles = buildCategoryMap([
      { handle: "vinyl", id: "pcat_vinyl" },
      { handle: "metal", id: "pcat_metal" },
    ])

    assert.equal(Object.getPrototypeOf(handles), null)
    assert.deepEqual(Object.keys(handles), ["metal", "vinyl"])
    assert.throws(
      () =>
        buildCategoryMap([
          { handle: "metal", id: "pcat_first" },
          { handle: "metal", id: "pcat_second" },
        ]),
      /is duplicated/
    )
  })

  it("writes private JSON atomically inside a canonical directory", async () => {
    const baseDirectory = await makeTemporaryDirectory()
    const artifactPath = await writePrivateJsonArtifact({
      baseDirectory,
      fileName: "category-map.json",
      relativeDirectory: "artifacts",
      value: { handles: { metal: "pcat_metal" } },
    })

    assert.deepEqual(JSON.parse(await readFile(artifactPath, "utf8")), {
      handles: { metal: "pcat_metal" },
    })
    assert.equal((await stat(artifactPath)).mode & 0o777, 0o600)
  })

  it("rejects a symbolic-link artifact directory", async () => {
    const baseDirectory = await makeTemporaryDirectory()
    const outsideDirectory = await makeTemporaryDirectory()
    await symlink(outsideDirectory, join(baseDirectory, "artifacts"))

    await assert.rejects(
      writePrivateJsonArtifact({
        baseDirectory,
        fileName: "category-map.json",
        relativeDirectory: "artifacts",
        value: { handles: {} },
      }),
      /must not contain symbolic links/
    )
  })
})
