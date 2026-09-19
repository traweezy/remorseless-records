import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  parseAofManifest,
  verifyRedisAofArchive,
} from "./lib/redis-aof-recovery.mjs"
import { runIntegrationCommand } from "./run-disposable-integration.mjs"

const imageTag = "remorseless-records-integration-redis:8.10.1-hardened"
const imageIdPattern = /^(?:sha256:)?[a-f0-9]{64}$/u
const fixtureEnvironment = process.env

test("the pinned checker validates an isolated synthetic multipart AOF", async () => {
  assert.equal(fixtureEnvironment.INTEGRATION_TESTS_ENABLED, "1")
  assert.equal(typeof process.getuid, "function")
  const uid = process.getuid()
  const gid = process.getgid()
  const imageId = await runIntegrationCommand(
    "docker",
    ["image", "inspect", "--format", "{{.Id}}", imageTag],
    { capture: true, timeoutMs: 15_000 }
  )
  assert.match(imageId, imageIdPattern)
  if (fixtureEnvironment.RR_INTEGRATION_REDIS_IMAGE_ID)
    assert.equal(imageId, fixtureEnvironment.RR_INTEGRATION_REDIS_IMAGE_ID)

  const archive = await mkdtemp(join(tmpdir(), "redis-aof-real-"))
  const tools = await mkdtemp(join(tmpdir(), "redis-aof-checker-"))
  try {
    const producer = `
set -eu
redis-server --daemonize yes --port 0 --unixsocket /data/redis.sock --unixsocketperm 700 --pidfile /data/redis.pid --dir /data --save '' --appendonly yes --appendfilename appendonly.aof --appenddirname appendonlydir --auto-aof-rewrite-percentage 0 --aof-use-rdb-preamble yes --logfile /data/redis.log
redis-cli -s /data/redis.sock SET synthetic:base durable >/dev/null
redis-cli -s /data/redis.sock BGREWRITEAOF >/dev/null
ready=0
for attempt in $(seq 1 100); do
  persistence=$(redis-cli -s /data/redis.sock INFO persistence)
  if printf '%s' "$persistence" | grep -q 'aof_rewrite_in_progress:0' && printf '%s' "$persistence" | grep -q 'aof_last_bgrewrite_status:ok' && ls /data/appendonlydir/*.base.rdb >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.1
done
[ "$ready" -eq 1 ]
redis-cli -s /data/redis.sock SET synthetic:increment durable >/dev/null
redis-cli -s /data/redis.sock SHUTDOWN NOSAVE >/dev/null
cp /data/appendonlydir/appendonly.aof.* /artifact/
chmod 600 /artifact/*
`
    await runIntegrationCommand(
      "docker",
      [
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
        "--user",
        `${uid}:${gid}`,
        "--tmpfs",
        `/data:rw,nosuid,nodev,size=32m,mode=0700,uid=${uid},gid=${gid}`,
        "--mount",
        `type=bind,source=${archive},target=/artifact`,
        "--entrypoint",
        "/bin/sh",
        imageId,
        "-ec",
        producer,
      ],
      { capture: true, timeoutMs: 45_000 }
    )

    const checker = join(tools, "redis-check-aof")
    await writeFile(
      checker,
      `#!/bin/sh
set -eu
if [ "$1" = "--version" ]; then
  exec docker run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --memory 256m --pids-limit 64 --user ${uid}:${gid} --entrypoint redis-check-aof ${imageId} --version
fi
[ "$#" -eq 1 ]
exec docker run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --memory 256m --pids-limit 64 --user ${uid}:${gid} --mount "type=bind,source=$(dirname "$1"),target=/aof" --entrypoint redis-check-aof ${imageId} /aof/appendonly.aof.manifest
`,
      { mode: 0o700 }
    )
    const checkerSha256 = createHash("sha256")
      .update(await readFile(checker))
      .digest("hex")
    const report = await verifyRedisAofArchive({
      sourceDirectory: archive,
      checker,
      checkerSha256,
      maxBytes: 32 * 1024 * 1024,
    })
    assert.equal(report.status, "verified")
    assert.match(report.checkerVersion, /^redis-check-aof v=8\.10\.1 /u)
    assert.equal(report.replayProven, false)
    assert.ok(report.totalBytes > 0)
    assert.ok(report.fileCount >= 3)

    const manifestPath = join(archive, "appendonly.aof.manifest")
    const entries = parseAofManifest(await readFile(manifestPath, "utf8"))
    assert.equal(entries.filter(({ type }) => type === "b").length, 1)
    for (const { name, type } of entries) {
      if (type !== "b") await unlink(join(archive, name))
    }
    const baseLine = (await readFile(manifestPath, "utf8"))
      .split("\n")
      .find((line) => line.endsWith("type b"))
    assert.ok(baseLine)
    await writeFile(manifestPath, `${baseLine}\n`)
    const baseOnly = await verifyRedisAofArchive({
      sourceDirectory: archive,
      checker,
      checkerSha256,
      maxBytes: 32 * 1024 * 1024,
    })
    assert.equal(baseOnly.activeFileCount, 1)
    assert.equal(baseOnly.historyFileCount, 0)
    assert.equal(baseOnly.fileCount, 2)

    const base = entries.find(({ type }) => type === "b")
    const historySequence =
      base.sequence > 1 ? base.sequence - 1 : base.sequence + 1
    const historyName = `appendonly.aof.${historySequence}.base.rdb`
    await writeFile(
      join(archive, historyName),
      await readFile(join(archive, base.name)),
      { mode: 0o600 }
    )
    await writeFile(
      manifestPath,
      `${baseLine}\nfile ${historyName} seq ${historySequence} type h\n`
    )
    const withHistory = await verifyRedisAofArchive({
      sourceDirectory: archive,
      checker,
      checkerSha256,
      maxBytes: 32 * 1024 * 1024,
    })
    assert.equal(withHistory.activeFileCount, 1)
    assert.equal(withHistory.historyFileCount, 1)
    assert.equal(withHistory.fileCount, 3)
  } finally {
    await rm(tools, { recursive: true, force: true })
    await rm(archive, { recursive: true, force: true })
  }
})
