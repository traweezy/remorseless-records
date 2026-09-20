import assert from "node:assert/strict"
import { createServer } from "node:net"
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

import {
  containerPlans,
  parseArguments,
  runBounded,
  runSmoke,
  validateHealth,
} from "./backend-isolated-startup-smoke.mjs"
import { backendChildEnvironment } from "./lib/backend-isolated-bootstrap.mjs"

const revision = "e7a37c2180f890e0562495a5897b3cef7decc5c2"
const backendImageId = `sha256:${"b".repeat(64)}`
const redisImageId =
  "sha256:99267d3e232c751add077e98c4fc1b9e508d4241740b52229e44986f7173f71b"
const daemonId = "3d86f01e-1b3f-4fe4-986e-c0c2d47f54e9"
const targetDir = `/tmp/pg16-target-${"a".repeat(32)}`
const targetState = {
  phase: "restored",
  root: targetDir,
  targetSystemId: "12345678901234567890",
  sourceSystemId: "12345678901234567891",
  daemonId,
}

const optionIndex = (args, flag) => args.indexOf(flag) + 1

test("smoke child retains the exact runtime loader path without provider secrets", async () => {
  const dockerfile = await readFile(
    new URL("../backend/Dockerfile.runtime", import.meta.url),
    "utf8"
  )
  const imageLoaderPath = /^\s+LD_LIBRARY_PATH=(\S+)/mu.exec(dockerfile)?.[1]
  assert.equal(imageLoaderPath, "/usr/local/lib")
  const environment = backendChildEnvironment("synthetic", revision)
  assert.equal(environment.LD_LIBRARY_PATH, imageLoaderPath)
  assert.equal(environment.COMMIT_SHA, revision)
  assert.equal(Object.hasOwn(environment, "STRIPE_API_KEY"), false)
})

const fakeDocker = ({
  badRevision = false,
  failHealth = false,
  failCleanup = false,
  badNetwork = false,
  badBackendUser = false,
  badImageUser = false,
} = {}) => {
  const containers = new Map()
  const calls = []
  let healthCalls = 0
  const docker = async (args) => {
    calls.push(args)
    const [command, subcommand] = args
    if (command === "context") return "unix:///var/run/docker.sock"
    if (command === "info") return daemonId
    if (command === "image") {
      const id = args[2]
      return JSON.stringify([
        {
          Id: id,
          Config: {
            Labels:
              id === backendImageId
                ? {
                    "org.opencontainers.image.revision": badRevision
                      ? "0".repeat(40)
                      : revision,
                  }
                : {},
            Env: id === backendImageId ? [`COMMIT_SHA=${revision}`] : [],
            User:
              id === backendImageId
                ? badImageUser
                  ? "node"
                  : "1000:1000"
                : "",
          },
        },
      ])
    }
    if (command === "run") {
      const name = args[optionIndex(args, "--name")]
      const id = (
        name.endsWith("anchor") ? "1" : name.endsWith("redis") ? "2" : "3"
      ).repeat(64)
      containers.set(name, { args, id })
      return id
    }
    if (command === "container" && subcommand === "ls")
      return [...containers.keys()].join("\n")
    if (command === "container" && subcommand === "inspect") {
      if (args.includes("--format")) return "true"
      const { args: planned, id } = containers.get(args[2])
      const mounts = []
      for (let index = 0; index < planned.length; index += 1) {
        if (planned[index] !== "--mount") continue
        const values = Object.fromEntries(
          planned[index + 1]
            .split(",")
            .filter((part) => part.includes("="))
            .map((part) => part.split("="))
        )
        mounts.push({
          Type: "bind",
          Source: values.source,
          Destination: values.target,
          RW: false,
        })
      }
      return JSON.stringify([
        {
          Id: id,
          Image: planned.includes(redisImageId) ? redisImageId : backendImageId,
          Config: {
            Labels: {
              "com.remorseless.recovery.backend-smoke":
                planned[optionIndex(planned, "--label")].split("=")[1],
            },
            User:
              badBackendUser && args[2].endsWith("backend")
                ? "999:999"
                : planned[optionIndex(planned, "--user")],
          },
          HostConfig: {
            NetworkMode:
              badNetwork && args[2].endsWith("backend")
                ? "bridge"
                : planned[optionIndex(planned, "--network")] === "none"
                  ? "none"
                  : `container:${containers.get(planned[optionIndex(planned, "--network")].slice("container:".length)).id}`,
            ReadonlyRootfs: true,
            Privileged: false,
            CapDrop: ["ALL"],
            SecurityOpt: ["no-new-privileges"],
            PortBindings: {},
          },
          State: { Running: true },
          Mounts: mounts,
        },
      ])
    }
    if (command === "exec" && args.includes("redis-cli")) return "PONG"
    if (command === "exec" && args.includes("node")) {
      healthCalls += 1
      if (failHealth) throw new Error("Synthetic probe failed.")
      return JSON.stringify({
        live: { code: 200, body: { status: "ok", version: revision } },
        ready: {
          code: 200,
          body: {
            status: "ok",
            version: revision,
            checks: [
              { name: "database", status: "ok" },
              { name: "redis", status: "ok" },
            ],
          },
        },
      })
    }
    if (command === "rm") {
      if (failCleanup) throw new Error("Synthetic cleanup failed.")
      containers.delete(args[2])
      return args[2]
    }
    throw new Error("Unexpected fake Docker call.")
  }
  return {
    docker,
    calls,
    containers,
    get healthCalls() {
      return healthCalls
    },
  }
}

