import assert from "node:assert/strict"
import { readRecoveryManifest, recoveryHash } from "./recovery-vault.mjs"

// Retain at least 30 days and the two newest authenticated complete snapshots.
// V1 lacks an authenticated creation time and is never automatically removed.
// Unknown/incomplete prefixes are retained for operator investigation.
export const pruneRecoverySnapshots = async ({
  destination,
  key,
  targetFingerprint,
  currentId,
  signal,
  now = new Date(),
}) => {
  assert.equal(destination.fingerprint, targetFingerprint)
  const inventory = await destination.list(signal, { archives: true })
  const receipts = inventory.filter((o) =>
    /^rr-recovery\/v1\/[a-f0-9-]+\/receipt\.json$/u.test(o.key)
  )
  assert.ok(receipts.length > 0 && receipts.length <= 100)
  const snapshots = []
  // Authenticate all complete sets before deleting any. A forged receipt/time
  // cannot age a valid encrypted snapshot into eligibility.
  for (const item of receipts) {
    const receiptSha256 = recoveryHash(
      await destination.get(item.key, 8192, signal)
    )
    const options = {
      destination,
      key,
      targetFingerprint,
      receiptKey: item.key,
      receiptSha256,
      signal,
    }
    const { receipt, manifest } = await readRecoveryManifest(options)
    const keys = [
      ...manifest.entries.map((e) => e.objectKey),
      receipt.manifestKey,
      item.key,
    ]
    const actual = inventory.filter((o) =>
      o.key.startsWith(`rr-recovery/v1/${receipt.id}/`)
    )
    assert.deepEqual(actual.map((o) => o.key).sort(), [...keys].sort())
    if (receipt.schemaVersion === 2) {
      assert.ok(Date.parse(receipt.createdAt) <= now.getTime() + 60_000)
      snapshots.push({ receipt, keys, actual, options })
    }
  }
  snapshots.sort((a, b) =>
    b.receipt.createdAt.localeCompare(a.receipt.createdAt)
  )
  assert.ok(snapshots.some((s) => s.receipt.id === currentId))
  const candidates = snapshots
    .slice(2)
    .filter(
      (s) =>
        s.receipt.id !== currentId &&
        now.getTime() - Date.parse(s.receipt.createdAt) > 30 * 86400_000
    )
  let removed = 0
  for (const candidate of candidates) {
    signal?.throwIfAborted()
    await readRecoveryManifest(candidate.options)
    const before = (await destination.list(signal, { archives: true })).filter(
      (o) => o.key.startsWith(`rr-recovery/v1/${candidate.receipt.id}/`)
    )
    assert.deepEqual(before, candidate.actual)
    // Receipt last: an interrupted removal cannot be accepted as a full restore
    // because every object is independently authenticated on restore.
    await destination.removeSnapshot(candidate.keys, signal)
    const after = await destination.list(signal, { archives: true })
    assert.ok(
      !after.some((o) =>
        o.key.startsWith(`rr-recovery/v1/${candidate.receipt.id}/`)
      )
    )
    removed++
  }
  return {
    retentionDays: 30,
    minimumSnapshots: 2,
    removedSnapshots: removed,
    retainedLegacySnapshots: receipts.length - snapshots.length,
  }
}
