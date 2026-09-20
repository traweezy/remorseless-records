import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import {
  assertRailwaySource,
  consumeCaptureEvents,
  parseCaptureArguments,
  runCaptureCli,
  readRailwayStatus,
  runRailwayRemote,
  validatePreflight,
} from "./redis-aof-capture.mjs"

const sourceIds = {
  projectId: "11111111-1111-4111-8111-111111111111",
  environmentId: "22222222-2222-4222-8222-222222222222",
  serviceId: "33333333-3333-4333-8333-333333333333",
  deploymentId: "44444444-4444-4444-8444-444444444444",
  instanceId: "55555555-5555-4555-8555-555555555555",
  volumeId: "66666666-6666-4666-8666-666666666666",
  volumeInstanceId: "77777777-7777-4777-8777-777777777777",
}
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
const manifest =
  "file appendonly.aof.1.base.rdb seq 1 type b\nfile appendonly.aof.1.incr.aof seq 1 type i\n"
const remoteSource = await readFile(
  new URL("./lib/redis-aof-capture-remote.pl", import.meta.url),
  "utf8"
)

const sourceArguments = Object.entries(sourceIds).flatMap(([key, value]) => [
  `--${key.replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`,
  value,
])

const makeStatus = () => ({
  id: sourceIds.projectId,
  environments: {
    edges: [
      {
        node: {
          id: sourceIds.environmentId,
          name: "staging",
          serviceInstances: {
            edges: [
              {
                node: {
                  serviceId: sourceIds.serviceId,
                  serviceName: "Redis",
                  activeDeployments: [
                    {
                      id: sourceIds.deploymentId,
                      instances: [
                        { id: sourceIds.instanceId, status: "RUNNING" },
                      ],
                    },
                  ],
                },
              },
            ],
          },
          volumeInstances: {
            edges: [
              {
                node: {
                  id: sourceIds.volumeInstanceId,
                  serviceId: sourceIds.serviceId,
                  environmentId: sourceIds.environmentId,
                  volume: { id: sourceIds.volumeId },
                  mountPath: "/bitnami",
                  state: "READY",
                  isPendingDeletion: false,
                },
              },
            ],
          },
        },
      },
    ],
  },
})

const syntheticPreflight = () => {
  const files = [
    { name: "appendonly.aof.manifest", bytes: Buffer.byteLength(manifest) },
    { name: "appendonly.aof.1.base.rdb", bytes: 14 },
    { name: "appendonly.aof.1.incr.aof", bytes: 14 },
  ]
  return {
    type: "preflight",
    aofDir: "/bitnami/redis/data/appendonlydir",
    runIdSha256: hash("a".repeat(40)),
    autoRewritePercentage: "100",
    manifestBase64: Buffer.from(manifest).toString("base64"),
    manifestSha256: hash(manifest),
    files,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
  }
}

const emitSyntheticCapture = async (event, onEvent) => {
  await onEvent({
    type: "start",
    manifestSha256: event.manifestSha256,
    runIdSha256: event.runIdSha256,
    priorRewritePercentage: "100",
  })
  for (const [name, bytes] of [
    ["appendonly.aof.manifest", Buffer.from(manifest)],
    ["appendonly.aof.1.base.rdb", Buffer.from("synthetic-base")],
    ["appendonly.aof.1.incr.aof", Buffer.from("synthetic-incr")],
  ]) {
    await onEvent({ type: "fileStart", name, bytes: bytes.length })
    await onEvent({
      type: "chunk",
      name,
      offset: 0,
      data: bytes.toString("base64"),
    })
    await onEvent({
      type: "fileEnd",
      name,
      bytes: bytes.length,
      sha256: hash(bytes),
    })
  }
  await onEvent({
    type: "done",
    manifestSha256: event.manifestSha256,
    runIdSha256: event.runIdSha256,
    priorRewritePercentage: "100",
    rewriteRestored: true,
  })
}

