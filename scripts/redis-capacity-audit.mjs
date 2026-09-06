import { createRequire } from "node:module"
import { performance } from "node:perf_hooks"
import {
  collectRedisAudit,
  parseRedisAuditEnvironment,
} from "./lib/redis-audit-client.mjs"
import { evaluateRedisCapacity } from "./lib/redis-capacity-audit.mjs"

const help = `Usage: pnpm run data:redis:audit

Read-only Redis capacity and persistence observation; never changes settings
or reads application keys. Requires Redis 7+ with INFO and the exact CONFIG
GET keys documented in docs/INFRASTRUCTURE_RECOVERY.md. No ACL grants are made.

Required environment (never put credentials in command arguments):
  REDIS_AUDIT_URL                       Reviewed server URL (database 0 only)
  REDIS_SERVICE_MEMORY_LIMIT_BYTES      Operator-verified service/container RAM
                                       16 MiB to 16 TiB, decimal byte count
Optional:
  REDIS_AUDIT_TIMEOUT_MS                Overall deadline, 100–30000 ms (5000)

External transport requires rediss:// with certificate verification. Private
Railway or loopback redis:// is permitted. No URL queries or fragments.
Reports only bounded numeric/enum observations and a credential-free endpoint
fingerprint. Exit 0: policy healthy; 2: policy degraded; 1: audit unavailable.

A healthy observation is not persistent-volume, restore, queue-reconciliation,
RPO/RTO, load-test or production-launch acceptance. No settings are applied.
`

const main = async () => {
  const startedAt = performance.now()
  const controller = new AbortController()
  const cancel = () => controller.abort()
  const durationMs = () => Math.round(performance.now() - startedAt)
  process.once("SIGINT", cancel)
  process.once("SIGTERM", cancel)
  try {
    const args = process.argv.slice(2)
    if (args.length === 1 && args[0] === "--help") {
      console.log(help)
      return
    }
    if (args.length !== 0) throw new Error("Unsupported arguments.")
    const config = parseRedisAuditEnvironment(process.env)
    const require = createRequire(
      new URL("../backend/package.json", import.meta.url)
    )
    const { createClient } = require("redis")
    const observation = await collectRedisAudit({
      config,
      createClient,
      signal: controller.signal,
    })
    const report = evaluateRedisCapacity({
      ...observation,
      memoryLimitBytes: config.memoryLimitBytes,
    })
    console.log(
      JSON.stringify({
        ...report,
        event: "redis.capacity_audit.completed",
        endpointFingerprint: config.endpointFingerprint,
        durationMs: durationMs(),
      })
    )
    process.exitCode = report.status === "healthy" ? 0 : 2
  } catch {
    console.error(
      JSON.stringify({
        schemaVersion: 1,
        event: "redis.capacity_audit.failed",
        reason: "audit_unavailable",
        durationMs: durationMs(),
      })
    )
    process.exitCode = 1
  } finally {
    process.off("SIGINT", cancel)
    process.off("SIGTERM", cancel)
  }
}

await main()
