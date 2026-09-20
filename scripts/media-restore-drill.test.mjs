import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { syncBuiltinESMExports } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import test from "node:test"

import {
  mediaBackupConfirmation,
  parseMediaInventory,
} from "./lib/media-backup.mjs"
import {
  mediaRestoreConfirmation,
  parseMediaRestoreLimits,
  readPrivateMediaManifest,
  validateMediaRestoreSource,
} from "./lib/media-restore-drill.mjs"
import {
  parseMediaRestoreArguments,
  runMediaRestoreDrill,
} from "./media-restore-drill.mjs"

const sha256 = (value) => createHash("sha256").update(value).digest("hex")
const source = "offsite/catalog"
const target = "disposable/catalog"
const item = { key: "cover.webp", size: 4 }
const inventorySha256 = sha256(JSON.stringify([item]))
const contentSha256 = sha256(
  `${JSON.stringify([item.key, item.size, sha256("good")])}\n`
)
const backup = () => ({
  schemaVersion: 3,
  status: "verified",
  recoveryScope: "current_state_only",
  sourceId: mediaBackupConfirmation("origin/catalog", "inventory"),
  targetId: mediaBackupConfirmation(source, "inventory"),
  inventorySha256,
  targetInventorySha256: inventorySha256,
  contentSha256,
  objectCount: 1,
  bytes: 4,
  verifiedObjects: 1,
  verificationReadBytes: 8,
  verificationAlgorithm: "SHA256",
  preservedTargetObjects: 0,
})

const fakeMc = `#!/usr/bin/env node
const {appendFileSync,existsSync,readFileSync,writeFileSync}=require('node:fs');
const args=process.argv.slice(2);
appendFileSync(process.env.RR_RESTORE_CALLS,JSON.stringify(args)+'\\n');
const scenario=process.env.RR_RESTORE_SCENARIO;
const source='offsite/catalog',target='disposable/catalog';
const copied=existsSync(process.env.RR_RESTORE_COPIED);
if(args[0]==='--version') console.log('mc version RELEASE.2026-08-13T18-18-13Z');
else if(args[0]==='ls') {
 const endpoint=args.at(-1);
 const present=endpoint===source || copied || scenario==='populated' || (scenario==='late-populated'&&Number(readFileSync(process.env.RR_RESTORE_TARGET_LISTS,'utf8')||'0')>=1);
 if(endpoint===target) {
  const count=Number(readFileSync(process.env.RR_RESTORE_TARGET_LISTS,'utf8')||'0');
  writeFileSync(process.env.RR_RESTORE_TARGET_LISTS,String(count+1));
 }
 if(present) console.log(JSON.stringify({key:scenario==='source-drift'&&endpoint===source?'other.webp':'cover.webp',size:4,status:'success',type:'file'}));
 if(scenario==='extra-after-copy'&&endpoint===target&&copied) console.log(JSON.stringify({key:'extra.webp',size:1,status:'success',type:'file'}));
} else if(args[0]==='mirror') {
 if(args.includes('--dry-run')) { if(scenario==='dry-run-error') process.exitCode=9; }
 else if(scenario==='partial') { writeFileSync(process.env.RR_RESTORE_COPIED,'partial');process.exitCode=9; }
 else if(scenario==='hang') {
  writeFileSync(process.env.RR_RESTORE_READY,String(process.pid));
  process.on('SIGTERM',()=>{});setInterval(()=>{},1000);
 } else writeFileSync(process.env.RR_RESTORE_COPIED,'copied');
} else if(args[0]==='cat') {
 process.stdout.write(scenario==='corrupt'&&args[1].startsWith(target)?'evil':'good');
} else process.exitCode=9;
`