const fakeCli = `#!/usr/bin/env node
const fs = require("node:fs")
const file = process.env.RR_TEST_REDIS_STATE
const state = JSON.parse(fs.readFileSync(file, "utf8"))
const args = process.argv.slice(process.argv.indexOf("--raw") + 1)
const [command, verb, name, value] = args
if (command === "CONFIG" && verb === "GET") {
  const values = {
    appendonly: "yes",
    appendfsync: "everysec",
    appendfilename: "appendonly.aof",
    appenddirname: "appendonlydir",
    dir: state.dataDir,
    "auto-aof-rewrite-percentage": state.rewrite,
  }
  process.stdout.write(name + "\\n" + values[name] + "\\n")
} else if (command === "CONFIG" && verb === "SET") {
  if (state.failRestore && value === "100") process.exit(1)
  state.rewrite = value
  if (state.mutateManifestOnHold && value === "0")
    fs.appendFileSync(state.manifestPath, "# changed\\n")
  fs.writeFileSync(file, JSON.stringify(state))
  process.stdout.write("OK\\n")
} else if (command === "INFO" && verb === "server") {
  process.stdout.write("# Server\\nredis_version:8.0.3\\nrun_id:" + "a".repeat(40) + "\\n")
} else if (command === "INFO" && verb === "replication") {
  process.stdout.write("# Replication\\nrole:master\\n")
} else if (command === "INFO" && verb === "persistence") {
  process.stdout.write("# Persistence\\naof_enabled:1\\naof_rewrite_in_progress:" +
    (state.failAfterHold && state.rewrite === "0" ? "1" : "0") +
    "\\naof_rewrite_scheduled:0\\naof_last_write_status:ok\\naof_last_bgrewrite_status:ok\\naof_current_size:20\\n")
} else process.exit(1)
`

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "redis-aof-capture-test-"))
  const dataDir = join(root, "redis", "data")
  const aofDir = join(dataDir, "appendonlydir")
  await mkdir(aofDir, { recursive: true })
  await writeFile(join(aofDir, "appendonly.aof.manifest"), manifest)
  await writeFile(join(aofDir, "appendonly.aof.1.base.rdb"), "synthetic-base")
  await writeFile(join(aofDir, "appendonly.aof.1.incr.aof"), "synthetic-incr")
  const cli = join(root, "redis-cli-test")
  await writeFile(cli, fakeCli)
  await chmod(cli, 0o700)
  const stateFile = join(root, "redis-state.json")
  await writeFile(stateFile, JSON.stringify({ dataDir, rewrite: "100" }))
  const scope = { ...sourceIds, mountPath: root }
  const environment = {
    ...process.env,
    REDIS_PASSWORD: "synthetic-password",
    RR_TEST_REDIS_STATE: stateFile,
    RAILWAY_PROJECT_ID: scope.projectId,
    RAILWAY_ENVIRONMENT_ID: scope.environmentId,
    RAILWAY_SERVICE_ID: scope.serviceId,
    RAILWAY_DEPLOYMENT_ID: scope.deploymentId,
    RAILWAY_REPLICA_ID: scope.instanceId,
    RAILWAY_VOLUME_ID: scope.volumeId,
    RAILWAY_VOLUME_MOUNT_PATH: scope.mountPath,
  }
  const program = remoteSource.replace(
    "my $cli = '/opt/bitnami/redis/bin/redis-cli';",
    `my $cli = '${cli}';`
  )
  assert.notEqual(program, remoteSource)
  return { root, aofDir, stateFile, scope, environment, program }
}

const invoke = async (
  fixtureState,
  request,
  { pauseOutput = false, onLine } = {}
) => {
  const child = spawn(
    "perl",
    [
      "-",
      Buffer.from(
        JSON.stringify({ ...fixtureState.scope, ...request })
      ).toString("base64"),
    ],
    { stdio: ["pipe", "pipe", "pipe"], env: fixtureState.environment }
  )
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", resolve)
  })
  child.stdin.end(fixtureState.program)
  let stdout = ""
  let pending = ""
  if (!pauseOutput)
    for await (const chunk of child.stdout) {
      stdout += chunk
      if (onLine) {
        pending += chunk
        let newline = pending.indexOf("\n")
        while (newline !== -1) {
          await onLine(JSON.parse(pending.slice(0, newline)))
          pending = pending.slice(newline + 1)
          newline = pending.indexOf("\n")
        }
      }
    }
  child.stderr.resume()
  return { child, closed, output: () => stdout }
}

