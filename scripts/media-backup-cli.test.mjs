import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

import { mediaBackupConfirmation } from "./lib/media-backup.mjs"

const executable = `#!/usr/bin/env node
const {appendFileSync}=require('node:fs');
const args=process.argv.slice(2);
appendFileSync(process.env.RR_TEST_MC_CALLS, JSON.stringify(args)+'\\n');
const scenario=process.env.RR_TEST_MC_SCENARIO;
if(args[0]==='--version') { console.log('mc version RELEASE.2026-08-13T18-18-13Z'); }
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

const withFixture = async (run) => {
  const directory = await mkdtemp(join(tmpdir(), "remorseless-media-cli-"))
  try {
    await writeFile(join(directory, "mc"), executable, { mode: 0o700 })
    const callsPath = join(directory, "calls.jsonl")
    const outputDirectory = join(directory, "evidence")
    const invoke = (scenario, apply = true, overrides = {}) => {
      const result = spawnSync(
        process.execPath,
        [resolve("scripts/media-backup.mjs"), ...(apply ? ["--apply"] : [])],
        {
          encoding: "utf8",
          timeout: 5_000,
          maxBuffer: 1024 * 1024,
          env: {
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
            ...overrides,
          },
        }
      )
      assert.equal(result.error, undefined)
      assert.equal(result.signal, null)
      assert.doesNotMatch(
        result.stderr,
        /private-provider|private-reader-secret|user:secret/u
      )
      return result
    }
    await run({ invoke, callsPath, outputDirectory })
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