const dependencies = (fake, overrides = {}) => ({
  docker: fake.docker,
  verifyTarget: async () => ({
    status: "isolated_restored_target_verified",
    targetDir,
    containerId: "4".repeat(64),
    targetSystemId: targetState.targetSystemId,
  }),
  readState: async () => targetState,
  assertLocalSocket: async () => undefined,
  pause: async () => undefined,
  ...overrides,
})

test("argument and health contracts reject wrong target or degraded dependencies", () => {
  assert.deepEqual(parseArguments(["--help"]), { help: true })
  assert.throws(() =>
    parseArguments([
      "--target-dir",
      "relative",
      "--backend-image",
      backendImageId,
      "--revision",
      revision,
    ])
  )
  assert.throws(() =>
    validateHealth(
      JSON.stringify({
        live: { code: 200, body: { status: "ok", version: revision } },
        ready: {
          code: 200,
          body: {
            status: "ok",
            version: revision,
            checks: [{ name: "database", status: "ok" }],
          },
        },
      }),
      revision
    )
  )
})

test("plans isolate all containers and keep target credentials off Docker argv", () => {
  const names = { anchor: "anchor", redis: "redis", backend: "backend" }
  const plans = containerPlans({
    targetDir,
    backendImageId,
    revision,
    owner: "a".repeat(32),
    names,
  })
  assert.equal(plans.anchor[optionIndex(plans.anchor, "--network")], "none")
  assert.equal(
    plans.redis[optionIndex(plans.redis, "--network")],
    "container:anchor"
  )
  assert.equal(
    plans.backend[optionIndex(plans.backend, "--network")],
    "container:anchor"
  )
  for (const plan of Object.values(plans)) {
    assert.equal(plan.includes("-p"), false)
    assert.equal(plan.includes("--publish"), false)
    assert.ok(plan.includes("--read-only"))
    assert.equal(
      plan.some((part) => part.includes("postgresql://")),
      false
    )
  }
  assert.equal(plans.anchor[optionIndex(plans.anchor, "--user")], "1000:1000")
  assert.equal(plans.backend[optionIndex(plans.backend, "--user")], "1000:1000")
  assert.equal(plans.redis[optionIndex(plans.redis, "--user")], "999:999")
  assert.ok(plans.backend.includes(`COMMIT_SHA=${revision}`))
  assert.equal(
    plans.backend.filter((part) => part.includes("readonly")).length,
    3
  )
})

test("smoke verifies source-bound target, local image identity, readiness and cleanup", async () => {
  const fake = fakeDocker()
  const result = await runSmoke(
    { targetDir, backendImageId, revision },
    dependencies(fake)
  )
  assert.equal(result.status, "backend_isolated_startup_verified")
  assert.deepEqual(result.checks, ["database", "redis"])
  assert.equal(fake.containers.size, 0)
  assert.equal(fake.healthCalls, 1)
  assert.equal(fake.calls.filter(([command]) => command === "rm").length, 3)
})

test("wrong image revision fails before any container is created", async () => {
  const fake = fakeDocker({ badRevision: true })
  await assert.rejects(
    runSmoke({ targetDir, backendImageId, revision }, dependencies(fake))
  )
  assert.equal(
    fake.calls.some(([command]) => command === "run"),
    false
  )
})

test("named-user Backend image fails before any container is created", async () => {
  const fake = fakeDocker({ badImageUser: true })
  await assert.rejects(
    runSmoke({ targetDir, backendImageId, revision }, dependencies(fake))
  )
  assert.equal(
    fake.calls.some(([command]) => command === "run"),
    false
  )
})

test("cancellation after failed probe removes all owned containers", async () => {
  const fake = fakeDocker({ failHealth: true })
  const controller = new AbortController()
  await assert.rejects(
    runSmoke(
      { targetDir, backendImageId, revision },
      dependencies(fake, {
        signal: controller.signal,
        pause: async () => controller.abort(),
      })
    )
  )
  assert.equal(fake.containers.size, 0)
  assert.equal(fake.calls.filter(([command]) => command === "rm").length, 3)
})

test("an unexpected network mode fails closed and cleans started containers", async () => {
  const fake = fakeDocker({ badNetwork: true })
  await assert.rejects(
    runSmoke({ targetDir, backendImageId, revision }, dependencies(fake))
  )
  assert.equal(fake.containers.size, 0)
})

