import assert from "node:assert/strict"
import test from "node:test"

import {
  mediaBackupConfirmation,
  parseMinioClientVersion,
  parseMediaInventory,
  validateMediaEndpoint,
  verifyMediaMirror,
} from "./lib/media-backup.mjs"

test("requires a MinIO Client release with mirror checksum support", () => {
  assert.equal(
    parseMinioClientVersion(
      "mc version RELEASE.2026-08-13T18-18-13Z (commit-id=example)"
    ),
    "RELEASE.2026-08-13T18-18-13Z"
  )
  assert.throws(
    () => parseMinioClientVersion("mc version RELEASE.2024-09-01T00-00-00Z"),
    /must support the SHA-256/u
  )
})

test("accepts only credential-free mc alias and bucket paths", () => {
  assert.equal(
    validateMediaEndpoint("source/catalog", "source"),
    "source/catalog"
  )
  for (const value of [
    "https://source/catalog",
    "source/../catalog",
    "source//catalog",
    "source",
    " source/catalog?secret=value ",
  ]) {
    assert.throws(() => validateMediaEndpoint(value, "source"))
  }
})

test("accepts preserved target-only history while requiring current objects", () => {
  const source = parseMediaInventory(
    JSON.stringify({
      key: "current.webp",
      size: 10,
      status: "success",
      type: "file",
    })
  )
  const target = parseMediaInventory(
    [
      JSON.stringify({
        key: "old.webp",
        size: 5,
        status: "success",
        type: "file",
      }),
      JSON.stringify({
        key: "current.webp",
        size: 10,
        status: "success",
        type: "file",
      }),
    ].join("\n")
  )

  expectMirror(verifyMediaMirror(source, target), 1, target.sha256)
  assert.throws(
    () => verifyMediaMirror(source, parseMediaInventory("")),
    /missing a current source object/u
  )
})

const expectMirror = (
  evidence,
  preservedTargetObjects,
  targetInventorySha256
) => {
  assert.deepEqual(evidence, {
    preservedTargetObjects,
    targetInventorySha256,
  })
}

test("builds an order-independent bounded media inventory", () => {
  const inventory = parseMediaInventory(
    [
      JSON.stringify({
        key: "b.webp",
        size: 20,
        status: "success",
        type: "file",
      }),
      JSON.stringify({
        key: "a.webp",
        size: 10,
        status: "success",
        type: "file",
      }),
    ].join("\n")
  )

  assert.deepEqual(inventory.entries, [
    { key: "a.webp", size: 10 },
    { key: "b.webp", size: 20 },
  ])
  assert.equal(inventory.bytes, 30)
  assert.equal(inventory.objectCount, 2)
  assert.match(inventory.sha256, /^[a-f0-9]{64}$/u)
})

test("rejects duplicate, failed, or unbounded inventory records", () => {
  const record = JSON.stringify({
    key: "cover.webp",
    size: 10,
    status: "success",
    type: "file",
  })
  assert.throws(() => parseMediaInventory(`${record}\n${record}`), /duplicate/u)
  assert.throws(() =>
    parseMediaInventory(
      JSON.stringify({
        key: "cover.webp",
        size: 10,
        status: "error",
        type: "file",
      })
    )
  )
})

test("requires a direction-specific backup confirmation", () => {
  assert.notEqual(
    mediaBackupConfirmation("source/catalog", "target/catalog"),
    mediaBackupConfirmation("target/catalog", "source/catalog")
  )
})
