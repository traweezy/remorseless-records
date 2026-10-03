import assert from "node:assert/strict"
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto"

const magic = Buffer.from("RRBK0001")
const overhead = magic.length + 12 + 16
const maximumObjectBytes = 128 * 1024 * 1024
const maximumSnapshotBytes = 1024 * 1024 * 1024
const maximumObjects = 10_000
const maximumManifestBytes = 8 * 1024 * 1024
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u
const digest = /^[a-f0-9]{64}$/u
export const recoveryHash = (bytes) =>
  createHash("sha256").update(bytes).digest("hex")

export const parseRecoveryKey = (value) => {
  assert.equal(typeof value, "string")
  assert.match(value, digest)
  return Buffer.from(value, "hex")
}

export const sealRecoveryObject = (bytes, key, objectKey) => {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length <= maximumObjectBytes)
  assert.ok(Buffer.isBuffer(key) && key.length === 32)
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  cipher.setAAD(Buffer.from(objectKey))
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()])
  return Buffer.concat([magic, iv, cipher.getAuthTag(), encrypted])
}

export const openRecoveryObject = (bytes, key, objectKey) => {
  assert.ok(
    Buffer.isBuffer(bytes) &&
      bytes.length >= overhead &&
      bytes.length <= maximumObjectBytes + overhead
  )
  assert.deepEqual(bytes.subarray(0, 8), magic)
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(8, 20))
  decipher.setAAD(Buffer.from(objectKey))
  decipher.setAuthTag(bytes.subarray(20, 36))
  return Buffer.concat([decipher.update(bytes.subarray(36)), decipher.final()])
}

const validateEntries = (entries) => {
  assert.ok(
    Array.isArray(entries) &&
      entries.length > 0 &&
      entries.length <= maximumObjects
  )
  const seen = new Set()
  let bytes = 0
  for (const entry of entries) {
    assert.ok(["database", "media"].includes(entry.kind))
    assert.equal(typeof entry.name, "string")
    assert.ok(
      entry.name.length > 0 &&
        Buffer.byteLength(entry.name) <= 1024 &&
        !/[\x00-\x1f\x7f]/u.test(entry.name)
    )
    assert.ok(!seen.has(`${entry.kind}\0${entry.name}`))
    seen.add(`${entry.kind}\0${entry.name}`)
    assert.ok(
      Number.isSafeInteger(entry.bytes) &&
        entry.bytes >= 0 &&
        entry.bytes <= maximumObjectBytes
    )
    bytes += entry.bytes
    assert.ok(bytes <= maximumSnapshotBytes)
  }
  return bytes
}

const putVerified = async (destination, objectKey, bytes, signal) => {
  signal?.throwIfAborted()
  await destination.put(objectKey, bytes, signal)
  signal?.throwIfAborted()
  const retained = await destination.get(objectKey, bytes.length, signal)
  assert.equal(retained.length, bytes.length)
  assert.equal(recoveryHash(retained), recoveryHash(bytes))
}

const processObjects = async (entries, signal, operation) => {
  const controller = new AbortController()
  const bounded = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal
  // Limit buffered plaintext/ciphertext memory. Large objects are sequential.
  const workers = entries.every((entry) => entry.bytes <= 16 * 1024 * 1024)
    ? 4
    : 1
  let next = 0
  const results = await Promise.allSettled(
    Array.from({ length: workers }, async () => {
      try {
        while (next < entries.length) {
          bounded.throwIfAborted()
          const index = next++
          await operation(entries[index], index, bounded)
        }
      } catch {
        controller.abort()
        throw new Error("Recovery object transfer failed")
      }
    })
  )
  if (results.some((result) => result.status === "rejected"))
    throw new Error("Recovery object transfer failed")
  signal?.throwIfAborted()
}

// Every run owns a new random prefix. No source or retained snapshot is
// overwritten/deleted, and publication happens after full content readback.
export const writeRecoverySnapshot = async ({
  sources,
  destination,
  key,
  sourceFingerprint,
  targetFingerprint,
  validateSource,
  signal,
  now = () => new Date(),
}) => {
  assert.match(sourceFingerprint, digest)
  assert.match(targetFingerprint, digest)
  assert.notEqual(sourceFingerprint, targetFingerprint)
  const plainBytes = validateEntries(sources)
  const started = performance.now()
  const id = randomUUID()
  const prefix = `rr-recovery/v1/${id}`
  const entries = new Array(sources.length)
  await processObjects(sources, signal, async (source, index, abort) => {
    const body = await source.read(abort)
    assert.ok(Buffer.isBuffer(body))
    assert.equal(body.length, source.bytes)
    const objectKey = `${prefix}/objects/${index}.bin`
    const sealed = sealRecoveryObject(body, key, objectKey)
    await putVerified(destination, objectKey, sealed, abort)
    entries[index] = {
      kind: source.kind,
      name: source.name,
      bytes: source.bytes,
      sha256: recoveryHash(body),
      sealedSha256: recoveryHash(sealed),
      objectKey,
    }
  })
  signal?.throwIfAborted()
  await validateSource(signal)
  const createdAt = now().toISOString()
  const manifestKey = `${prefix}/manifest.bin`
  const manifestBytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      id,
      createdAt,
      sourceFingerprint,
      targetFingerprint,
      entries,
    })
  )
  assert.ok(manifestBytes.length <= maximumManifestBytes)
  const manifest = sealRecoveryObject(manifestBytes, key, manifestKey)
  await putVerified(destination, manifestKey, manifest, signal)
  const receipt = {
    schemaVersion: 2,
    id,
    createdAt,
    recoveryScope: "railway_encrypted_current_state",
    sourceFingerprint,
    targetFingerprint,
    manifestKey,
    manifestSha256: recoveryHash(manifest),
    manifestBytes: manifest.length,
    objects: sources.length,
    plainBytes,
    databaseObjects: sources.filter((s) => s.kind === "database").length,
    mediaObjects: sources.filter((s) => s.kind === "media").length,
    durationMs: Math.ceil(performance.now() - started),
    versionHistoryVerified: false,
    offsiteVerified: false,
  }
  const receiptBytes = Buffer.from(JSON.stringify(receipt))
  const receiptKey = `${prefix}/receipt.json`
  await putVerified(destination, receiptKey, receiptBytes, signal)
  signal?.throwIfAborted()
  return { ...receipt, receiptKey, receiptSha256: recoveryHash(receiptBytes) }
}

