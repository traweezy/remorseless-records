import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { EventEmitter, once } from "node:events"
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

import { mediaBackupConfirmation } from "./lib/media-backup.mjs"
import {
  createMediaBackupScope,
  runMediaBackupCommand,
} from "./lib/media-backup-command.mjs"

const executable = `#!/usr/bin/env node
const {appendFileSync,renameSync,writeFileSync}=require('node:fs');
const args=process.argv.slice(2);
appendFileSync(process.env.RR_TEST_MC_CALLS, JSON.stringify(args)+'\\n');
const scenario=process.env.RR_TEST_MC_SCENARIO;
const phase=args[0]==='--version'?'client_version':args[0]==='ls'?(args.at(-1).startsWith('source/')?'source_inventory':'target_inventory'):args[0]==='mirror'?(args.includes('--dry-run')?'dry_run':'mirror'):(args[1].startsWith('source/')?'source_content':'target_content');
if(phase===process.env.RR_TEST_MC_STOP_PHASE) {
 if(process.env.RR_TEST_MC_STOP_KIND==='failure') {
  console.error('https://user:secret@private-provider/object private-reader-secret');
  console.log('private-provider private-reader-secret');
  process.exitCode=7;
 } else {
  process.on('SIGINT',()=>{});
  process.on('SIGTERM',()=>{});
  // Publish only the complete PID so the waiting parent cannot read a new empty file.
  const pendingReady=process.env.RR_TEST_MC_READY+'.pending';
  writeFileSync(pendingReady,String(process.pid),{mode:0o600,flag:'wx'});
  renameSync(pendingReady,process.env.RR_TEST_MC_READY);
  setInterval(()=>{},1000);
 }
} else if(args[0]==='--version') { console.log('mc version RELEASE.2026-08-13T18-18-13Z'); }
else if(args[0]==='ls') {
 const rows=[{key: scenario==='unsafe-key'?'../private':'cover.webp',size:4,status:'success',type:'file'}];
 if(args.at(-1).startsWith('target/')) rows.push({key:'retained.webp',size:3,status:'success',type:'file'});
 rows.forEach(row=>console.log(JSON.stringify(row)));
} else if(args[0]==='mirror') {
 if(scenario==='mirror-error') { console.error('https://user:secret@private-provider/object'); process.exitCode=7; }
} else if(args[0]==='cat') {
 if(scenario==='stalled') setInterval(()=>{},1000);
 else {
  process.stdout.write(scenario==='corrupt'&&args[1].startsWith('target/')?'evil':'good');
  if(scenario==='reader-error') { console.error('private-reader-secret'); process.exitCode=9; }
 }
} else process.exitCode=8;
`

// Test-only filesystem hooks place cancellation at deterministic publication
// boundaries. The real CLI has no injection flags or alternative runtime path.
const publicationHooks = `
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
const open=fs.open;
const before=['SIGINT','SIGTERM'].map(signal=>process.listenerCount(signal));
process.once('beforeExit',()=>{
 if(['SIGINT','SIGTERM'].some((signal,index)=>process.listenerCount(signal)!==before[index])) {
  process.stderr.write('fixture detected retained signal listeners');process.exitCode=2;
 }
});
fs.open=async(path,...options)=>{
 if(!String(path).startsWith(process.env.MEDIA_BACKUP_OUTPUT_DIR+'/media-backup-')) return open(path,...options);
 const scenario=process.env.RR_TEST_PUBLICATION;
 if(scenario==='collision') {
  const existing=await open(path,'wx',0o600);
  try {await existing.writeFile('unrelated-existing-evidence')} finally {await existing.close()}
 }
 const file=await open(path,...options);
 const write=file.writeFile.bind(file),close=file.close.bind(file);
 file.writeFile=async(...args)=>{
  if(scenario==='write-failure') {await write('partial');throw new Error('private-publication-secret')}
  await write(...args);
  if(scenario==='after-write') process.emit('SIGTERM');
 };
 file.close=async()=>{
  await close();
  if(scenario==='close-failure') throw new Error('private-publication-secret');
  if(scenario==='after-close') process.emit('SIGINT');
 };
 if(scenario==='after-open') process.emit('SIGINT');
 return file;
};
syncBuiltinESMExports();
`

