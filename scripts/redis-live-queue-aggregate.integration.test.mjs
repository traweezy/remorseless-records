import assert from "node:assert/strict"
import { dirname } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { runIntegrationCommand } from "./run-disposable-integration.mjs"
import { validateLiveAggregate } from "./redis-live-queue-aggregate.mjs"

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const imageIdPattern = /^sha256:[a-f0-9]{64}$/u

test("checked-in remote helper uses only read-only RESP commands and emits no keys", async () => {
  assert.equal(process.env.INTEGRATION_TESTS_ENABLED, "1")
  const expectedImageId = process.env.RR_REDIS_AGGREGATE_TEST_IMAGE_ID
  assert.match(expectedImageId ?? "", imageIdPattern)
  const imageId = await runIntegrationCommand(
    "docker",
    [
      "--context",
      "default",
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      expectedImageId,
    ],
    { capture: true, timeoutMs: 15_000 }
  )
  assert.equal(imageId, expectedImageId)
  for (const mode of [
    "normal",
    "empty",
    "wrongType",
    "oversize",
    "runDrift",
    "otherDb",
    "countDrift",
    "replacementKey",
  ]) {
    const raw = await runIntegrationCommand(
      "docker",
      [
        "--context",
        "default",
        "run",
        "--rm",
        "--pull",
        "never",
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--memory",
        "256m",
        "--pids-limit",
        "64",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=16m",
        "--tmpfs",
        "/bitnami:rw,nosuid,nodev,size=16m",
        "--mount",
        `type=bind,source=${repositoryRoot},target=/repo,readonly`,
        "--env",
        `RR_TEST_MODE=${mode}`,
        "--entrypoint",
        "perl",
        imageId,
        "/repo/scripts/test-fixtures/redis-live-aggregate-resp.pl",
      ],
      { capture: true, timeoutMs: 30_000 }
    )
    const result = JSON.parse(raw)
    assert.ok(
      result.commands.every((command) =>
        [
          "AUTH",
          "INFO",
          "CONFIG",
          "DBSIZE",
          "SCAN",
          "TYPE",
          "PTTL",
          "ZCARD",
        ].includes(command)
      )
    )
    assert.ok(!result.output.includes("secret-order-123"))
    assert.ok(!result.output.includes("private:user-456"))
    if (mode !== "normal" && mode !== "empty") {
      assert.notEqual(result.exitCode, 0)
      assert.equal(result.output, "")
      if (mode === "countDrift") {
        assert.ok(result.commands.includes("SCAN"))
        assert.equal(
          result.commands.filter((command) => command === "DBSIZE").length,
          2
        )
      }
      continue
    }
    assert.equal(result.exitCode, 0)
    const aggregate = validateLiveAggregate(JSON.parse(result.output))
    if (mode === "empty") {
      assert.equal(aggregate.scannedKeys, 0)
      assert.ok(!result.commands.includes("TYPE"))
      continue
    }
    assert.equal(aggregate.scannedKeys, 4)
    assert.equal(aggregate.queues.scheduledJobs.states.failed, 237)
    assert.equal(aggregate.queues.eventBus.states.failed, 1)
    assert.equal(aggregate.categories.healthSnapshots.ttl.over10Minutes, 1)
    assert.equal(aggregate.categories.other.count, 1)
    assert.equal(
      result.commands.filter((command) => command === "INFO").length,
      8
    )
    assert.equal(
      result.commands.filter((command) => command === "DBSIZE").length,
      2
    )
  }
})
