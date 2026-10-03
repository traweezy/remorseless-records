import assert from "node:assert/strict"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readRecoveryManifest, recoveryHash } from "./lib/recovery-vault.mjs"
import { openRailwayRecoveryStore } from "./railway-recovery-backup.mjs"
import { verifiedStagingRailwayReader } from "./staging-release-readiness.mjs"

export const auditRecoverySnapshots = async (
  { store, key },
  now = Date.now()
) => {
  const signal = AbortSignal.timeout(120_000)
  const inventory = await store.list(signal, { archives: true })
  const receipts = inventory.filter((o) =>
    /^rr-recovery\/v1\/[a-f0-9-]+\/receipt\.json$/u.test(o.key)
  )
  assert.ok(receipts.length > 0 && receipts.length <= 100)
  const verified = []
  for (const item of receipts) {
    const receiptSha256 = recoveryHash(await store.get(item.key, 8192, signal))
    const { receipt, manifest } = await readRecoveryManifest({
      destination: store,
      key,
      targetFingerprint: store.fingerprint,
      receiptKey: item.key,
      receiptSha256,
      signal,
    })
    if (receipt.schemaVersion !== 2) continue
    assert.equal(receipt.databaseObjects, 4)
    assert.ok(receipt.mediaObjects > 0)
    const expected = [
      ...manifest.entries.map((e) => ({
        key: e.objectKey,
        bytes: e.bytes + 36,
      })),
      { key: receipt.manifestKey, bytes: receipt.manifestBytes },
      { key: item.key, bytes: item.bytes },
    ].sort((a, b) => a.key.localeCompare(b.key))
    const actual = inventory
      .filter((o) => o.key.startsWith(`rr-recovery/v1/${receipt.id}/`))
      .map(({ key, bytes }) => ({ key, bytes }))
      .sort((a, b) => a.key.localeCompare(b.key))
    assert.deepEqual(actual, expected)
    verified.push({
      id: receipt.id,
      createdAt: receipt.createdAt,
      receiptKey: item.key,
      receiptSha256,
      objects: receipt.objects,
    })
  }
  verified.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  assert.ok(verified.length > 0)
  const latest = verified[0]
  const ageSeconds = Math.ceil((now - Date.parse(latest.createdAt)) / 1000)
  return {
    readOnly: true,
    passed: ageSeconds >= -60 && ageSeconds <= 26 * 3600,
    ageSeconds,
    latest,
    authenticatedSnapshots: verified.length,
    fullObjectReadback: false,
    pitrVerified: false,
    offsiteVerified: false,
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let opened
  try {
    assert.equal(process.argv.length, 2)
    opened = await openRailwayRecoveryStore(
      await verifiedStagingRailwayReader()
    )
    const report = await auditRecoverySnapshots(opened)
    console.log(JSON.stringify(report))
    if (!report.passed) process.exitCode = 2
  } catch {
    console.error(
      JSON.stringify({
        readOnly: true,
        passed: false,
        reason: "recovery_evidence_unverified",
      })
    )
    process.exitCode = 1
  } finally {
    opened?.store.close()
  }
}