const fixture = async (run) => {
  const root = await mkdtemp(join(tmpdir(), "rr-media-restore-test-"))
  const manifestPath = join(root, "backup.json")
  const manifestBytes = Buffer.from(`${JSON.stringify(backup())}\n`)
  const manifestSha256 = sha256(manifestBytes)
  const mcPath = join(root, "mc")
  const callsPath = join(root, "calls.jsonl")
  const targetLists = join(root, "target-lists")
  const copied = join(root, "copied")
  const ready = join(root, "ready")
  const outputDirectory = join(root, "evidence")
  await writeFile(manifestPath, manifestBytes, { mode: 0o600 })
  await writeFile(mcPath, fakeMc, { mode: 0o700 })
  await writeFile(targetLists, "0", { mode: 0o600 })
  const environment = (scenario, extras = {}) => ({
    PATH: `${root}:${dirname(process.execPath)}:${process.env.PATH}`,
    MEDIA_RESTORE_SOURCE: source,
    MEDIA_RESTORE_TARGET: target,
    MEDIA_RESTORE_MANIFEST: manifestPath,
    MEDIA_RESTORE_MANIFEST_SHA256: manifestSha256,
    MEDIA_RESTORE_OUTPUT_DIR: outputDirectory,
    MEDIA_RESTORE_CONFIRM: mediaRestoreConfirmation(
      source,
      target,
      manifestSha256
    ),
    MEDIA_RESTORE_MAX_TRANSFER_BYTES: "4",
    MEDIA_RESTORE_VERIFY_MAX_BYTES: "8",
    MEDIA_RESTORE_TIMEOUT_MS: "5000",
    RR_RESTORE_CALLS: callsPath,
    RR_RESTORE_SCENARIO: scenario,
    RR_RESTORE_TARGET_LISTS: targetLists,
    RR_RESTORE_COPIED: copied,
    RR_RESTORE_READY: ready,
    ...extras,
  })
  const invoke = (scenario, apply = true, extras = {}) => {
    const result = spawnSync(
      process.execPath,
      [
        resolve("scripts/media-restore-drill.mjs"),
        "--current-state-only",
        ...(apply ? ["--apply"] : []),
      ],
      {
        env: environment(scenario, extras),
        encoding: "utf8",
        timeout: 6_000,
        maxBuffer: 1024 * 1024,
      }
    )
    assert.equal(result.error, undefined)
    assert.equal(result.signal, null)
    assert.doesNotMatch(
      `${result.stderr}${result.stdout}`,
      /cover\.webp|origin\/catalog|offsite\/catalog|disposable\/catalog/u
    )
    return result
  }
  try {
    await run({
      root,
      manifestPath,
      manifestSha256,
      manifestBytes,
      callsPath,
      copied,
      ready,
      outputDirectory,
      environment,
      invoke,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const calls = async (path) =>
  (await readFile(path, "utf8")).trim().split("\n").map(JSON.parse)

test("arguments and budgets are explicit and bounded", () => {
  assert.deepEqual(parseMediaRestoreArguments(["--help"], {}), { mode: "help" })
  assert.throws(() => parseMediaRestoreArguments([], {}))
  assert.throws(() => parseMediaRestoreArguments(["--apply", "--apply"], {}))
  assert.throws(() =>
    parseMediaRestoreArguments(
      ["--current-state-only", "--current-state-only"],
      {}
    )
  )
  assert.throws(() =>
    parseMediaRestoreArguments(["--current-state-only"], {
      MEDIA_RESTORE_SOURCE: source,
      MEDIA_RESTORE_TARGET: target,
      MEDIA_RESTORE_MANIFEST: "/tmp/private/backup.json",
      MEDIA_RESTORE_MANIFEST_SHA256: "a".repeat(64),
      MEDIA_RESTORE_OUTPUT_DIR: "/tmp/private/evidence",
      MEDIA_RESTORE_TIMEOUT_MS: "999",
    })
  )
  for (const value of [undefined, "0", "-1", "9x"])
    assert.throws(() =>
      parseMediaRestoreLimits({
        MEDIA_RESTORE_MAX_TRANSFER_BYTES: value,
        MEDIA_RESTORE_VERIFY_MAX_BYTES: "8",
      })
    )
  assert.deepEqual(
    parseMediaRestoreLimits({
      MEDIA_RESTORE_MAX_TRANSFER_BYTES: "4",
      MEDIA_RESTORE_VERIFY_MAX_BYTES: "8",
    }),
    {
      transferBytes: 4,
      verificationBytes: 8,
      maxObjects: 10_000,
      timeoutMs: 1_800_000,
    }
  )
})

test("backup manifest binds the off-site endpoint and exact content set", () => {
  const inventory = parseMediaInventory(
    JSON.stringify({ ...item, status: "success", type: "file" })
  )
  assert.equal(validateMediaRestoreSource(backup(), source, inventory).bytes, 4)
  for (const change of [
    (value) => (value.schemaVersion = 2),
    (value) => (value.recoveryScope = undefined),
    (value) => (value.recoveryScope = "all_versions"),
    (value) => (value.targetId = "0".repeat(64)),
    (value) => (value.preservedTargetObjects = 1),
    (value) => (value.contentSha256 = "invalid"),
    (value) => (value.targetInventorySha256 = "0".repeat(64)),
    (value) => (value.verifiedObjects = 0),
  ]) {
    const modified = backup()
    change(modified)
    assert.throws(() => validateMediaRestoreSource(modified, source, inventory))
  }
})

test("private manifest rejects tampered bytes and public file mode", () =>
  fixture(async ({ manifestPath, manifestSha256 }) => {
    const signal = new AbortController().signal
    assert.equal(
      (await readPrivateMediaManifest(manifestPath, manifestSha256, signal))
        .contentSha256,
      contentSha256
    )
    await assert.rejects(
      readPrivateMediaManifest(manifestPath, "0".repeat(64), signal)
    )
    await chmod(manifestPath, 0o644)
    await assert.rejects(
      readPrivateMediaManifest(manifestPath, manifestSha256, signal)
    )
  }))

test("private manifest rejects path replacement after descriptor open", () =>
  fixture(async ({ manifestPath, manifestSha256, root }) => {
    const original = fs.lstat
    let replaced = false
    fs.lstat = async (path, ...args) => {
      if (path === manifestPath && !replaced) {
        replaced = true
        await fs.rename(manifestPath, join(root, "original-manifest.json"))
        await fs.writeFile(manifestPath, `${JSON.stringify(backup())}\n`, {
          mode: 0o600,
        })
      }
      return original(path, ...args)
    }
    syncBuiltinESMExports()
    try {
      await assert.rejects(
        readPrivateMediaManifest(
          manifestPath,
          manifestSha256,
          AbortSignal.timeout(1000)
        )
      )
      assert.equal(replaced, true)
    } finally {
      fs.lstat = original
      syncBuiltinESMExports()
    }
  }))

test("tampered manifest pin fails before contacting mc", () =>
  fixture(async ({ invoke, callsPath }) => {
    const result = invoke("success", true, {
      MEDIA_RESTORE_MANIFEST_SHA256: "0".repeat(64),
    })
    assert.equal(result.status, 1)
    await assert.rejects(readFile(callsPath), { code: "ENOENT" })
  }))

for (const [name, update] of [
  ["legacy schema", (value) => (value.schemaVersion = 2)],
  [
    "unsupported history scope",
    (value) => (value.recoveryScope = "all_versions"),
  ],
]) {
  test(`${name} manifest fails before contacting mc`, () =>
    fixture(async ({ manifestPath, invoke, callsPath }) => {
      const modified = backup()
      update(modified)
      const bytes = `${JSON.stringify(modified)}\n`
      await writeFile(manifestPath, bytes)
      const result = invoke("success", true, {
        MEDIA_RESTORE_MANIFEST_SHA256: sha256(bytes),
      })
      assert.equal(result.status, 1)
      assert.equal(JSON.parse(result.stderr).phase, "manifest")
      await assert.rejects(readFile(callsPath), { code: "ENOENT" })
    }))
}

test("restore refuses an implicit current-state acknowledgement before contacting mc", () =>
  fixture(async ({ environment, callsPath }) => {
    for (const args of [
      [],
      ["--apply"],
      ["--current-state-only", "--current-state-only"],
    ]) {
      const result = spawnSync(
        process.execPath,
        [resolve("scripts/media-restore-drill.mjs"), ...args],
        { env: environment("success"), encoding: "utf8", timeout: 5_000 }
      )
      assert.equal(result.status, 1)
      assert.equal(JSON.parse(result.stderr).phase, "arguments")
    }
    await assert.rejects(readFile(callsPath), { code: "ENOENT" })
  }))

test("dry run lists only and reports transfer and verification costs", () =>
  fixture(async ({ invoke, callsPath, outputDirectory }) => {
    const result = invoke("success", false, {
      MEDIA_RESTORE_MAX_TRANSFER_BYTES: undefined,
      MEDIA_RESTORE_VERIFY_MAX_BYTES: undefined,
    })
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.status, "dry_run")
    assert.equal(report.recoveryScope, "current_state_only")
    assert.equal(report.transferBytes, 4)
    assert.equal(report.verificationReadBytes, 8)
    assert.deepEqual((await calls(callsPath)).at(-1).slice(0, 2), [
      "mirror",
      "--dry-run",
    ])
    assert.equal(
      (await calls(callsPath)).some(([command]) => command === "cat"),
      false
    )
    assert.deepEqual(await readdir(outputDirectory), [])
  }))

test("apply verifies restored bytes and publishes a private receipt", () =>
  fixture(async ({ invoke, callsPath, outputDirectory }) => {
    const result = invoke("success")
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.status, "media_restore_verified")
    assert.equal(report.schemaVersion, 2)
    assert.equal(report.recoveryScope, "current_state_only")
    assert.equal(report.contentSha256, contentSha256)
    assert.equal(report.objectCount, 1)
    const names = await readdir(outputDirectory)
    assert.equal(names.length, 1)
    assert.equal(
      (await stat(join(outputDirectory, names[0]))).mode & 0o777,
      0o600
    )
    assert.equal(
      JSON.parse(await readFile(join(outputDirectory, names[0])))
        .backupContentSha256,
      contentSha256
    )
    const commandList = await calls(callsPath)
    assert.equal(commandList.filter(([command]) => command === "ls").length, 4)
    assert.deepEqual(
      commandList.filter(([command]) => command === "cat"),
      [
        ["cat", `${source}/${item.key}`],
        ["cat", `${target}/${item.key}`],
      ]
    )
    assert.equal(commandList.flat().includes("--remove"), false)
    assert.deepEqual(
      commandList.filter(([command]) => command === "mirror"),
      [["mirror", "--overwrite", "--checksum", "SHA256", source, target]]
    )
  }))

for (const scenario of [
  "source-drift",
  "populated",
  "late-populated",
  "extra-after-copy",
  "corrupt",
  "partial",
])
  test(`rejects ${scenario} without a success receipt`, () =>
    fixture(async ({ invoke, callsPath, outputDirectory }) => {
      const result = invoke(scenario)
      assert.equal(result.status, 1, result.stderr)
      assert.deepEqual(await readdir(outputDirectory), [])
      const commandList = await calls(callsPath)
      if (["source-drift", "populated", "late-populated"].includes(scenario))
        assert.equal(
          commandList.some(([command]) => command === "mirror"),
          false
        )
    }))

for (const [name, override] of [
  ["wrong confirmation", { MEDIA_RESTORE_CONFIRM: "0".repeat(64) }],
  ["insufficient transfer budget", { MEDIA_RESTORE_MAX_TRANSFER_BYTES: "3" }],
  ["insufficient read budget", { MEDIA_RESTORE_VERIFY_MAX_BYTES: "7" }],
])
  test(`${name} fails before mirror`, () =>
    fixture(async ({ invoke, callsPath, outputDirectory }) => {
      const result = invoke("success", true, override)
      assert.equal(result.status, 1)
      assert.equal(
        (await calls(callsPath)).some(([command]) => command === "mirror"),
        false
      )
      assert.deepEqual(await readdir(outputDirectory), [])
    }))

test("failed receipt publication removes only the owned local receipt", () =>
  fixture(async ({ environment, outputDirectory }) => {
    let copied = false
    const itemLine = JSON.stringify({
      ...item,
      status: "success",
      type: "file",
    })
    const errors = []
    const result = await runMediaRestoreDrill({
      args: ["--current-state-only", "--apply"],
      environment: environment("success"),
      runMc: async (args) => {
        if (args[0] === "--version")
          return "mc version RELEASE.2026-08-13T18-18-13Z"
        if (args[0] === "ls")
          return args.at(-1) === source || copied ? itemLine : ""
        if (args[0] === "mirror") {
          copied = true
          return ""
        }
        assert.fail("Unexpected media client command.")
      },
      hashObject: async () => ({ bytes: 4, sha256: sha256("good") }),
      write: () => {
        throw new Error("private output failure")
      },
      writeError: (line) => errors.push(JSON.parse(line)),
    })
    assert.equal(result, 1)
    assert.equal(errors[0].phase, "publish")
    assert.deepEqual(await readdir(outputDirectory), [])
  }))

test("SIGTERM cancels and reaps the active mc child without a receipt", () =>
  fixture(async ({ environment, ready, outputDirectory }) => {
    const child = spawn(
      process.execPath,
      [
        resolve("scripts/media-restore-drill.mjs"),
        "--current-state-only",
        "--apply",
      ],
      {
        env: environment("hang"),
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
    const closed = new Promise((done) => child.once("close", done))
    let mcPid
    try {
      const deadline = Date.now() + 4_000
      while (!mcPid && Date.now() < deadline) {
        try {
          mcPid = Number(await readFile(ready, "utf8"))
        } catch {
          await new Promise((done) => setTimeout(done, 20))
        }
      }
      assert.ok(Number.isSafeInteger(mcPid) && mcPid > 0)
      child.kill("SIGTERM")
      assert.equal(await closed, 1)
      assert.deepEqual(await readdir(outputDirectory), [])
      assert.throws(() => process.kill(mcPid, 0), { code: "ESRCH" })
    } finally {
      child.kill("SIGKILL")
      await closed
    }
  }))
