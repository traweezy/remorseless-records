import assert from "node:assert/strict"
import { open } from "node:fs/promises"
import {
  appendFile,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { readBoundedObservationFile } from "./lib/bounded-observation-file.mjs"

const withDirectory = async (run) => {
  const directory = await mkdtemp(join(tmpdir(), "rr-observation-file-"))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const unavailable = { message: "Observation input unavailable." }

test("reads exact-cap regular UTF-8 inputs and rejects larger or malformed data", async () => {
  await withDirectory(async (directory) => {
    const path = join(directory, "body.json")
    await writeFile(path, "éé")
    assert.equal(await readBoundedObservationFile(path, 4), "éé")
    await assert.rejects(readBoundedObservationFile(path, 3), unavailable)
    await writeFile(path, Buffer.from([0xc3, 0x28]))
    await assert.rejects(readBoundedObservationFile(path, 4), unavailable)
  })
})

test("rejects symlink, directory, and invalid limits without opening content", async () => {
  await withDirectory(async (directory) => {
    const target = join(directory, "private")
    const link = join(directory, "body.json")
    await writeFile(target, "private customer payload")
    await symlink(target, link)
    await assert.rejects(readBoundedObservationFile(link, 64), unavailable)
    await assert.rejects(readBoundedObservationFile(directory, 64), unavailable)
    await assert.rejects(readBoundedObservationFile(target, 0), unavailable)
    await assert.rejects(
      readBoundedObservationFile(target, 128 * 1024 + 1),
      unavailable
    )
  })
})

test("reads the opened inode when the original path is replaced", async () => {
  await withDirectory(async (directory) => {
    const path = join(directory, "body.json")
    await writeFile(path, '{"status":"healthy"}')
    const read = await readBoundedObservationFile(path, 128, {
      openFile: async (...args) => {
        const handle = await open(...args)
        await rename(path, join(directory, "old-body.json"))
        await writeFile(path, '{"private":"customer@example.com"}')
        return handle
      },
    })
    assert.equal(read, '{"status":"healthy"}')
    assert.doesNotMatch(read, /customer@example/u)
  })
})

test("rejects an opened file that grows after its initial size check", async () => {
  await withDirectory(async (directory) => {
    const path = join(directory, "body.json")
    await writeFile(path, "safe")
    await assert.rejects(
      readBoundedObservationFile(path, 4, {
        openFile: async (...args) => {
          const handle = await open(...args)
          const read = handle.read.bind(handle)
          let first = true
          return {
            close: () => handle.close(),
            read: async (...readArgs) => {
              if (first) {
                first = false
                await appendFile(path, "private customer payload")
              }
              return read(...readArgs)
            },
            stat: (...statArgs) => handle.stat(...statArgs),
          }
        },
      }),
      unavailable
    )
  })
})
