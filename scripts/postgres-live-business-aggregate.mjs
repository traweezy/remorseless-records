import assert from "node:assert/strict"
import { lstat, realpath } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { normalizeScriptArguments } from "./lib/cli-arguments.mjs"
import {
  businessAggregateSql,
  parseBusinessAggregateOutput,
} from "./lib/postgres-business-aggregate.mjs"
import { createPostgresClientEnvironment } from "./lib/postgres-logical-backup.mjs"
import {
  createRecoveryScope,
  parseRecoveryArguments,
} from "./lib/recovery-process.mjs"
import {
  allocateLoopbackPort,
  buildSshArguments,
  normalizeRailwayScope,
  parseSourceConnection,
  readSourceSystemId,
  runPrivateCommand,
  selectSourceUrl,
  sourceScopeQuery,
  startScopeTunnel,
} from "./postgres-staging-snapshot.mjs"

const idPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u
const shaPattern = /^[a-f0-9]{64}$/u
const systemIdPattern = /^[1-9]\d{0,19}$/u
const flags = [
  "--project-id",
  "--environment-id",
  "--service-id",
  "--deployment-id",
  "--deployment-instance-id",
  "--volume-instance-id",
  "--volume-id",
  "--expected-source-system-id",
  "--expected-endpoint-sha256",
]
const help = `Usage: pnpm run data:postgres:live-business-aggregate -- \\
  --project-id <uuid> --environment-id <uuid> --service-id <uuid> \\
  --deployment-id <uuid> --deployment-instance-id <uuid> \\
  --volume-instance-id <uuid> --volume-id <uuid> \\
  --expected-source-system-id <decimal> --expected-endpoint-sha256 <sha256>

Read-only staging PostgreSQL counts. Use the exact source IDs, system ID, and
original endpoint fingerprint from the private source-scope snapshot receipt.
Requires the matching DATABASE_BACKUP_URL in this process or DATABASE_URL in a
matching Railway-run context and a pinned ssh.railway.com known-host key.
Returns only fixed counts after source and database identity pass both before
and after the bounded query. This is not Stripe or business reconciliation.
`

const unavailable = () => new Error("Live PostgreSQL aggregate unavailable.")

export const parseLiveBusinessArguments = (argv) => {
  try {
    const args = parseRecoveryArguments(normalizeScriptArguments(argv), flags)
    for (const flag of flags.slice(0, 7)) assert.match(args[flag], idPattern)
    assert.match(args["--expected-source-system-id"], systemIdPattern)
    assert.ok(
      BigInt(args["--expected-source-system-id"]) <= 18446744073709551615n
    )
    assert.match(args["--expected-endpoint-sha256"], shaPattern)
    return args
  } catch {
    throw unavailable()
  }
}

const sshEnvironment = (environment) => ({
  HOME: environment.HOME,
  PATH: environment.PATH,
  ...(environment.SSH_AUTH_SOCK
    ? { SSH_AUTH_SOCK: environment.SSH_AUTH_SOCK }
    : {}),
})
const providerEnvironment = (environment) => ({
  ...sshEnvironment(environment),
  ...(environment.RAILWAY_TOKEN
    ? { RAILWAY_TOKEN: environment.RAILWAY_TOKEN }
    : {}),
  ...(environment.RAILWAY_API_TOKEN
    ? { RAILWAY_API_TOKEN: environment.RAILWAY_API_TOKEN }
    : {}),
})
const postgresEnvironment = (connection, path) => ({
  ...createPostgresClientEnvironment(
    connection.mappedUrl,
    "DATABASE_BACKUP_URL"
  ).environment,
  LANG: "C",
  PATH: path,
})

