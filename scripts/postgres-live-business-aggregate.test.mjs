import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  parseLiveBusinessArguments,
  runLiveBusinessAggregate,
  runLiveBusinessAggregateCli,
} from "./postgres-live-business-aggregate.mjs"

const ids = {
  project: "11111111-1111-4111-8111-111111111111",
  environment: "22222222-2222-4222-8222-222222222222",
  service: "33333333-3333-4333-8333-333333333333",
  deployment: "44444444-4444-4444-8444-444444444444",
  replica: "55555555-5555-4555-8555-555555555555",
  volumeInstance: "66666666-6666-4666-8666-666666666666",
  volume: "77777777-7777-4777-8777-777777777777",
  serviceInstance: "88888888-8888-4888-8888-888888888888",
}
const sourceUrl =
  "postgresql://railway:secret-do-not-log@db.proxy.rlwy.net:51985/railway"
const privateSourceUrl =
  "postgresql://railway:secret-do-not-log@postgres.railway.internal:5432/railway"
const systemId = "12345678901234567890"
const endpointSha = createHash("sha256")
  .update("db.proxy.rlwy.net:51985/railway")
  .digest("hex")
const args = [
  "--project-id",
  ids.project,
  "--environment-id",
  ids.environment,
  "--service-id",
  ids.service,
  "--deployment-id",
  ids.deployment,
  "--deployment-instance-id",
  ids.replica,
  "--volume-instance-id",
  ids.volumeInstance,
  "--volume-id",
  ids.volume,
  "--expected-source-system-id",
  systemId,
  "--expected-endpoint-sha256",
  endpointSha,
]
const aggregate = {
  schemaVersion: 1,
  physicalRelationCounts: {
    carts: 0,
    paymentCollections: 0,
    paymentSessions: 0,
    payments: 0,
    orders: 0,
    orderCarts: 0,
    captures: 0,
    refunds: 0,
    orderTransactions: 0,
  },
  taxQuoteEvidence: {
    prepared: 0,
    succeeded: 0,
    canceled: 0,
    failed: 0,
    associationFailed: 0,
    disputed: 0,
    partiallyRefunded: 0,
    refunded: 0,
    unknown: 0,
    collect: 0,
    disabled: 0,
    unknownCollectionMode: 0,
  },
  stripeLifecycleEvents: {
    activeTotal: 0,
    received: 0,
    processing: 0,
    processed: 0,
    ignored: 0,
    failed: 0,
    unknown: 0,
    livemode: 0,
  },
}
const apiScope = () => ({
  data: {
    serviceInstance: {
      id: ids.serviceInstance,
      environmentId: ids.environment,
      serviceId: ids.service,
      activeDeployments: [
        {
          id: ids.deployment,
          projectId: ids.project,
          environmentId: ids.environment,
          serviceId: ids.service,
          status: "SUCCESS",
          instances: [{ id: ids.replica, status: "RUNNING" }],
        },
      ],
    },
    volumeInstance: {
      id: ids.volumeInstance,
      volumeId: ids.volume,
      environmentId: ids.environment,
      serviceId: ids.service,
      mountPath: "/var/lib/postgresql/data",
      state: "READY",
      deletedAt: null,
      isPendingDeletion: false,
      environment: {
        id: ids.environment,
        projectId: ids.project,
        name: "staging",
      },
    },
  },
})