test("an unexpected Backend user fails closed and cleans started containers", async () => {
  const fake = fakeDocker({ badBackendUser: true })
  await assert.rejects(
    runSmoke({ targetDir, backendImageId, revision }, dependencies(fake))
  )
  assert.equal(fake.containers.size, 0)
})

test("cleanup failure prevents a verified-success result", async () => {
  const fake = fakeDocker({ failCleanup: true })
  await assert.rejects(
    runSmoke({ targetDir, backendImageId, revision }, dependencies(fake)),
    /Owned container cleanup failed/
  )
  assert.equal(fake.containers.size, 3)
})

test("local Docker fixture relays only loopback traffic from a network-none namespace", {
  skip: process.env.RR_DOCKER_FIXTURE !== "1",
  timeout: 45_000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "rr-smoke-fixture-"))
  const socket = join(directory, "echo.sock")
  const image = "sha256:4250943b225f"
  const name = `rr-smoke-fixture-${process.pid}`
  const redisName = `${name}-redis`
  const server = createServer((client) => client.pipe(client))
  await chmod(directory, 0o755)
  await new Promise((done) => server.listen(socket, done))
  await chmod(socket, 0o777)
  try {
    await runBounded("docker", [
      "--context",
      "default",
      "run",
      "-d",
      "--name",
      name,
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--user",
      "1000:1000",
      "--mount",
      `type=bind,source=${directory},target=/run/recovery-pg,readonly`,
      "--mount",
      `type=bind,source=${fileURLToPath(new URL("./lib/backend-isolated-bootstrap.mjs", import.meta.url))},target=/run/smoke-bootstrap.mjs,readonly`,
      "--entrypoint",
      "node",
      image,
      "/run/smoke-bootstrap.mjs",
      "--relay-fixture",
      "/run/recovery-pg/echo.sock",
    ])
    const deadline = Date.now() + 10_000
    while (true) {
      try {
        const response = await runBounded("docker", [
          "--context",
          "default",
          "exec",
          name,
          "node",
          "-e",
          "const n=require('node:net');const s=n.connect(15432,'127.0.0.1');s.on('connect',()=>s.write('relay-ok'));s.on('data',b=>{process.stdout.write(b);s.end()})",
        ])
        assert.equal(response, "relay-ok")
        break
      } catch {
        if (Date.now() >= deadline)
          throw new Error("Relay fixture did not start.")
        await new Promise((done) => setTimeout(done, 200))
      }
    }
    const egress = await runBounded("docker", [
      "--context",
      "default",
      "exec",
      name,
      "node",
      "-e",
      "fetch('https://1.1.1.1',{signal:AbortSignal.timeout(1500)}).then(()=>process.exit(1),()=>process.stdout.write('blocked'))",
    ])
    assert.equal(egress, "blocked")
    await runBounded("docker", [
      "--context",
      "default",
      "run",
      "-d",
      "--name",
      redisName,
      "--network",
      `container:${name}`,
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--user",
      "999:999",
      "--tmpfs",
      "/tmp:rw,nosuid,noexec,size=16m",
      "--entrypoint",
      "redis-server",
      redisImageId,
      "--bind",
      "127.0.0.1",
      "--port",
      "6379",
      "--save",
      "",
      "--appendonly",
      "no",
      "--protected-mode",
      "yes",
    ])
    const redisDeadline = Date.now() + 10_000
    while (true) {
      try {
        assert.equal(
          await runBounded("docker", [
            "--context",
            "default",
            "exec",
            redisName,
            "redis-cli",
            "-h",
            "127.0.0.1",
            "ping",
          ]),
          "PONG"
        )
        break
      } catch {
        if (Date.now() >= redisDeadline)
          throw new Error("Redis fixture did not start.")
        await new Promise((done) => setTimeout(done, 200))
      }
    }
    const inspect = JSON.parse(
      await runBounded("docker", [
        "--context",
        "default",
        "container",
        "inspect",
        name,
      ])
    )[0]
    assert.equal(inspect.HostConfig.NetworkMode, "none")
    assert.equal(inspect.Config.User, "1000:1000")
    assert.deepEqual(inspect.HostConfig.PortBindings, {})
    const redisInspect = JSON.parse(
      await runBounded("docker", [
        "--context",
        "default",
        "container",
        "inspect",
        redisName,
      ])
    )[0]
    assert.equal(redisInspect.HostConfig.NetworkMode, `container:${inspect.Id}`)
    assert.equal(redisInspect.Config.User, "999:999")
    assert.deepEqual(redisInspect.HostConfig.PortBindings, {})
  } finally {
    await runBounded("docker", [
      "--context",
      "default",
      "rm",
      "--force",
      redisName,
    ]).catch(() => undefined)
    await runBounded("docker", [
      "--context",
      "default",
      "rm",
      "--force",
      name,
    ]).catch(() => undefined)
    await new Promise((done) => server.close(done))
    await rm(directory, { recursive: true, force: true })
  }
})