export const runLiveBusinessAggregate = async (
  argv,
  {
    environment = process.env,
    command = runPrivateCommand,
    tunnelFactory = startScopeTunnel,
    portAllocator = allocateLoopbackPort,
  } = {}
) => {
  const args = parseLiveBusinessArguments(argv)
  const startedAt = new Date().toISOString()
  let tunnel
  let failure
  let evidence
  let scopeController
  try {
    assert.ok(
      environment.HOME && resolve(environment.HOME) === environment.HOME
    )
    assert.ok(environment.PATH)
    scopeController = createRecoveryScope(90_000)
    const signal = scopeController.signal
    const sourceUrl = selectSourceUrl(environment, args)
    const original = parseSourceConnection(sourceUrl, 5432)
    assert.equal(
      original.originalFingerprint,
      args["--expected-endpoint-sha256"]
    )
    const knownHosts = join(environment.HOME, ".ssh", "known_hosts")
    const metadata = await lstat(knownHosts)
    assert.ok(metadata.isFile() && !metadata.isSymbolicLink())
    assert.equal(await realpath(knownHosts), knownHosts)
    assert.equal(metadata.mode & 0o022, 0)
    await command("ssh-keygen", ["-F", "ssh.railway.com", "-f", knownHosts], {
      environment: sshEnvironment(environment),
      signal,
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
    })
    const readScope = async () => {
      const raw = await command(
        "railway",
        [
          "api",
          sourceScopeQuery,
          "--variables",
          JSON.stringify({
            environmentId: args["--environment-id"],
            serviceId: args["--service-id"],
            volumeInstanceId: args["--volume-instance-id"],
          }),
          "--compact",
        ],
        {
          environment: providerEnvironment(environment),
          signal,
          timeoutMs: 15_000,
          maxOutputBytes: 8192,
        }
      )
      return normalizeRailwayScope(JSON.parse(raw), args)
    }
    const preflight = await readScope()
    const localPort = await portAllocator()
    const connection = parseSourceConnection(sourceUrl, localPort)
    tunnel = await tunnelFactory({
      args: buildSshArguments({ scope: preflight, localPort, knownHosts }),
      environment: sshEnvironment(environment),
      signal,
      scope: preflight,
    })
    tunnel.assertOpen()
    const activeSignal = AbortSignal.any([signal, tunnel.exitSignal])
    const readSystemId = () =>
      readSourceSystemId(command, connection, activeSignal, environment.PATH)
    assert.equal(await readSystemId(), args["--expected-source-system-id"])
    tunnel.assertOpen()
    const output = await command(
      "psql",
      [
        "--no-psqlrc",
        "--no-password",
        "--quiet",
        "--set=ON_ERROR_STOP=1",
        "--tuples-only",
        "--no-align",
        `--command=${businessAggregateSql}`,
      ],
      {
        environment: postgresEnvironment(connection, environment.PATH),
        signal: activeSignal,
        timeoutMs: 20_000,
        maxOutputBytes: 8192,
      }
    )
    const aggregate = parseBusinessAggregateOutput(output)
    tunnel.assertOpen()
    const postflight = await readScope()
    assert.deepEqual(postflight, preflight)
    assert.equal(await readSystemId(), args["--expected-source-system-id"])
    tunnel.assertOpen()
    const observedAtEnd = new Date().toISOString()
    const elapsedMs = Date.parse(observedAtEnd) - Date.parse(startedAt)
    assert.ok(elapsedMs >= 0 && elapsedMs <= 90_000)
    evidence = {
      event: "postgres.live_business_aggregate.completed",
      ...aggregate,
      source: "staging_postgres_live_read_only",
      observedAtStart: startedAt,
      observedAtEnd,
      durationMs: elapsedMs,
      sourceIdentityVerified: true,
      readOnly: true,
      businessReconciled: false,
    }
  } catch (error) {
    failure = error
  } finally {
    if (tunnel)
      try {
        await tunnel.close()
      } catch {
        failure = unavailable()
      }
    scopeController?.close()
  }
  if (failure) throw unavailable()
  return evidence
}

export const runLiveBusinessAggregateCli = async ({
  args = process.argv.slice(2),
  run = runLiveBusinessAggregate,
  write = (line) => process.stdout.write(line),
  writeError = (line) => process.stderr.write(line),
} = {}) => {
  try {
    const normalized = normalizeScriptArguments(args)
    if (normalized.length === 1 && normalized[0] === "--help") {
      write(help)
      return 0
    }
    write(`${JSON.stringify(await run(args))}\n`)
    return 0
  } catch {
    writeError(
      `${JSON.stringify({
        schemaVersion: 1,
        event: "postgres.live_business_aggregate.failed",
        reason: "aggregate_unavailable",
      })}\n`
    )
    return 1
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = await runLiveBusinessAggregateCli()