export const readRecoveryManifest = async ({
  destination,
  key,
  receiptKey,
  receiptSha256,
  targetFingerprint,
  signal,
}) => {
  assert.match(receiptSha256, digest)
  assert.match(targetFingerprint, digest)
  const match = /^rr-recovery\/v1\/([a-f0-9-]+)\/receipt\.json$/u.exec(
    receiptKey
  )
  assert.ok(match && uuid.test(match[1]))
  signal?.throwIfAborted()
  const bytes = await destination.get(receiptKey, 8192, signal)
  assert.ok(bytes.length <= 8192)
  assert.equal(recoveryHash(bytes), receiptSha256)
  const receipt = JSON.parse(bytes)
  assert.ok([1, 2].includes(receipt.schemaVersion))
  assert.equal(receipt.id, match[1])
  assert.equal(receipt.recoveryScope, "railway_encrypted_current_state")
  assert.equal(receipt.targetFingerprint, targetFingerprint)
  assert.match(receipt.sourceFingerprint, digest)
  assert.notEqual(receipt.sourceFingerprint, targetFingerprint)
  assert.equal(receipt.manifestKey, `rr-recovery/v1/${receipt.id}/manifest.bin`)
  assert.match(receipt.manifestSha256, digest)
  assert.ok(
    Number.isSafeInteger(receipt.manifestBytes) &&
      receipt.manifestBytes >= overhead &&
      receipt.manifestBytes <= maximumManifestBytes + overhead
  )
  const sealed = await destination.get(
    receipt.manifestKey,
    receipt.manifestBytes,
    signal
  )
  assert.equal(sealed.length, receipt.manifestBytes)
  assert.equal(recoveryHash(sealed), receipt.manifestSha256)
  const manifest = JSON.parse(
    openRecoveryObject(sealed, key, receipt.manifestKey)
  )
  assert.equal(manifest.schemaVersion, receipt.schemaVersion)
  if (manifest.schemaVersion === 2) {
    assert.equal(new Date(manifest.createdAt).toISOString(), manifest.createdAt)
    assert.equal(manifest.createdAt, receipt.createdAt)
  }
  assert.equal(manifest.id, receipt.id)
  assert.equal(manifest.sourceFingerprint, receipt.sourceFingerprint)
  assert.equal(manifest.targetFingerprint, targetFingerprint)
  assert.equal(validateEntries(manifest.entries), receipt.plainBytes)
  assert.equal(manifest.entries.length, receipt.objects)
  assert.equal(
    manifest.entries.filter((e) => e.kind === "database").length,
    receipt.databaseObjects
  )
  assert.equal(
    manifest.entries.filter((e) => e.kind === "media").length,
    receipt.mediaObjects
  )
  // Validate the complete manifest before writing any target data.
  for (const [index, entry] of manifest.entries.entries()) {
    assert.equal(
      entry.objectKey,
      `rr-recovery/v1/${receipt.id}/objects/${index}.bin`
    )
    assert.match(entry.sha256, digest)
    assert.match(entry.sealedSha256, digest)
  }
  return { receipt, manifest }
}

export const restoreRecoverySnapshot = async (options) => {
  const { destination, key, signal, write } = options
  const { receipt, manifest } = await readRecoveryManifest(options)
  const started = performance.now()
  await processObjects(
    manifest.entries,
    signal,
    async (entry, _index, abort) => {
      const encrypted = await destination.get(
        entry.objectKey,
        entry.bytes + overhead,
        abort
      )
      assert.equal(encrypted.length, entry.bytes + overhead)
      assert.equal(recoveryHash(encrypted), entry.sealedSha256)
      const plain = openRecoveryObject(encrypted, key, entry.objectKey)
      assert.equal(plain.length, entry.bytes)
      assert.equal(recoveryHash(plain), entry.sha256)
      await write(
        { kind: entry.kind, name: entry.name, sha256: entry.sha256 },
        plain,
        abort
      )
    }
  )
  signal?.throwIfAborted()
  return {
    passed: true,
    id: receipt.id,
    objects: receipt.objects,
    databaseObjects: receipt.databaseObjects,
    mediaObjects: receipt.mediaObjects,
    plainBytes: receipt.plainBytes,
    durationMs: Math.ceil(performance.now() - started),
    recoveryScope: receipt.recoveryScope,
    offsiteVerified: false,
    versionHistoryVerified: false,
  }
}
