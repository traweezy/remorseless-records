import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import test from "node:test"
import {
  observabilityPreflightSql,
  parseObservabilityPreflightOutput,
} from "./lib/postgres-observability-preflight.mjs"
import {
  parseObservabilityArguments,
  runObservabilityPreflight,
  runObservabilityPreflightCli,
} from "./postgres-observability-preflight.mjs"

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
const inventory = {
  schemaVersion: 1,
  serverMajor: 16,
  pgStatStatementsPreloaded: false,
  pgStatStatementsInstalled: false,
  slowQueryThresholdMs: -1,
  trackIoTiming: false,
  trackWalIoTiming: false,
  computeQueryId: "auto",
  databaseCounters: {
    connections: 3,
    deadlocks: 0,
    tempFiles: 0,
    blockReadMs: 0,
    blockWriteMs: 0,
  },
}

test("accepts only fixed observability fields and bounded counters", () => {
  assert.deepEqual(
    parseObservabilityPreflightOutput(JSON.stringify(inventory)),
    inventory
  )
  const mutate = (operation) => {
    const copy = structuredClone(inventory)
    operation(copy)
    assert.throws(() => parseObservabilityPreflightOutput(JSON.stringify(copy)))
  }
  mutate((value) => {
    value.queryText = "SELECT private_customer_data"
  })
  mutate((value) => {
    value.databaseCounters.roleName = "private_role"
  })
  mutate((value) => {
    value.databaseCounters.deadlocks = -1
  })
  mutate((value) => {
    value.databaseCounters.blockReadMs = "0"
  })
  mutate((value) => {
    value.slowQueryThresholdMs = null
  })
  mutate((value) => {
    value.serverMajor = 19
  })
  mutate((value) => {
    value.computeQueryId = "private_data"
  })
  for (const raw of ["", "{bad", "x".repeat(4097), "BEGIN\n{}"])
    assert.throws(() => parseObservabilityPreflightOutput(raw))
  assert.match(
    observabilityPreflightSql,
    /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u
  )
  assert.ok(!observabilityPreflightSql.includes("pg_stat_statements.query"))
  assert.ok(!observabilityPreflightSql.includes("pg_stat_activity"))
})
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
  const root = await mkdtemp(join(tmpdir(), "rr-pg-observability-test-"))
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
  let inventoryReads = 0
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
    inventoryReads++
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
    assert.equal(commandOptions.maxOutputBytes, 4096)
    assert.equal(commandOptions.timeoutMs, 20_000)
    if (options.badInventory) return "secret-do-not-log"
    return JSON.stringify(inventory)
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
    get inventoryReads() {
      return inventoryReads
    },
    get closed() {
      return closed
    },
  }
}

test("requires exact source IDs, system ID and endpoint fingerprint", () => {
  assert.equal(parseObservabilityArguments(args)["--service-id"], ids.service)
  for (const replacement of [
    ["--environment-id", "production"],
    ["--expected-source-system-id", "0"],
    ["--expected-source-system-id", "18446744073709551616"],
    ["--expected-endpoint-sha256", "wrong"],
  ]) {
    const modified = [...args]
    modified[modified.indexOf(replacement[0]) + 1] = replacement[1]
    assert.throws(() => parseObservabilityArguments(modified))
  }
  assert.throws(() => parseObservabilityArguments([...args, "--apply"]))
})

test("reports only bounded facts after both staging and database identity checks", async () => {
  await withFixture(async (environment) => {
    const source = fake()
    const report = await runObservabilityPreflight(args, {
      environment,
      command: source.command,
      tunnelFactory: source.tunnelFactory,
      portAllocator: async () => 55321,
    })
    assert.equal(source.reads, 2)
    assert.equal(source.systemReads, 2)
    assert.equal(source.inventoryReads, 1)
    assert.equal(source.closed, true)
    assert.equal(report.event, "postgres.observability_preflight.completed")
    assert.equal(report.sourceIdentityVerified, true)
    assert.equal(report.readOnly, true)
    assert.equal(report.source, "staging_postgres_live_read_only")
    assert.ok(report.durationMs >= 0 && report.durationMs <= 90_000)
    assert.deepEqual(report.databaseCounters, inventory.databaseCounters)
    assert.equal(report.pgStatStatementsPreloaded, false)
    assert.ok(!JSON.stringify(report).includes("secret-do-not-log"))
    assert.ok(!JSON.stringify(report).includes("private-token-do-not-log"))
    assert.ok(!JSON.stringify(report).includes("db.proxy.rlwy.net"))
  })
})