test("arguments and exact Railway source fail closed", () => {
  const parsed = parseCaptureArguments(["preflight", ...sourceArguments])
  assert.deepEqual(
    parseCaptureArguments(["--", "preflight", ...sourceArguments]),
    parsed
  )
  assert.deepEqual(parsed.scope, { ...sourceIds, mountPath: "/bitnami" })
  assertRailwaySource(makeStatus(), parsed.scope)
  for (const args of [
    ["capture", ...sourceArguments],
    ["preflight", ...sourceArguments, "--confirm", "a".repeat(64)],
    ["preflight", ...sourceArguments, "--max-bytes", "0"],
  ])
    assert.throws(() => parseCaptureArguments(args))
  const wrong = makeStatus()
  wrong.environments.edges[0].node.serviceInstances.edges[0].node.activeDeployments[0].instances[0].id =
    "88888888-8888-4888-8888-888888888888"
  assert.throws(() => assertRailwaySource(wrong, parsed.scope))
})

test("source and preflight metadata reject unsafe identity and size drift", () => {
  const scope = { ...sourceIds, mountPath: "/bitnami" }
  for (const mutate of [
    (value) => {
      value.id = sourceIds.serviceId
    },
    (value) => {
      value.environments.edges[0].node.name = "production"
    },
    (value) => {
      value.environments.edges[0].node.serviceInstances.edges[0].node.serviceName =
        "Other"
    },
    (value) => {
      value.environments.edges[0].node.serviceInstances.edges[0].node.activeDeployments.push(
        {}
      )
    },
    (value) => {
      value.environments.edges[0].node.volumeInstances.edges[0].node.state =
        "PENDING"
    },
    (value) => {
      value.environments.edges[0].node.volumeInstances.edges[0].node.mountPath =
        "/wrong"
    },
  ]) {
    const changed = makeStatus()
    mutate(changed)
    assert.throws(() => assertRailwaySource(changed, scope), {
      message: "Redis AOF capture unavailable.",
    })
  }
  for (const mutate of [
    (value) => {
      value.type = "postcheck"
    },
    (value) => {
      value.runIdSha256 = "bad"
    },
    (value) => {
      value.aofDir = "/different"
    },
    (value) => {
      value.autoRewritePercentage = "-1"
    },
    (value) => {
      value.manifestBase64 = "%%%%"
    },
    (value) => {
      value.manifestSha256 = "0".repeat(64)
    },
    (value) => {
      value.files.pop()
    },
    (value) => {
      value.files[1].name = "../escape"
    },
    (value) => {
      value.files[1].bytes = -1
    },
    (value) => {
      value.totalBytes += 1
    },
  ]) {
    const changed = syntheticPreflight()
    mutate(changed)
    assert.throws(() => validatePreflight(changed, scope, 1048576), {
      message: "Redis AOF capture unavailable.",
    })
  }
  assert.throws(() => validatePreflight(syntheticPreflight(), scope, 1), {
    message: "Redis AOF capture unavailable.",
  })
})