const withFixture = async (run) => {
  const directory = await mkdtemp(join(tmpdir(), "remorseless-media-cli-"))
  try {
    await writeFile(join(directory, "mc"), executable, { mode: 0o700 })
    const preloadPath = join(directory, "publication-hooks.mjs")
    await writeFile(preloadPath, publicationHooks, { mode: 0o600 })
    const callsPath = join(directory, "calls.jsonl")
    const outputDirectory = join(directory, "evidence")
    const readyPath = join(directory, "ready.pid")
    const environment = (scenario, overrides = {}) => ({
      PATH: `${directory}:${process.env.PATH}`,
      MEDIA_BACKUP_SOURCE: "source/catalog",
      MEDIA_BACKUP_TARGET: "target/catalog",
      MEDIA_BACKUP_OUTPUT_DIR: outputDirectory,
      MEDIA_BACKUP_CONFIRM: mediaBackupConfirmation(
        "source/catalog",
        "target/catalog"
      ),
      MEDIA_BACKUP_VERIFY_MAX_BYTES: "8",
      MEDIA_BACKUP_VERIFY_TIMEOUT_MS: "3000",
      RR_TEST_MC_CALLS: callsPath,
      RR_TEST_MC_SCENARIO: scenario,
      RR_TEST_MC_READY: readyPath,
      ...overrides,
    })
    const invoke = (scenario, apply = true, overrides = {}) => {
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          preloadPath,
          resolve("scripts/media-backup.mjs"),
          ...(apply ? ["--apply"] : []),
        ],
        {
          encoding: "utf8",
          timeout: 5_000,
          maxBuffer: 1024 * 1024,
          env: environment(scenario, overrides),
        }
      )
      assert.equal(result.error, undefined)
      assert.equal(result.signal, null)
      assert.doesNotMatch(
        result.stderr,
        /private-provider|private-reader-secret|private-publication-secret|user:secret/u
      )
      return result
    }
    await run({ invoke, callsPath, outputDirectory, readyPath, environment })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test("help explains mutation and verification costs without requiring credentials", () => {
  const result = spawnSync(
    process.execPath,
    [resolve("scripts/media-backup.mjs"), "--help"],
    {
      encoding: "utf8",
      timeout: 5_000,
      env: {},
    }
  )
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Default: dry-run only/u)
  assert.match(result.stdout, /MEDIA_BACKUP_VERIFY_MAX_BYTES/u)
  assert.match(result.stdout, /No deletions or rollback/u)
})