const withFixture = async (run) => {
  const root = await mkdtemp(join(tmpdir(), "rr-pg-live-aggregate-test-"))
  try {
    await mkdir(join(root, ".ssh"), { mode: 0o700 })
    await writeFile(
      join(root, ".ssh", "known_hosts"),
      "ssh.railway.com ssh-ed25519 TEST\n",
      { mode: 0o600 }
    )
    return await run({
      HOME: root,
      PATH: process.env.PATH,
      DATABASE_BACKUP_URL: sourceUrl,
      RAILWAY_TOKEN: "private-token-do-not-log",
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const fake = (options = {}) => {
  let reads = 0
  let systemReads = 0
  let aggregateReads = 0
  let closed = false
  const tunnelFactory = async ({ args: sshArgs, environment, scope }) => {
    assert.ok(sshArgs.includes("StrictHostKeyChecking=yes"))
    assert.ok(sshArgs.includes(`${ids.serviceInstance}@ssh.railway.com`))
    assert.equal(scope.deploymentInstanceId, ids.replica)
    assert.equal(environment.RAILWAY_TOKEN, undefined)
    return {
      exitSignal: new AbortController().signal,
      assertOpen: () => assert.equal(closed, false),
      close: async () => {
        closed = true
        if (options.closeFailure) throw Error("secret tunnel failure")
      },
    }
  }
  const command = async (binary, commandArgs, commandOptions) => {
    if (binary === "ssh-keygen") {
      assert.equal(commandOptions.environment.DATABASE_BACKUP_URL, undefined)
      return "# known host"
    }
    if (binary === "railway") {
      assert.equal(
        commandOptions.environment.RAILWAY_TOKEN,
        "private-token-do-not-log"
      )
      assert.equal(commandOptions.environment.DATABASE_BACKUP_URL, undefined)
      reads++
      const scope = apiScope()
      if (options.scopeDrift && reads === 2)
        scope.data.volumeInstance.state = "DETACHED"
      if (options.productionEnvironment)
        scope.data.volumeInstance.environment.name = "production"
      return JSON.stringify(scope)
    }
    assert.equal(binary, "psql")
    assert.equal(commandOptions.environment.PGHOST, "127.0.0.1")
    assert.equal(commandOptions.environment.PGSSLMODE, "require")
    assert.equal(commandOptions.environment.PGPASSWORD, "secret-do-not-log")
    assert.equal(commandOptions.environment.RAILWAY_TOKEN, undefined)
    assert.equal(commandOptions.environment.DATABASE_BACKUP_URL, undefined)
    if (commandArgs.at(-1).includes("pg_control_system()")) {
      systemReads++
      if (options.systemDrift && systemReads === 2)
        return "99999999999999999999"
      return options.wrongSystem ? "11111111111111111111" : systemId
    }
    aggregateReads++
    assert.ok(commandArgs.includes("--no-psqlrc"))
    assert.ok(commandArgs.includes("--no-password"))
    assert.ok(commandArgs.includes("--set=ON_ERROR_STOP=1"))
    assert.ok(
      commandArgs
        .at(-1)
        .startsWith(
          "--command=\nBEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;"
        )
    )
    assert.equal(commandOptions.maxOutputBytes, 8192)
    assert.equal(commandOptions.timeoutMs, 20_000)
    if (options.badAggregate) return "secret-do-not-log"
    return JSON.stringify(aggregate)
  }
  return {
    command,
    tunnelFactory,
    get reads() {
      return reads
    },
    get systemReads() {
      return systemReads
    },
    get aggregateReads() {
      return aggregateReads
    },
    get closed() {
      return closed
    },
  }
}

test("requires exact source IDs, system ID and endpoint fingerprint", () => {
  assert.equal(parseLiveBusinessArguments(args)["--service-id"], ids.service)
  for (const replacement of [
    ["--environment-id", "production"],
    ["--expected-source-system-id", "0"],
    ["--expected-source-system-id", "18446744073709551616"],
    ["--expected-endpoint-sha256", "wrong"],
  ]) {
    const modified = [...args]
    modified[modified.indexOf(replacement[0]) + 1] = replacement[1]
    assert.throws(() => parseLiveBusinessArguments(modified))
  }
  assert.throws(() => parseLiveBusinessArguments([...args, "--apply"]))
})

test("reports only bounded counts after both staging and database identity checks", async () => {
  await withFixture(async (environment) => {
    const source = fake()
    const report = await runLiveBusinessAggregate(args, {
      environment,
      command: source.command,
      tunnelFactory: source.tunnelFactory,
      portAllocator: async () => 55321,
    })
    assert.equal(source.reads, 2)
    assert.equal(source.systemReads, 2)
    assert.equal(source.aggregateReads, 1)
    assert.equal(source.closed, true)
    assert.equal(report.event, "postgres.live_business_aggregate.completed")
    assert.equal(report.sourceIdentityVerified, true)
    assert.equal(report.readOnly, true)
    assert.equal(report.businessReconciled, false)
    assert.equal(report.source, "staging_postgres_live_read_only")
    assert.ok(report.durationMs >= 0 && report.durationMs <= 90_000)
    assert.deepEqual(
      report.physicalRelationCounts,
      aggregate.physicalRelationCounts
    )
    assert.ok(!JSON.stringify(report).includes("secret-do-not-log"))
    assert.ok(!JSON.stringify(report).includes("private-token-do-not-log"))
  })
})

test("accepts a private-source receipt through the guarded tunnel", async () => {
  await withFixture(async (environment) => {
    const source = fake()
    const privateEnvironment = {
      ...environment,
      DATABASE_BACKUP_URL: privateSourceUrl,
    }
    await assert.rejects(
      runLiveBusinessAggregate(args, {
        environment: privateEnvironment,
        command: source.command,
        tunnelFactory: source.tunnelFactory,
      })
    )
    assert.equal(source.reads, 0)
    const privateArgs = [...args]
    privateArgs[privateArgs.indexOf("--expected-endpoint-sha256") + 1] =
      createHash("sha256")
        .update("postgres.railway.internal:5432/railway")
        .digest("hex")
    const report = await runLiveBusinessAggregate(privateArgs, {
      environment: privateEnvironment,
      command: source.command,
      tunnelFactory: source.tunnelFactory,
      portAllocator: async () => 55321,
    })
    assert.equal(report.sourceIdentityVerified, true)
    assert.equal(source.reads, 2)
    assert.equal(source.systemReads, 2)
    assert.equal(source.aggregateReads, 1)
    assert.equal(source.closed, true)
    assert.ok(!JSON.stringify(report).includes("postgres.railway.internal"))
  })
})

for (const [name, options, expectedAggregateReads] of [
  ["postflight volume drift", { scopeDrift: true }, 1],
  ["postflight system drift", { systemDrift: true }, 1],
  ["wrong initial system", { wrongSystem: true }, 0],
  ["production environment", { productionEnvironment: true }, 0],
  ["malformed aggregate", { badAggregate: true }, 1],
  ["tunnel cleanup failure", { closeFailure: true }, 1],
]) {
  test(`fails closed after ${name}`, async () => {
    await withFixture(async (environment) => {
      const source = fake(options)
      await assert.rejects(
        runLiveBusinessAggregate(args, {
          environment,
          command: source.command,
          tunnelFactory: source.tunnelFactory,
          portAllocator: async () => 55321,
        }),
        (error) => {
          assert.equal(error.message, "Live PostgreSQL aggregate unavailable.")
          assert.ok(!error.stack.includes("secret-do-not-log"))
          return true
        }
      )
      assert.equal(source.aggregateReads, expectedAggregateReads)
      assert.equal(source.closed, options.productionEnvironment ? false : true)
    })
  })
}

test("rejects mismatched endpoint before invoking Railway or opening a tunnel", async () => {
  await withFixture(async (environment) => {
    const source = fake()
    const wrong = [...args]
    wrong[wrong.indexOf("--expected-endpoint-sha256") + 1] = "a".repeat(64)
    await assert.rejects(
      runLiveBusinessAggregate(wrong, {
        environment,
        command: source.command,
        tunnelFactory: source.tunnelFactory,
      })
    )
    assert.equal(source.reads, 0)
    assert.equal(source.closed, false)
  })
})

test("CLI failure emits only a fixed redacted event", async () => {
  let output = ""
  let errorOutput = ""
  const code = await runLiveBusinessAggregateCli({
    args,
    run: async () => {
      throw Error("secret-do-not-log")
    },
    write: (line) => {
      output += line
    },
    writeError: (line) => {
      errorOutput += line
    },
  })
  assert.equal(code, 1)
  assert.equal(output, "")
  assert.deepEqual(JSON.parse(errorOutput), {
    schemaVersion: 1,
    event: "postgres.live_business_aggregate.failed",
    reason: "aggregate_unavailable",
  })
  assert.ok(!errorOutput.includes("secret-do-not-log"))
  for (const malformedArgs of [null, ["--", "--", "--help"]]) {
    let malformedOutput = ""
    const status = await runLiveBusinessAggregateCli({
      args: malformedArgs,
      write: (line) => {
        malformedOutput += line
      },
      writeError: (line) => {
        malformedOutput += line
      },
    })
    assert.equal(status, 1)
    assert.deepEqual(JSON.parse(malformedOutput), {
      schemaVersion: 1,
      event: "postgres.live_business_aggregate.failed",
      reason: "aggregate_unavailable",
    })
  }
})

test("CLI help and success retain the explicit diagnostic contract", async () => {
  let help = ""
  let ran = false
  assert.equal(
    await runLiveBusinessAggregateCli({
      args: ["--help"],
      run: async () => {
        ran = true
      },
      write: (line) => {
        help += line
      },
    }),
    0
  )
  assert.equal(ran, false)
  assert.ok(help.includes("Read-only staging PostgreSQL counts"))
  let output = ""
  assert.equal(
    await runLiveBusinessAggregateCli({
      args,
      run: async () => ({ businessReconciled: false, readOnly: true }),
      write: (line) => {
        output += line
      },
    }),
    0
  )
  assert.deepEqual(JSON.parse(output), {
    businessReconciled: false,
    readOnly: true,
  })
})
