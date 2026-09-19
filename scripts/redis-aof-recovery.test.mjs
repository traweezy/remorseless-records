import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  parseAofManifest,
  verifyRedisAofArchive,
} from "./lib/redis-aof-recovery.mjs"
import { runRedisAofRecoveryCli } from "./redis-aof-recovery.mjs"

const manifest =
  "file appendonly.aof.1.base.rdb seq 1 type b\n" +
  "file appendonly.aof.1.incr.aof seq 1 type i\n"
const baseName = "appendonly.aof.1.base.rdb"
const incrementName = "appendonly.aof.1.incr.aof"

const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), "redis-aof-test-"))
  const checker = join(directory, "redis-check-aof")
  await writeFile(join(directory, "appendonly.aof.manifest"), manifest, {
    mode: 0o600,
  })
  await writeFile(join(directory, baseName), "REDIS0009fixture", {
    mode: 0o600,
  })
  await writeFile(join(directory, incrementName), "*1\r\n$4\r\nPING\r\n", {
    mode: 0o600,
  })
  await writeFile(checker, "#!/bin/sh\nexit 0\n", { mode: 0o700 })
  const checkerSha256 = createHash("sha256")
    .update(await readFile(checker))
    .digest("hex")
  // The checker lives outside the strict archive inventory.
  const archive = await mkdtemp(join(tmpdir(), "redis-aof-archive-"))
  for (const name of ["appendonly.aof.manifest", baseName, incrementName]) {
    await writeFile(
      join(archive, name),
      await readFile(join(directory, name)),
      {
        mode: 0o600,
      }
    )
  }
  return {
    archive,
    checker,
    checkerSha256,
    cleanup: async () => {
      await rm(archive, { recursive: true, force: true })
      await rm(directory, { recursive: true, force: true })
    },
  }
}

const successRunner = async (_checker, argumentsList) => {
  if (argumentsList[0] === "--version")
    return "redis-check-aof v=8.10.1 sha=00000000:1 malloc=jemalloc-5.3.0 bits=64 build=102f0f73631d93c4"
  assert.equal(argumentsList.length, 1)
  assert.match(argumentsList[0], /\/appendonly\.aof\.manifest$/u)
  return (
    "Start checking Multi Part AOF\n" +
    `BASE AOF ${baseName} is valid\n` +
    `INCR AOF ${incrementName} is valid\n` +
    "All AOF files and manifest are valid"
  )
}

test("accepts only an unambiguous BASE plus ordered INCR manifest", () => {
  assert.deepEqual(parseAofManifest(manifest), [
    { name: baseName, sequence: 1, type: "b" },
    { name: incrementName, sequence: 1, type: "i" },
  ])
  assert.equal(parseAofManifest(manifest.split("\n")[0] + "\n").length, 1)
  assert.equal(parseAofManifest(manifest.split("\n")[1] + "\n").length, 1)
  const withHistory =
    "file appendonly.aof.2.base.rdb seq 2 type b\n" +
    "file appendonly.aof.1.base.rdb seq 1 type h\n" +
    "file appendonly.aof.2.incr.aof seq 2 type i startoffset 12 endoffset 18\n"
  assert.deepEqual(
    parseAofManifest(withHistory).map(({ type }) => type),
    ["b", "h", "i"]
  )
  assert.equal(parseAofManifest(withHistory)[2].endOffset, 18)
  for (const invalid of [
    "",
    manifest.trimEnd(),
    manifest.replace("type b", "type z"),
    manifest.replace("base.rdb", "base.rdb/../escape"),
    manifest.replace("seq 1 type i", "seq 2 type i"),
    manifest.replace("type i", "type h").replace("type b", "type h"),
    manifest + manifest.split("\n")[1] + "\n",
    manifest.replace("appendonly.aof.1.incr.aof", "other.aof.1.incr.aof"),
    manifest.replace("\n", "\r\n"),
    withHistory.replace("endoffset 18", "endoffset 11"),
    withHistory.replace("startoffset 12", "startoffset -1"),
    withHistory.replace("type h", "type i"),
  ])
    assert.throws(() => parseAofManifest(invalid), /unavailable/u)
})

