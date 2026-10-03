import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { recoveryHash } from "./recovery-vault.mjs"

const require = createRequire(
  new URL("../../operations/package.json", import.meta.url)
)
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require("@aws-sdk/client-s3")

export const storageFingerprint = ({ endpoint, bucket }) => {
  const url = new URL(endpoint)
  assert.ok(!url.username && !url.password && !url.search && !url.hash)
  assert.ok(url.pathname === "/" || url.pathname === "")
  assert.ok(
    url.protocol === "https:" ||
      (url.protocol === "http:" && url.hostname.endsWith(".railway.internal"))
  )
  assert.match(bucket, /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u)
  return recoveryHash(Buffer.from(`${url.origin}/${bucket}`))
}

export const readBoundedObject = async (body, maximumBytes, signal) => {
  assert.ok(
    Number.isSafeInteger(maximumBytes) &&
      maximumBytes >= 0 &&
      maximumBytes <= 128 * 1024 * 1024 + 36
  )
  let bytes = 0
  const chunks = []
  try {
    for await (const chunk of body) {
      signal?.throwIfAborted()
      bytes += chunk.length
      assert.ok(bytes <= maximumBytes)
      chunks.push(Buffer.from(chunk))
    }
    signal?.throwIfAborted()
    return Buffer.concat(chunks)
  } finally {
    body.destroy()
  }
}

export const createRecoveryStore = (config, client) => {
  const fingerprint = storageFingerprint(config)
  const s3 =
    client ??
    new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? true,
      maxAttempts: 2,
      requestHandler: { requestTimeout: 30_000, connectionTimeout: 5_000 },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    })
  const send = (command, signal) => s3.send(command, { abortSignal: signal })
  return {
    fingerprint,
    async get(objectKey, maximumBytes, signal) {
      const response = await send(
        new GetObjectCommand({ Bucket: config.bucket, Key: objectKey }),
        signal
      )
      if (response.ContentLength > maximumBytes) {
        response.Body.destroy()
        throw new Error("Recovery object exceeds read budget")
      }
      return readBoundedObject(response.Body, maximumBytes, signal)
    },
    async put(objectKey, bytes, signal) {
      assert.ok(
        Buffer.isBuffer(bytes) && bytes.length <= 128 * 1024 * 1024 + 36
      )
      // Snapshot prefixes are unique; conditional writes also reject reuse.
      await send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: objectKey,
          Body: bytes,
          ContentLength: bytes.length,
          ContentType: "application/octet-stream",
          IfNoneMatch: "*",
        }),
        signal
      )
    },
    async removeSnapshot(keys, signal) {
      assert.ok(Array.isArray(keys) && keys.length > 0 && keys.length <= 10_002)
      const match =
        /^rr-recovery\/v1\/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})\//u.exec(
          keys[0]
        )
      assert.ok(match)
      assert.equal(new Set(keys).size, keys.length)
      for (const key of keys) {
        assert.ok(key.startsWith(match[0]))
        assert.match(
          key.slice(match[0].length),
          /^(?:objects\/\d+\.bin|manifest\.bin|receipt\.json)$/u
        )
      }
      for (let offset = 0; offset < keys.length; offset += 1000) {
        signal?.throwIfAborted()
        const response = await send(
          new DeleteObjectsCommand({
            Bucket: config.bucket,
            Delete: {
              Objects: keys
                .slice(offset, offset + 1000)
                .map((Key) => ({ Key })),
              Quiet: false,
            },
          }),
          signal
        )
        assert.equal((response.Errors ?? []).length, 0)
        assert.deepEqual(
          (response.Deleted ?? []).map((o) => o.Key).sort(),
          keys.slice(offset, offset + 1000).sort()
        )
      }
    },
    async list(signal, { archives = false } = {}) {
      const objects = []
      const tokens = new Set()
      let token
      for (let page = 0; page < (archives ? 100 : 20); page++) {
        signal?.throwIfAborted()
        const response = await send(
          new ListObjectsV2Command({
            Bucket: config.bucket,
            MaxKeys: 1000,
            ContinuationToken: token,
            Prefix: archives ? "rr-recovery/v1/" : undefined,
          }),
          signal
        )
        assert.ok(Array.isArray(response.Contents ?? []))
        for (const object of response.Contents ?? []) {
          assert.equal(typeof object.Key, "string")
          assert.equal(typeof object.ETag, "string")
          assert.ok(
            Number.isSafeInteger(object.Size) &&
              object.Size >= 0 &&
              object.Size <= 128 * 1024 * 1024 + (archives ? 36 : 0)
          )
          objects.push({
            key: object.Key,
            bytes: object.Size,
            etag: object.ETag,
          })
          assert.ok(objects.length <= (archives ? 100_000 : 10_000))
        }
        if (response.IsTruncated === false) {
          objects.sort((left, right) =>
            left.key < right.key ? -1 : left.key > right.key ? 1 : 0
          )
          assert.equal(new Set(objects.map((o) => o.key)).size, objects.length)
          assert.ok(
            objects.reduce((sum, o) => sum + o.bytes, 0) <=
              (archives ? 100 : 1) * 1024 * 1024 * 1024
          )
          return objects
        }
        assert.equal(response.IsTruncated, true)
        token = response.NextContinuationToken
        assert.ok(
          typeof token === "string" && token.length > 0 && !tokens.has(token)
        )
        tokens.add(token)
      }
      throw new Error("Recovery inventory exceeds page budget")
    },
    close() {
      s3.destroy()
    },
  }
}
