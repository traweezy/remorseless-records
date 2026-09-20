import assert from "node:assert/strict"
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { openPrivateOutputDirectory } from "./lib/postgres-snapshot.mjs"

test("private directory descriptor stays bound after pathname replacement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "rr-snapshot-anchor-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const parent = join(root, "parent")
  const output = join(parent, "output")
  const moved = join(root, "moved")
  await mkdir(output, { recursive: true, mode: 0o700 })
  const anchor = await openPrivateOutputDirectory(output)
  try {
    await writeFile(join(anchor.descriptorPath, "pinned"), "original", {
      flag: "wx",
      mode: 0o600,
    })
    await rename(parent, moved)
    await mkdir(output, { recursive: true, mode: 0o700 })
    await writeFile(join(output, "pinned"), "replacement", {
      flag: "wx",
      mode: 0o600,
    })
    assert.equal(
      await readFile(join(anchor.descriptorPath, "pinned"), "utf8"),
      "original"
    )
    assert.equal(await readFile(join(output, "pinned"), "utf8"), "replacement")
    await assert.rejects(anchor.assertStable())
  } finally {
    await anchor.close()
  }
})
