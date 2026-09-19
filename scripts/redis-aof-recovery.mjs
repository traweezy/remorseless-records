import { performance } from "node:perf_hooks"
import { normalizeScriptArguments } from "./lib/cli-arguments.mjs"
import { verifyRedisAofArchive } from "./lib/redis-aof-recovery.mjs"
import {
  createRecoveryScope,
  parseRecoveryArguments,
} from "./lib/recovery-process.mjs"

const help = `Usage: pnpm run data:redis:aof:verify -- --archive-dir <absolute-private-directory> --checker <absolute-path>

Verify an OFFLINE multipart-AOF copy. The command reads the source only, copies
it to an owned private temporary directory, runs trusted Redis 8.10.1
redis-check-aof without --fix on that copy, and checks the copy again afterward.
It never connects to Redis or starts a server. A successful check is not a
startup replay, backup-freshness, write quiescence, retention, or RPO proof.

Required: a private 0700 directory owned by this user, with 0600 regular files,
exactly one appendonly.aof.manifest and at least one active BASE or INCR file.
Listed HISTORY files are copied and hashed, but not parsed by redis-check-aof.
Use an offline copy made under a documented AOF rewrite/backup seal boundary.
The checker must be a trusted, executable Redis binary at an absolute path.
Supply its independently reviewed SHA-256; a version string alone is not proof.

Required environment:
  REDIS_AOF_CHECKER_SHA256  Reviewed lowercase SHA-256 of the checker binary
Optional environment:
  REDIS_AOF_MAX_BYTES     Total snapshot budget, 1 to 10737418240 (default 536870912)
  REDIS_AOF_TIMEOUT_MS    Overall deadline, 100 to 600000 ms (default 120000)

Output omits source paths, keys, values and raw checker diagnostics.
Exit 0: verified; 1: unavailable, invalid or cancelled.
`

const integerSetting = (raw, fallback, maximum) => {
  if (raw === undefined) return fallback
  if (!/^[1-9]\d*$/u.test(raw)) throw new Error("Invalid AOF limit.")
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error("Invalid AOF limit.")
  return value
}

export const runRedisAofRecoveryCli = async ({
  args = process.argv.slice(2),
  environment = process.env,
  verify = verifyRedisAofArchive,
  write = (value) => process.stdout.write(value),
  writeError = (value) => process.stderr.write(value),
  makeScope = createRecoveryScope,
} = {}) => {
  const startedAt = performance.now()
  let phase = "arguments"
  let scope
  try {
    const normalized = normalizeScriptArguments(args)
    if (normalized.length === 1 && normalized[0] === "--help") {
      write(help)
      return 0
    }
    const parsed = parseRecoveryArguments(normalized, [
      "--archive-dir",
      "--checker",
    ])
    const maxBytes = integerSetting(
      environment.REDIS_AOF_MAX_BYTES,
      512 * 1024 * 1024,
      10 * 1024 ** 3
    )
    const timeoutMs = integerSetting(
      environment.REDIS_AOF_TIMEOUT_MS,
      120_000,
      600_000
    )
    if (timeoutMs < 100) throw new Error("Invalid AOF deadline.")
    if (!/^[a-f0-9]{64}$/u.test(environment.REDIS_AOF_CHECKER_SHA256 ?? ""))
      throw new Error("Invalid AOF checker identity.")
    scope = makeScope(timeoutMs)
    phase = "verification"
    const report = await verify({
      sourceDirectory: parsed["--archive-dir"],
      checker: parsed["--checker"],
      checkerSha256: environment.REDIS_AOF_CHECKER_SHA256,
      maxBytes,
      signal: scope.signal,
    })
    write(
      `${JSON.stringify({
        ...report,
        event: "redis.aof_verification.completed",
        durationMs: Math.round(performance.now() - startedAt),
      })}\n`
    )
    return 0
  } catch {
    writeError(
      `${JSON.stringify({
        schemaVersion: 1,
        event: "redis.aof_verification.failed",
        phase,
        durationMs: Math.round(performance.now() - startedAt),
      })}\n`
    )
    return 1
  } finally {
    scope?.close()
  }
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
)
  process.exitCode = await runRedisAofRecoveryCli()
