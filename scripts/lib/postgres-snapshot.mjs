import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { lstat, open, realpath, rename } from "node:fs/promises"
import { dirname, resolve } from "node:path"

const snapshotPattern = /^[A-Za-z0-9:_-]{1,128}$/u

// The output handle pins the directory inode while ancestry checks rule out
// another user redirecting a pathname between staging and publication.
export const openPrivateOutputDirectory = async (path) => {
  assert.equal(resolve(path), path)
  const owner = process.getuid()
  const ancestors = []
  for (let current = path; ; current = dirname(current)) {
    const metadata = await lstat(current)
    assert.ok(metadata.isDirectory() && !metadata.isSymbolicLink())
    assert.ok(metadata.uid === owner || metadata.uid === 0)
    if (current === path) {
      assert.equal(metadata.uid, owner)
      assert.equal(metadata.mode & 0o077, 0)
    } else {
      const writable = metadata.mode & 0o022
      assert.ok(
        !writable || (metadata.uid === 0 && (metadata.mode & 0o1000) !== 0)
      )
    }
    ancestors.push({
      path: current,
      dev: metadata.dev,
      ino: metadata.ino,
      uid: metadata.uid,
      mode: metadata.mode & 0o7777,
    })
    if (current === dirname(current)) break
  }
  assert.equal(await realpath(path), path)
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  )
  try {
    const assertStable = async () => {
      const pinned = await handle.stat()
      assert.equal(pinned.dev, ancestors[0].dev)
      assert.equal(pinned.ino, ancestors[0].ino)
      for (const ancestor of ancestors) {
        const current = await lstat(ancestor.path)
        assert.ok(current.isDirectory() && !current.isSymbolicLink())
        assert.equal(current.dev, ancestor.dev)
        assert.equal(current.ino, ancestor.ino)
        assert.equal(current.uid, ancestor.uid)
        assert.equal(current.mode & 0o7777, ancestor.mode)
      }
      assert.equal(await realpath(path), path)
    }
    await assertStable()
    return { assertStable, close: () => handle.close() }
  } catch (error) {
    await handle.close()
    throw error
  }
}

// The caller transfers cleanup ownership synchronously as soon as rename
// completes, then cancellation and directory identity are checked again.
export const publishSnapshotDirectory = async ({
  pendingDirectory,
  publishedDirectory,
  signal,
  outputDirectory,
  onRenamed,
  renameDirectory = rename,
}) => {
  signal.throwIfAborted()
  await outputDirectory.assertStable()
  signal.throwIfAborted()
  await renameDirectory(pendingDirectory, publishedDirectory)
  onRenamed(publishedDirectory)
  signal.throwIfAborted()
  await outputDirectory.assertStable()
  signal.throwIfAborted()
}

// Keep the exporting transaction open until every reader has imported its
// snapshot. No credentials, SQL errors, or server output escape this boundary.
export const openPostgresSnapshot = async ({ environment, signal }) => {
  signal.throwIfAborted()
  const child = spawn(
    "psql",
    [
      "--no-psqlrc",
      "--no-password",
      "--quiet",
      "--tuples-only",
      "--no-align",
      "--set=ON_ERROR_STOP=1",
    ],
    {
      env: environment,
      stdio: ["pipe", "pipe", "ignore"],
      signal,
      killSignal: "SIGKILL",
    }
  )

  let closed = false
  let faulted = false
  let output = ""
  let settled = false
  let resolveSnapshot
  let rejectSnapshot
  const snapshotPromise = new Promise((resolve, reject) => {
    resolveSnapshot = resolve
    rejectSnapshot = reject
  })
  void snapshotPromise.catch(() => {})
  const fail = () => {
    faulted = true
    if (!settled) {
      settled = true
      rejectSnapshot(new Error("PostgreSQL snapshot exporter failed."))
    }
    child.kill("SIGKILL")
  }
  const closePromise = new Promise((resolve) => {
    child.once("close", () => {
      closed = true
      if (!settled) {
        settled = true
        rejectSnapshot(new Error("PostgreSQL snapshot exporter closed."))
      }
      resolve()
    })
  })
  child.on("error", fail)
  child.stdin.on("error", fail)
  child.stdout.on("error", fail)
  child.stdout.on("data", (chunk) => {
    if (settled) {
      if (chunk.toString("utf8").trim() !== "") fail()
      return
    }
    output += chunk.toString("utf8")
    if (output.length > 256) {
      fail()
      return
    }
    const newline = output.indexOf("\n")
    if (newline === -1) return
    const snapshot = output.slice(0, newline).trim()
    if (
      !snapshotPattern.test(snapshot) ||
      output.slice(newline + 1).trim() !== ""
    ) {
      fail()
      return
    }
    settled = true
    resolveSnapshot(snapshot)
  })
  try {
    child.stdin.write(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n" +
        "SET LOCAL search_path = pg_catalog;\n" +
        "SELECT pg_catalog.pg_export_snapshot();\n"
    )
    const snapshot = await snapshotPromise
    assert.ok(!closed && !faulted && !signal.aborted)
    return {
      snapshot,
      assertOpen: () => assert.ok(!closed && !faulted && !signal.aborted),
      close: async () => {
        if (!closed) child.kill("SIGKILL")
        await closePromise
      },
    }
  } catch {
    if (!closed) child.kill("SIGKILL")
    await closePromise
    throw new Error("PostgreSQL snapshot exporter failed.")
  }
}