test("dry-run estimates content-read cost without downloading or writing objects", () =>
  withFixture(async ({ invoke, callsPath, outputDirectory }) => {
    const result = invoke("success", false, {
      MEDIA_BACKUP_VERIFY_MAX_BYTES: undefined,
    })
    assert.equal(result.status, 0, result.stderr)
    const evidence = JSON.parse(result.stdout)
    assert.equal(evidence.status, "dry_run")
    assert.equal(evidence.verificationReadBytes, 8)
    assert.equal(evidence.verificationReadRequests, 2)
    const calls = (await readFile(callsPath, "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse)
    assert.equal(
      calls.some((args) => args[0] === "cat"),
      false
    )
    assert.deepEqual(calls.at(-1).slice(0, 2), ["mirror", "--dry-run"])
    assert.deepEqual(await readdir(outputDirectory), [])
  }))

test("apply emits private version-two content evidence only after both readers succeed", () =>
  withFixture(async ({ invoke, callsPath, outputDirectory }) => {
    const result = invoke("success")
    assert.equal(result.status, 0, result.stderr)
    const evidence = JSON.parse(result.stdout)
    assert.equal(evidence.status, "verified")
    assert.equal(evidence.schemaVersion, 2)
    assert.equal(evidence.verifiedObjects, 1)
    assert.equal(evidence.verificationReadBytes, 8)
    assert.equal(evidence.preservedTargetObjects, 1)
    assert.match(evidence.contentSha256, /^[a-f0-9]{64}$/u)
    const files = await readdir(outputDirectory)
    assert.equal(files.length, 1)
    const manifest = JSON.parse(
      await readFile(join(outputDirectory, files[0]), "utf8")
    )
    assert.equal(manifest.contentSha256, evidence.contentSha256)
    assert.equal(
      (await stat(join(outputDirectory, files[0]))).mode & 0o777,
      0o600
    )
    const calls = (await readFile(callsPath, "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse)
    assert.deepEqual(
      calls.filter((args) => args[0] === "cat"),
      [
        ["cat", "source/catalog/cover.webp"],
        ["cat", "target/catalog/cover.webp"],
      ]
    )
    assert.equal(calls.flat().includes("--remove"), false)
  }))

for (const scenario of [
  "corrupt",
  "reader-error",
  "mirror-error",
  "stalled",
  "unsafe-key",
]) {
  test(`apply rejects ${scenario} and never writes a verified manifest`, () =>
    withFixture(async ({ invoke, outputDirectory }) => {
      const result = invoke(
        scenario,
        true,
        scenario === "stalled" ? { MEDIA_BACKUP_VERIFY_TIMEOUT_MS: "100" } : {}
      )
      assert.equal(result.status, 1)
      assert.deepEqual(await readdir(outputDirectory), [])
      assert.doesNotMatch(result.stdout, /verified/u)
    }))
}

for (const budget of [undefined, "7", "0"]) {
  test(`rejects budget ${budget} before the mutating mirror`, () =>
    withFixture(async ({ invoke, callsPath }) => {
      const result = invoke("success", true, {
        MEDIA_BACKUP_VERIFY_MAX_BYTES: budget,
      })
      assert.equal(result.status, 1)
      const calls = (await readFile(callsPath, "utf8"))
        .trim()
        .split("\n")
        .map(JSON.parse)
      assert.equal(
        calls.some((args) => args[0] === "mirror" || args[0] === "cat"),
        false
      )
    }))
}

for (const scenario of [
  "after-open",
  "after-write",
  "after-close",
  "write-failure",
  "close-failure",
]) {
  test(`publication ${scenario} leaves no owned verified manifest`, () =>
    withFixture(async ({ invoke, outputDirectory, callsPath }) => {
      const result = invoke("success", true, { RR_TEST_PUBLICATION: scenario })
      assert.equal(result.status, 1)
      assert.equal(result.stdout, "")
      assert.equal(JSON.parse(result.stderr).phase, "publish")
      assert.deepEqual(await readdir(outputDirectory), [])
      assert.equal((await readCalls(callsPath)).length, 6)
    }))
}

test("publication collision never removes an unowned existing manifest", () =>
  withFixture(async ({ invoke, outputDirectory }) => {
    const result = invoke("success", true, { RR_TEST_PUBLICATION: "collision" })
    assert.equal(result.status, 1)
    assert.equal(result.stdout, "")
    assert.equal(JSON.parse(result.stderr).phase, "publish")
    const files = await readdir(outputDirectory)
    assert.equal(files.length, 1)
    assert.equal(
      await readFile(join(outputDirectory, files[0]), "utf8"),
      "unrelated-existing-evidence"
    )
  }))

const phaseCases = [
  ["client_version", true, 1],
  ["source_inventory", true, 2],
  ["dry_run", false, 3],
  ["mirror", true, 3],
  ["target_inventory", true, 4],
  ["source_content", true, 5],
  ["target_content", true, 6],
]

const readCalls = async (path) =>
  (await readFile(path, "utf8")).trim().split("\n").map(JSON.parse)

const waitForReady = async (path) => {
  const deadline = Date.now() + 2500
  while (Date.now() < deadline) {
    try {
      const pid = Number(await readFile(path, "utf8"))
      assert.ok(Number.isSafeInteger(pid) && pid > 1)
      return pid
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("Fake media client did not reach its bounded ready signal.")
}

const assertProcessAbsent = (pid) =>
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })

for (const [phase, apply, callCount] of phaseCases) {
  test(`rejects ${phase} failure without later commands or verified evidence`, () =>
    withFixture(async ({ invoke, callsPath, outputDirectory }) => {
      const result = invoke("success", apply, {
        RR_TEST_MC_STOP_PHASE: phase,
        RR_TEST_MC_STOP_KIND: "failure",
      })
      assert.equal(result.status, 1)
      assert.equal(result.stdout, "")
      assert.equal(
        JSON.parse(result.stderr).phase,
        phase.endsWith("_content") ? "content_verification" : phase
      )
      assert.equal((await readCalls(callsPath)).length, callCount)
      assert.deepEqual(await readdir(outputDirectory), [])
    }))

  for (const signal of ["SIGINT", "SIGTERM"]) {
    test(
      `${signal} during ${phase} reaps the owned child before exit`,
      { timeout: 6000 },
      () =>
        withFixture(
          async ({ environment, callsPath, outputDirectory, readyPath }) => {
            const child = spawn(
              process.execPath,
              [
                resolve("scripts/media-backup.mjs"),
                ...(apply ? ["--apply"] : []),
              ],
              {
                env: environment("success", { RR_TEST_MC_STOP_PHASE: phase }),
                stdio: ["ignore", "pipe", "pipe"],
              }
            )
            const completed = once(child, "close")
            let stdout = ""
            let stderr = ""
            child.stdout.on("data", (chunk) => {
              stdout += chunk
            })
            child.stderr.on("data", (chunk) => {
              stderr += chunk
            })
            let clientPid
            const timer = setTimeout(() => child.kill("SIGKILL"), 4000)
            try {
              clientPid = await waitForReady(readyPath)
              const callsAtCancellation = await readCalls(callsPath)
              assert.equal(callsAtCancellation.length, callCount)
              assert.equal(child.kill(signal), true)
              const [code, terminationSignal] = await completed
              assert.equal(code, 1)
              assert.equal(terminationSignal, null)
              assertProcessAbsent(clientPid)
              clientPid = undefined
              assert.equal(stdout, "")
              const failure = JSON.parse(stderr)
              assert.equal(failure.status, "failed")
              assert.equal(
                failure.phase,
                phase.endsWith("_content") ? "content_verification" : phase
              )
              assert.ok(
                Number.isFinite(failure.durationMs) && failure.durationMs >= 0
              )
              assert.deepEqual(await readCalls(callsPath), callsAtCancellation)
              assert.deepEqual(await readdir(outputDirectory), [])
            } finally {
              clearTimeout(timer)
              // These are only the exact processes created by this synthetic fixture.
              if (clientPid) {
                try {
                  process.kill(clientPid, "SIGKILL")
                } catch (error) {
                  if (error.code !== "ESRCH") throw error
                }
              }
              if (child.exitCode === null && child.signalCode === null)
                child.kill("SIGKILL")
              await completed
            }
          }
        )
    )
  }
}

test(
  "media command deadline kills and reaps the owned client without aborting its caller",
  { timeout: 5000 },
  () =>
    withFixture(async ({ environment, readyPath }) => {
      const controller = new AbortController()
      const command = runMediaBackupCommand(["--version"], {
        environment: environment("success", {
          RR_TEST_MC_STOP_PHASE: "client_version",
        }),
        signal: controller.signal,
        timeoutMs: 1000,
      })
      // Attach the rejection observer before waiting for the child's ready signal.
      const rejected = assert.rejects(command, {
        message: "MinIO Client command failed or exceeded its deadline.",
      })
      const clientPid = await waitForReady(readyPath)
      await rejected
      assertProcessAbsent(clientPid)
      assert.equal(controller.signal.aborted, false)
    })
)

test("an already cancelled media command never starts a client", () =>
  withFixture(async ({ environment, callsPath }) => {
    await assert.rejects(
      runMediaBackupCommand(["--version"], {
        environment: environment("success"),
        signal: AbortSignal.abort(),
      }),
      { message: "MinIO Client command failed or exceeded its deadline." }
    )
    await assert.rejects(readFile(callsPath), { code: "ENOENT" })
  }))

test("media scope handles repeated cancellation and restores listener ownership", () => {
  const events = new EventEmitter()
  const original = () => {}
  events.on("SIGINT", original)
  events.on("SIGTERM", original)
  const scope = createMediaBackupScope(events)
  assert.equal(scope.signal.aborted, false)
  for (const signal of ["SIGINT", "SIGTERM", "SIGINT", "SIGTERM"]) {
    events.emit(signal)
    assert.equal(scope.signal.aborted, true)
    assert.equal(events.listenerCount(signal), 2)
  }
  scope.close()
  scope.close()
  assert.deepEqual(events.listeners("SIGINT"), [original])
  assert.deepEqual(events.listeners("SIGTERM"), [original])
})

test("media command deadlines reject invalid values before spawning", () =>
  withFixture(async ({ environment, callsPath }) => {
    for (const timeoutMs of [0, -1, 600_001, Number.NaN, 1.5, "100"])
      await assert.rejects(
        runMediaBackupCommand(["--version"], {
          environment: environment("success"),
          signal: new AbortController().signal,
          timeoutMs,
        }),
        { message: "Invalid media command deadline." }
      )
    await assert.rejects(readFile(callsPath), { code: "ENOENT" })
  }))