test("stream consumer rejects malformed framing, offsets, digests, and completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "redis-aof-stream-test-"))
  const event = syntheticPreflight()
  const scope = { ...sourceIds, mountPath: "/bitnami" }
  const preflight = validatePreflight(event, scope, 1048576)
  const valid = []
  await emitSyntheticCapture(event, async (part) => valid.push(part))
  const cases = [
    (parts) => {
      parts[0].runIdSha256 = "0".repeat(64)
    },
    (parts) => {
      parts[1].name = "../escape"
    },
    (parts) => {
      parts[1].bytes = 1048577
    },
    (parts) => {
      parts[2].offset = 1
    },
    (parts) => {
      parts[2].data = "bad%"
    },
    (parts) => {
      parts[3].sha256 = "0".repeat(64)
    },
    (parts) => {
      parts.at(-1).rewriteRestored = false
    },
    (parts) => {
      parts.pop()
    },
    (parts) => {
      parts.push({ type: "unexpected" })
    },
    (parts) => {
      parts[1] = { type: "failed" }
    },
  ]
  try {
    for (const [index, mutate] of cases.entries()) {
      const archive = join(root, `case-${index}`)
      await mkdir(archive, { mode: 0o700 })
      const parts = structuredClone(valid)
      mutate(parts)
      await assert.rejects(
        consumeCaptureEvents(parts, archive, preflight, 1048576),
        { message: "Redis AOF capture unavailable." }
      )
      assert.equal(
        (await readdir(archive)).every((name) => !name.includes("..")),
        true
      )
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("local orchestrator publishes only after complete capture and independent restore check", async () => {
  const outputParent = await mkdtemp(join(tmpdir(), "redis-aof-output-test-"))
  const event = syntheticPreflight()
  const lines = []
  const errors = []
  const calls = []
  const remote = async (_scope, request) => {
    calls.push(request.mode)
    if (request.mode === "preflight") return event
    assert.equal(request.mode, "postcheck")
    return {
      type: "postcheck",
      runIdSha256: event.runIdSha256,
      autoRewritePercentage: "100",
    }
  }
  const status = async () => makeStatus()
  const captureRemote = async (_scope, request, { onEvent }) => {
    calls.push(request.mode)
    await onEvent({
      type: "start",
      manifestSha256: event.manifestSha256,
      runIdSha256: event.runIdSha256,
      priorRewritePercentage: "100",
    })
    for (const [name, bytes] of [
      ["appendonly.aof.manifest", Buffer.from(manifest)],
      ["appendonly.aof.1.base.rdb", Buffer.from("synthetic-base")],
      ["appendonly.aof.1.incr.aof", Buffer.from("synthetic-incr")],
    ]) {
      await onEvent({ type: "fileStart", name, bytes: bytes.length })
      await onEvent({
        type: "chunk",
        name,
        offset: 0,
        data: bytes.toString("base64"),
      })
      await onEvent({
        type: "fileEnd",
        name,
        bytes: bytes.length,
        sha256: hash(bytes),
      })
    }
    await onEvent({
      type: "done",
      manifestSha256: event.manifestSha256,
      runIdSha256: event.runIdSha256,
      priorRewritePercentage: "100",
      rewriteRestored: true,
    })
  }
  try {
    const common = {
      status,
      remote,
      captureRemote,
      write: (line) => lines.push(line),
      writeError: (line) => errors.push(line),
    }
    assert.equal(
      await runCaptureCli({
        ...common,
        args: ["preflight", ...sourceArguments, "--max-bytes", "1048576"],
      }),
      0
    )
    const fingerprint = JSON.parse(lines.at(-1)).fingerprint
    assert.equal(
      await runCaptureCli({
        ...common,
        args: [
          "capture",
          ...sourceArguments,
          "--max-bytes",
          "1048576",
          "--output-parent",
          outputParent,
          "--confirm",
          fingerprint,
        ],
      }),
      0
    )
    const result = JSON.parse(lines.at(-1))
    assert.equal(result.event, "redis.aof_capture.completed")
    assert.equal(result.rewriteRestored, true)
    assert.equal(result.checkerVerified, false)
    assert.equal(result.replayProven, false)
    assert.deepEqual(calls, ["preflight", "preflight", "capture", "postcheck"])
    assert.deepEqual(errors, [])
    assert.equal(
      await readFile(
        join(result.archiveDirectory, "appendonly.aof.manifest"),
        "utf8"
      ),
      manifest
    )
    assert.equal((await stat(result.archiveDirectory)).mode & 0o777, 0o700)
    const receiptFile = await open(result.receipt, "r")
    try {
      assert.equal((await receiptFile.stat()).mode & 0o777, 0o600)
      const receipt = JSON.parse(await receiptFile.readFile("utf8"))
      assert.equal(receipt.manifestSha256, event.manifestSha256)
      assert.equal(receipt.rewriteRestored, true)
      assert.equal(receipt.queueReconciled, false)
    } finally {
      await receiptFile.close()
    }
  } finally {
    await rm(outputParent, { recursive: true, force: true })
  }
})

test("local capture refuses a stale confirmation and removes failed partial output", async () => {
  const outputParent = await mkdtemp(join(tmpdir(), "redis-aof-failure-test-"))
  const event = syntheticPreflight()
  const errors = []
  let captureCalls = 0
  const common = {
    status: async () => makeStatus(),
    remote: async (_scope, request) =>
      request.mode === "preflight"
        ? event
        : {
            type: "postcheck",
            runIdSha256: event.runIdSha256,
            autoRewritePercentage: "100",
          },
    captureRemote: async (_scope, _request, { onEvent }) => {
      captureCalls += 1
      await onEvent({
        type: "start",
        manifestSha256: event.manifestSha256,
        runIdSha256: event.runIdSha256,
        priorRewritePercentage: "100",
      })
      await onEvent({
        type: "fileStart",
        name: "appendonly.aof.manifest",
        bytes: Buffer.byteLength(manifest),
      })
      throw new Error("synthetic interruption with private data")
    },
    write: () => {},
    writeError: (line) => errors.push(line),
  }
  try {
    const args = [
      "capture",
      ...sourceArguments,
      "--max-bytes",
      "1048576",
      "--output-parent",
      outputParent,
      "--confirm",
      "f".repeat(64),
    ]
    assert.equal(await runCaptureCli({ ...common, args }), 1)
    assert.equal(captureCalls, 0)
    const fingerprint = validatePreflight(
      event,
      { ...sourceIds, mountPath: "/bitnami" },
      1048576
    ).fingerprint
    args[args.length - 1] = fingerprint
    assert.equal(await runCaptureCli({ ...common, args }), 1)
    assert.equal(captureCalls, 1)
    assert.deepEqual(await readdir(outputParent), [])
    assert.equal(errors.length, 2)
    assert.ok(errors.every((line) => !line.includes("private data")))
    assert.equal(JSON.parse(errors.at(-1)).restoreVerified, true)
  } finally {
    await rm(outputParent, { recursive: true, force: true })
  }
})

test("Railway command boundaries reject malformed, excessive, and stalled output", async () => {
  const root = await mkdtemp(join(tmpdir(), "redis-aof-railway-test-"))
  const command = join(root, "railway-test")
  const scope = { ...sourceIds, mountPath: "/bitnami" }
  const install = async (body) => {
    await writeFile(command, `#!/usr/bin/env node\n${body}\n`)
    await chmod(command, 0o700)
  }
  try {
    await install(
      `process.stdout.write(${JSON.stringify(JSON.stringify(makeStatus()))})`
    )
    assert.equal(
      (await readRailwayStatus(scope, { command })).id,
      scope.projectId
    )
    await install('process.stdout.write("private invalid metadata")')
    await assert.rejects(readRailwayStatus(scope, { command }), {
      message: "Redis AOF capture unavailable.",
    })
    await install('process.stdout.write("x".repeat(1024 * 1024 + 1))')
    await assert.rejects(readRailwayStatus(scope, { command }), {
      message: "Redis AOF capture unavailable.",
    })
    await install(
      'process.stderr.write("private job payload"); process.stdout.write("{bad}\\n")'
    )
    await assert.rejects(
      runRailwayRemote(scope, { mode: "preflight", maxBytes: 1 }, { command }),
      { message: "Redis AOF capture unavailable." }
    )
    await install("process.exit(0)")
    await assert.rejects(
      runRailwayRemote(scope, { mode: "preflight", maxBytes: 1 }, { command }),
      { message: "Redis AOF capture unavailable." }
    )
    await install(
      'process.stdout.write(JSON.stringify({type:"preflight"})+"\\n"+JSON.stringify({type:"postcheck"})+"\\n")'
    )
    await assert.rejects(
      runRailwayRemote(scope, { mode: "preflight", maxBytes: 1 }, { command }),
      { message: "Redis AOF capture unavailable." }
    )
    await install(
      'process.on("SIGTERM",()=>{process.stdout.write(JSON.stringify({type:"preflight"})+"\\n"); process.exit(0)}); setInterval(()=>{},1000)'
    )
    await assert.rejects(
      runRailwayRemote(
        scope,
        { mode: "preflight", maxBytes: 1 },
        { command, timeoutMs: 150 }
      ),
      { message: "Redis AOF capture unavailable." }
    )
    await install('process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)')
    const started = Date.now()
    await assert.rejects(
      runRailwayRemote(
        scope,
        { mode: "preflight", maxBytes: 1 },
        { command, timeoutMs: 50 }
      ),
      { message: "Redis AOF capture unavailable." }
    )
    assert.ok(Date.now() - started < 4000)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("postcheck failure withholds archive and reports rewrite restoration unverified", async () => {
  const outputParent = await mkdtemp(
    join(tmpdir(), "redis-aof-postcheck-test-")
  )
  const event = syntheticPreflight()
  const fingerprint = validatePreflight(
    event,
    { ...sourceIds, mountPath: "/bitnami" },
    1048576
  ).fingerprint
  const errors = []
  try {
    assert.equal(
      await runCaptureCli({
        args: [
          "capture",
          ...sourceArguments,
          "--max-bytes",
          "1048576",
          "--output-parent",
          outputParent,
          "--confirm",
          fingerprint,
        ],
        status: async () => makeStatus(),
        remote: async (_scope, request) =>
          request.mode === "preflight"
            ? event
            : {
                type: "postcheck",
                runIdSha256: event.runIdSha256,
                autoRewritePercentage: "0",
              },
        captureRemote: async (_scope, _request, { onEvent }) =>
          emitSyntheticCapture(event, onEvent),
        postcheckAttempts: 2,
        postcheckWaitMs: 1,
        write: () => assert.fail("unverified capture must not publish"),
        writeError: (line) => errors.push(JSON.parse(line)),
      }),
      1
    )
    assert.deepEqual(await readdir(outputParent), [])
    assert.equal(errors[0].phase, "restore_check")
    assert.equal(errors[0].liveConfigChangeAttempted, true)
    assert.equal(errors[0].restoreVerified, false)
  } finally {
    await rm(outputParent, { recursive: true, force: true })
  }
})

test("source instance drift and output-parent replacement remove private partials", async () => {
  const event = syntheticPreflight()
  const fingerprint = validatePreflight(
    event,
    { ...sourceIds, mountPath: "/bitnami" },
    1048576
  ).fingerprint
  for (const drift of ["instance", "parent"]) {
    const outputParent = await mkdtemp(join(tmpdir(), "redis-aof-drift-test-"))
    const movedParent = `${outputParent}-moved`
    const errors = []
    let statusCalls = 0
    try {
      assert.equal(
        await runCaptureCli({
          args: [
            "capture",
            ...sourceArguments,
            "--max-bytes",
            "1048576",
            "--output-parent",
            outputParent,
            "--confirm",
            fingerprint,
          ],
          status: async () => {
            statusCalls += 1
            if (statusCalls === 2 && drift === "parent") {
              await rename(outputParent, movedParent)
              await mkdir(outputParent, { mode: 0o700 })
            }
            const value = makeStatus()
            if (statusCalls === 2 && drift === "instance")
              value.environments.edges[0].node.serviceInstances.edges[0].node.activeDeployments[0].instances[0].id =
                "88888888-8888-4888-8888-888888888888"
            return value
          },
          remote: async (_scope, request) =>
            request.mode === "preflight"
              ? event
              : {
                  type: "postcheck",
                  runIdSha256: event.runIdSha256,
                  autoRewritePercentage: "100",
                },
          captureRemote: async (_scope, _request, { onEvent }) =>
            emitSyntheticCapture(event, onEvent),
          write: () => assert.fail("drifted capture must not publish"),
          writeError: (line) => errors.push(JSON.parse(line)),
        }),
        1
      )
      assert.equal(statusCalls, 2)
      assert.equal(errors[0].phase, "publication")
      assert.equal(errors[0].restoreVerified, true)
      assert.deepEqual(await readdir(outputParent), [])
      if (drift === "parent") assert.deepEqual(await readdir(movedParent), [])
    } finally {
      await rm(outputParent, { recursive: true, force: true })
      await rm(movedParent, { recursive: true, force: true })
    }
  }
})

test("remote read-only preflight binds manifest and private streamed capture restores config", async () => {
  const f = await fixture()
  try {
    const preflightCall = await invoke(f, {
      mode: "preflight",
      maxBytes: 1024 * 1024,
    })
    assert.equal(await preflightCall.closed, 0)
    const event = JSON.parse(preflightCall.output())
    const preflight = validatePreflight(event, f.scope, 1024 * 1024)
    assert.equal(preflight.manifestSha256, hash(manifest))
    assert.equal(
      (await readFile(f.stateFile, "utf8")).includes('"rewrite":"100"'),
      true
    )
    const archive = join(f.root, "archive")
    await mkdir(archive, { mode: 0o700 })
    const captureCall = await invoke(f, {
      mode: "capture",
      maxBytes: 1024 * 1024,
      deadlineSeconds: 30,
      manifestSha256: preflight.manifestSha256,
      runIdSha256: preflight.runIdSha256,
      priorRewritePercentage: preflight.priorRewritePercentage,
      files: preflight.files,
    })
    assert.equal(await captureCall.closed, 0)
    const events = captureCall.output().trim().split("\n").map(JSON.parse)
    const result = await consumeCaptureEvents(
      events,
      archive,
      preflight,
      1024 * 1024
    )
    assert.equal(result.files.length, 3)
    assert.equal(
      await readFile(join(archive, "appendonly.aof.manifest"), "utf8"),
      manifest
    )
    assert.equal(
      await readFile(join(archive, "appendonly.aof.1.incr.aof"), "utf8"),
      "synthetic-incr"
    )
    assert.equal(JSON.parse(await readFile(f.stateFile, "utf8")).rewrite, "100")
    const postcheckCall = await invoke(f, {
      mode: "postcheck",
      runIdSha256: preflight.runIdSha256,
      priorRewritePercentage: "100",
    })
    assert.equal(await postcheckCall.closed, 0)
    assert.equal(JSON.parse(postcheckCall.output()).type, "postcheck")
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("remote failure after rewrite hold restores the prior setting", async () => {
  const f = await fixture()
  try {
    const preflightCall = await invoke(f, {
      mode: "preflight",
      maxBytes: 1024 * 1024,
    })
    assert.equal(await preflightCall.closed, 0)
    const preflight = validatePreflight(
      JSON.parse(preflightCall.output()),
      f.scope,
      1024 * 1024
    )
    await writeFile(
      f.stateFile,
      JSON.stringify({
        dataDir: join(f.root, "redis", "data"),
        rewrite: "100",
        failAfterHold: true,
      })
    )
    const captureCall = await invoke(f, {
      mode: "capture",
      maxBytes: 1024 * 1024,
      deadlineSeconds: 30,
      manifestSha256: preflight.manifestSha256,
      runIdSha256: preflight.runIdSha256,
      priorRewritePercentage: "100",
      files: preflight.files,
    })
    assert.equal(await captureCall.closed, 1)
    assert.equal(JSON.parse(await readFile(f.stateFile, "utf8")).rewrite, "100")
    const last = captureCall.output().trim().split("\n").at(-1)
    assert.deepEqual(JSON.parse(last), {
      type: "failed",
      rewriteRestored: true,
    })
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("manifest drift after hold fails closed and restores config", async () => {
  const f = await fixture()
  try {
    const preflightCall = await invoke(f, {
      mode: "preflight",
      maxBytes: 1024 * 1024,
    })
    assert.equal(await preflightCall.closed, 0)
    const preflight = validatePreflight(
      JSON.parse(preflightCall.output()),
      f.scope,
      1024 * 1024
    )
    await writeFile(
      f.stateFile,
      JSON.stringify({
        dataDir: join(f.root, "redis", "data"),
        rewrite: "100",
        mutateManifestOnHold: true,
        manifestPath: join(f.aofDir, "appendonly.aof.manifest"),
      })
    )
    const captureCall = await invoke(f, {
      mode: "capture",
      maxBytes: 1024 * 1024,
      deadlineSeconds: 30,
      manifestSha256: preflight.manifestSha256,
      runIdSha256: preflight.runIdSha256,
      priorRewritePercentage: "100",
      files: preflight.files,
    })
    assert.equal(await captureCall.closed, 1)
    assert.equal(JSON.parse(await readFile(f.stateFile, "utf8")).rewrite, "100")
    assert.deepEqual(
      JSON.parse(captureCall.output().trim().split("\n").at(-1)),
      {
        type: "failed",
        rewriteRestored: true,
      }
    )
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("preflight refuses a symlinked AOF member without changing Redis", async () => {
  const f = await fixture()
  try {
    const base = join(f.aofDir, "appendonly.aof.1.base.rdb")
    await unlink(base)
    await symlink(join(f.aofDir, "appendonly.aof.1.incr.aof"), base)
    const call = await invoke(f, { mode: "preflight", maxBytes: 1024 * 1024 })
    assert.notEqual(await call.closed, 0)
    assert.equal(call.output(), "")
    assert.equal(JSON.parse(await readFile(f.stateFile, "utf8")).rewrite, "100")
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("remote source instance change aborts before rewrite hold", async () => {
  const f = await fixture()
  try {
    f.environment.RAILWAY_REPLICA_ID = "88888888-8888-4888-8888-888888888888"
    const call = await invoke(f, { mode: "preflight", maxBytes: 1024 * 1024 })
    assert.notEqual(await call.closed, 0)
    assert.equal(call.output(), "")
    assert.equal(JSON.parse(await readFile(f.stateFile, "utf8")).rewrite, "100")
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("capture keeps a fixed INCR prefix while ordinary appends continue", async () => {
  const f = await fixture()
  try {
    const incr = join(f.aofDir, "appendonly.aof.1.incr.aof")
    const original = Buffer.alloc(512 * 1024, 65)
    await writeFile(incr, original)
    const preflightCall = await invoke(f, {
      mode: "preflight",
      maxBytes: 2 * 1024 * 1024,
    })
    assert.equal(await preflightCall.closed, 0)
    const preflight = validatePreflight(
      JSON.parse(preflightCall.output()),
      f.scope,
      2 * 1024 * 1024
    )
    let appended = false
    const captureCall = await invoke(
      f,
      {
        mode: "capture",
        maxBytes: 2 * 1024 * 1024,
        deadlineSeconds: 30,
        manifestSha256: preflight.manifestSha256,
        runIdSha256: preflight.runIdSha256,
        priorRewritePercentage: "100",
        files: preflight.files,
      },
      {
        onLine: async (event) => {
          if (event.type === "fileStart" && event.name.endsWith(".incr.aof")) {
            await appendFile(incr, Buffer.alloc(1024, 66))
            appended = true
          }
        },
      }
    )
    assert.equal(await captureCall.closed, 0)
    assert.equal(appended, true)
    const archive = join(f.root, "grown-archive")
    await mkdir(archive, { mode: 0o700 })
    const events = captureCall.output().trim().split("\n").map(JSON.parse)
    await consumeCaptureEvents(events, archive, preflight, 2 * 1024 * 1024)
    assert.deepEqual(
      await readFile(join(archive, "appendonly.aof.1.incr.aof")),
      original
    )
    assert.equal((await readFile(incr)).length, original.length + 1024)
    assert.equal(JSON.parse(await readFile(f.stateFile, "utf8")).rewrite, "100")
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("capture rejects an in-place change to an already copied INCR prefix", async () => {
  const f = await fixture()
  try {
    const incr = join(f.aofDir, "appendonly.aof.1.incr.aof")
    await writeFile(incr, Buffer.alloc(512 * 1024, 65))
    const preflightCall = await invoke(f, {
      mode: "preflight",
      maxBytes: 2 * 1024 * 1024,
    })
    assert.equal(await preflightCall.closed, 0)
    const preflight = validatePreflight(
      JSON.parse(preflightCall.output()),
      f.scope,
      2 * 1024 * 1024
    )
    let changed = false
    const captureCall = await invoke(
      f,
      {
        mode: "capture",
        maxBytes: 2 * 1024 * 1024,
        deadlineSeconds: 30,
        manifestSha256: preflight.manifestSha256,
        runIdSha256: preflight.runIdSha256,
        priorRewritePercentage: "100",
        files: preflight.files,
      },
      {
        onLine: async (event) => {
          if (
            !changed &&
            event.type === "chunk" &&
            event.name.endsWith(".incr.aof")
          ) {
            const handle = await open(incr, "r+")
            try {
              await handle.write(Buffer.from("Z"), 0, 1, 0)
            } finally {
              await handle.close()
            }
            changed = true
          }
        },
      }
    )
    assert.equal(await captureCall.closed, 1)
    assert.equal(changed, true)
    assert.equal(JSON.parse(await readFile(f.stateFile, "utf8")).rewrite, "100")
    assert.deepEqual(
      JSON.parse(captureCall.output().trim().split("\n").at(-1)),
      {
        type: "failed",
        rewriteRestored: true,
      }
    )
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test("detached watchdog restores config after parent SIGKILL", async () => {
  const f = await fixture()
  try {
    const preflightCall = await invoke(f, {
      mode: "preflight",
      maxBytes: 1024 * 1024,
    })
    assert.equal(await preflightCall.closed, 0)
    const preflight = validatePreflight(
      JSON.parse(preflightCall.output()),
      f.scope,
      1024 * 1024
    )
    await writeFile(
      join(f.aofDir, "appendonly.aof.1.incr.aof"),
      Buffer.alloc(4 * 1024 * 1024, 42)
    )
    const captureCall = await invoke(
      f,
      {
        mode: "capture",
        maxBytes: 8 * 1024 * 1024,
        deadlineSeconds: 30,
        manifestSha256: preflight.manifestSha256,
        runIdSha256: preflight.runIdSha256,
        priorRewritePercentage: "100",
        files: preflight.files,
      },
      { pauseOutput: true }
    )
    let held = false
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (JSON.parse(await readFile(f.stateFile, "utf8")).rewrite === "0") {
        held = true
        break
      }
      await delay(20)
    }
    assert.equal(held, true)
    captureCall.child.kill("SIGKILL")
    await captureCall.closed
    let restored = false
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (JSON.parse(await readFile(f.stateFile, "utf8")).rewrite === "100") {
        restored = true
        break
      }
      await delay(20)
    }
    assert.equal(restored, true)
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})