test("copies and hashes a private archive, runs the checker on the copy, and reports no paths", async () => {
  const source = await fixture()
  try {
    const report = await verifyRedisAofArchive({
      sourceDirectory: source.archive,
      checker: source.checker,
      checkerSha256: source.checkerSha256,
      runCommand: successRunner,
    })
    assert.equal(report.status, "verified")
    assert.equal(report.fileCount, 3)
    assert.equal(report.replayProven, false)
    assert.match(report.setSha256, /^[a-f0-9]{64}$/u)
    assert.doesNotMatch(
      JSON.stringify(report),
      /redis-aof-test|redis-aof-archive|PING/u
    )
    assert.equal(
      (await readFile(join(source.archive, baseName))).toString(),
      "REDIS0009fixture"
    )
  } finally {
    await source.cleanup()
  }
})

test("rejects ambiguity, unsafe files, oversized data and checker mutation", async () => {
  const source = await fixture()
  try {
    const options = {
      sourceDirectory: source.archive,
      checker: source.checker,
      checkerSha256: source.checkerSha256,
      runCommand: successRunner,
    }
    await assert.rejects(
      verifyRedisAofArchive({ ...options, maxBytes: 8 }),
      /unavailable/u
    )
    await assert.rejects(
      verifyRedisAofArchive({ ...options, checkerSha256: "0".repeat(64) }),
      /unavailable/u
    )
    await writeFile(join(source.archive, "extra"), "x", { mode: 0o600 })
    await assert.rejects(verifyRedisAofArchive(options), /unavailable/u)
    await rm(join(source.archive, "extra"))
    await chmod(join(source.archive, baseName), 0o644)
    await assert.rejects(verifyRedisAofArchive(options), /unavailable/u)
    await chmod(join(source.archive, baseName), 0o600)
    await rm(join(source.archive, baseName))
    await symlink(
      join(source.archive, incrementName),
      join(source.archive, baseName)
    )
    await assert.rejects(verifyRedisAofArchive(options), /unavailable/u)
    await rm(join(source.archive, baseName))
    await writeFile(join(source.archive, baseName), "REDIS0009fixture", {
      mode: 0o600,
    })
    await assert.rejects(
      verifyRedisAofArchive({
        ...options,
        runCommand: async (_checker, args) => {
          if (args[0] === "--version")
            return "redis-check-aof v=8.10.1 sha=00000000:1 malloc=jemalloc-5.3.0 bits=64 build=102f0f73631d93c4"
          const snapshotDirectory = args[0].slice(
            0,
            -"/appendonly.aof.manifest".length
          )
          await writeFile(join(snapshotDirectory, baseName), "changed")
          return successRunner(_checker, args)
        },
      }),
      /unavailable/u
    )
  } finally {
    await source.cleanup()
  }
})

test("rejects an overlong checker manifest path before execution", async () => {
  const source = await fixture()
  const parent = await mkdtemp(join(tmpdir(), "redis-aof-long-tmp-"))
  const previous = process.env.TMPDIR
  try {
    const longParent = join(parent, "a".repeat(180))
    await mkdir(longParent, { mode: 0o700 })
    process.env.TMPDIR = longParent
    let invoked = false
    await assert.rejects(
      verifyRedisAofArchive({
        sourceDirectory: source.archive,
        checker: source.checker,
        checkerSha256: source.checkerSha256,
        runCommand: async () => {
          invoked = true
          return ""
        },
      }),
      /unavailable/u
    )
    assert.equal(invoked, false)
  } finally {
    if (previous === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = previous
    await rm(parent, { recursive: true, force: true })
    await source.cleanup()
  }
})

test("CLI help, argument errors and success remain credential-free", async () => {
  const output = []
  const errors = []
  const shared = {
    write: (value) => output.push(value),
    writeError: (value) => errors.push(value),
  }
  assert.equal(await runRedisAofRecoveryCli({ ...shared, args: ["--help"] }), 0)
  assert.match(output.join(""), /Usage: pnpm run data:redis:aof:verify/u)
  assert.equal(
    await runRedisAofRecoveryCli({ ...shared, args: ["--unknown"] }),
    1
  )
  assert.doesNotMatch(errors.join(""), /--unknown/u)
  const source = await fixture()
  try {
    assert.equal(
      await runRedisAofRecoveryCli({
        ...shared,
        args: ["--archive-dir", source.archive, "--checker", source.checker],
        environment: { REDIS_AOF_CHECKER_SHA256: source.checkerSha256 },
        verify: async () => ({ schemaVersion: 1, status: "verified" }),
      }),
      0
    )
    assert.match(output.at(-1), /redis\.aof_verification\.completed/u)
    assert.doesNotMatch(output.at(-1), /redis-aof-archive/u)
  } finally {
    await source.cleanup()
  }
})