for (const [name, options, expectedInventoryReads] of [
  ["postflight volume drift", { scopeDrift: true }, 1],
  ["postflight system drift", { systemDrift: true }, 1],
  ["wrong initial system", { wrongSystem: true }, 0],
  ["production environment", { productionEnvironment: true }, 0],
  ["malformed inventory", { badInventory: true }, 1],
  ["tunnel cleanup failure", { closeFailure: true }, 1],
]) {
  test(`fails closed after ${name}`, async () => {
    await withFixture(async (environment) => {
      const source = fake(options)
      await assert.rejects(
        runObservabilityPreflight(args, {
          environment,
          command: source.command,
          tunnelFactory: source.tunnelFactory,
          portAllocator: async () => 55321,
        }),
        (error) => {
          assert.equal(
            error.message,
            "PostgreSQL observability preflight unavailable."
          )
          assert.ok(!error.stack.includes("secret-do-not-log"))
          return true
        }
      )
      assert.equal(source.inventoryReads, expectedInventoryReads)
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
      runObservabilityPreflight(wrong, {
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
  const code = await runObservabilityPreflightCli({
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
    event: "postgres.observability_preflight.failed",
    reason: "preflight_unavailable",
  })
  assert.ok(!errorOutput.includes("secret-do-not-log"))
  for (const malformedArgs of [null, ["--", "--", "--help"]]) {
    let malformedOutput = ""
    const status = await runObservabilityPreflightCli({
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
      event: "postgres.observability_preflight.failed",
      reason: "preflight_unavailable",
    })
  }
})

test("CLI help and success retain the explicit diagnostic contract", async () => {
  let help = ""
  let ran = false
  assert.equal(
    await runObservabilityPreflightCli({
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
  assert.ok(
    help.includes("Read-only staging PostgreSQL observability settings")
  )
  let output = ""
  assert.equal(
    await runObservabilityPreflightCli({
      args,
      run: async () => ({ readOnly: true }),
      write: (line) => {
        output += line
      },
    }),
    0
  )
  assert.deepEqual(JSON.parse(output), {
    readOnly: true,
  })
})

const fixtureCommand = async (
  binary,
  args,
  { environment, captureOutput = true }
) => {
  const child = spawn(binary, args, {
    env: environment,
    stdio: ["ignore", captureOutput ? "pipe" : "ignore", "ignore"],
  })
  const chunks = []
  let bytes = 0
  const timer = setTimeout(() => child.kill("SIGKILL"), 15_000)
  try {
    return await new Promise((resolveOutput, reject) => {
      child.once("error", () =>
        reject(Error(`Disposable PostgreSQL ${basename(binary)} failed.`))
      )
      child.stdout?.on("data", (chunk) => {
        bytes += chunk.length
        if (bytes > 4096) child.kill("SIGKILL")
        else chunks.push(chunk)
      })
      child.once("close", (code, signal) => {
        if (code !== 0 || signal || bytes > 4096) {
          reject(Error(`Disposable PostgreSQL ${basename(binary)} failed.`))
          return
        }
        resolveOutput(Buffer.concat(chunks).toString("utf8").trim())
      })
    })
  } finally {
    clearTimeout(timer)
  }
}

for (const modulePath of [
  "$libdir/pg_stat_statements",
  "$libdir/pg_stat_statements.so",
])
  test(`reads disposable PostgreSQL 16 with ${modulePath} preloaded`, {
    skip: !process.env.RR_POSTGRES_TEST_BIN,
  }, async () => {
    const root = await mkdtemp(join(tmpdir(), "rr-pg-observability-fixture-"))
    const bin = process.env.RR_POSTGRES_TEST_BIN
    const data = join(root, "data")
    const environment = { HOME: root, LANG: "C", PATH: process.env.PATH }
    const port = String(50_000 + (process.pid % 10_000))
    const psql = (sql) =>
      fixtureCommand(
        join(bin, "psql"),
        [
          "--no-psqlrc",
          "--no-password",
          "--quiet",
          "--tuples-only",
          "--no-align",
          "--set=ON_ERROR_STOP=1",
          "--host",
          root,
          "--port",
          port,
          "--dbname",
          "postgres",
          "--command",
          sql,
        ],
        { environment }
      )
    let started = false
    try {
      await fixtureCommand(
        join(bin, "initdb"),
        [
          "--pgdata",
          data,
          "--auth-local=trust",
          "--auth-host=reject",
          "--no-instructions",
        ],
        { environment, captureOutput: false }
      )
      await fixtureCommand(
        join(bin, "pg_ctl"),
        [
          "--pgdata",
          data,
          "--options",
          `-c listen_addresses='' -c unix_socket_directories=${root} -p ${port} -c shared_preload_libraries='${modulePath}'`,
          "--log",
          join(root, "postgres.log"),
          "--wait",
          "start",
        ],
        { environment, captureOutput: false }
      )
      started = true
      const raw = await psql(observabilityPreflightSql)
      const report = parseObservabilityPreflightOutput(raw)
      assert.equal(report.serverMajor, 16)
      assert.equal(report.pgStatStatementsPreloaded, true)
      assert.equal(report.pgStatStatementsInstalled, false)
      assert.equal(report.trackIoTiming, false)
      assert.ok(report.databaseCounters.connections >= 1)
      assert.ok(!raw.includes("postgres"))
    } finally {
      if (started || existsSync(join(data, "postmaster.pid")))
        await fixtureCommand(
          join(bin, "pg_ctl"),
          ["--pgdata", data, "--mode", "immediate", "--wait", "stop"],
          { environment, captureOutput: false }
        )
      await rm(root, { recursive: true, force: true })
    }
  })
