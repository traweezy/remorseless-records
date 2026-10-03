import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"
import {
  openRailwayRecoveryStore,
  parseBackupArguments,
  RECOVERY_TARGET,
} from "./railway-recovery-backup.mjs"
import { parseRestoreArguments } from "./railway-recovery-restore.mjs"
import { STAGING } from "./lib/staging-release.mjs"

test("backup and restore reject missing consent, ambiguous flags and unsafe paths", () => {
  const backup = [
    "--bundle",
    "/private/bundle",
    "--output-dir",
    "/private/evidence",
  ]
  assert.ok(!parseBackupArguments(backup)["--apply"])
  assert.equal(
    parseBackupArguments([...backup, "--apply", "--confirm", "a".repeat(64)])[
      "--apply"
    ],
    true
  )
  for (const args of [
    [],
    [...backup, "--apply"],
    [...backup, "--confirm", "a".repeat(64)],
    [...backup, "--bundle", "/other"],
    [...backup, "--unknown"],
    ["--bundle", "relative", "--output-dir", "/private"],
  ])
    assert.throws(() => parseBackupArguments(args))
  const restore = [
    "--apply",
    "--receipt",
    "/private/receipt",
    "--receipt-sha256",
    "a".repeat(64),
    "--target-bucket",
    "11111111-2222-4333-8444-555555555555",
    "--output-dir",
    "/private/output",
    "--base-dir",
    "/private/base",
  ]
  assert.equal(parseRestoreArguments(restore)["--apply"], true)
  for (const args of [
    [],
    restore.slice(1),
    [...restore, "--apply"],
    restore.map((s) =>
      s === "11111111-2222-4333-8444-555555555555"
        ? RECOVERY_TARGET.bucketId
        : s
    ),
    [...restore, "--unknown", "private-canary"],
  ])
    assert.throws(() => parseRestoreArguments(args))
  assert.ok(parseBackupArguments(["--", "--help"]).help)
  assert.ok(parseRestoreArguments(["--help"]).help)
})

test("secret handoff requires the exact service, bucket, environment and endpoint", async () => {
  for (const failure of [
    "service",
    "bucket",
    "environment",
    "region",
    "endpoint",
    "key",
  ]) {
    const calls = []
    const railway = async (args) => {
      calls.push(args)
      if (args[0] === "service")
        return [
          {
            id: RECOVERY_TARGET.serviceId,
            name: failure === "service" ? "Other" : RECOVERY_TARGET.serviceName,
          },
        ]
      if (args[1] === "info")
        return {
          id: failure === "bucket" ? "wrong" : RECOVERY_TARGET.bucketId,
          name: RECOVERY_TARGET.bucketName,
          environmentId:
            failure === "environment" ? "wrong" : STAGING.environmentId,
          region: failure === "region" ? "sjc" : "iad",
        }
      if (args[1] === "credentials")
        return {
          endpoint:
            failure === "endpoint"
              ? "https://other.example"
              : "https://t3.storageapi.dev",
          bucketName: "private-bucket",
          region: "auto",
          urlStyle: "virtual-host",
          accessKeyId: "private-canary",
          secretAccessKey: "private-canary",
        }
      return { BACKUP_ENCRYPTION_KEY: "invalid" }
    }
    await assert.rejects(openRailwayRecoveryStore(railway))
    if (["service", "bucket", "environment", "region"].includes(failure))
      assert.ok(!calls.some((args) => args[1] === "credentials"))
    if (failure !== "key")
      assert.ok(!calls.some((args) => args[0] === "variable"))
  }
})

test("both CLIs show help and emit sanitized failures without provider operations", () => {
  for (const name of [
    "railway-recovery-backup.mjs",
    "railway-recovery-restore.mjs",
  ]) {
    const script = new URL(name, import.meta.url).pathname
    assert.equal(spawnSync(process.execPath, [script, "--help"]).status, 0)
    const failed = spawnSync(process.execPath, [script, "private-canary"], {
      encoding: "utf8",
    })
    assert.equal(failed.status, 1)
    assert.equal(failed.stdout, "")
    assert.ok(!failed.stderr.includes("private-canary"))
    assert.equal(JSON.parse(failed.stderr).passed, false)
  }
})
