import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { mkdir, readFile, readdir, rm, stat, symlink } from "node:fs/promises"
import { join } from "node:path"
import test from "node:test"
import {
  acknowledgeDisposableAofCreation,
  cleanupDisposableContainers,
  createDisposableAofDirectory,
  createDisposableContainerOwner,
  disposableAofCreateArguments,
  disposableContainerEnvironment,
  preregisterDisposableAofContainer,
} from "./lib/disposable-container-ownership.mjs"
import { runDisposableIntegration } from "./run-disposable-integration.mjs"

const imageId = `sha256:${"a".repeat(64)}`
const id = "b".repeat(64)
const directories = new Set()
test.afterEach(async () => {
  // These tests use a fake daemon; every directory is exclusively test-owned.
  await Promise.all(
    [...directories].map((path) => rm(path, { recursive: true, force: true }))
  )
  directories.clear()
})
const fixture = async () => {
  const owner = await createDisposableContainerOwner(imageId)
  directories.add(owner.directory)
  const environment = {
    INTEGRATION_TESTS_ENABLED: "1",
    ...disposableContainerEnvironment(owner),
  }
  const root = await createDisposableAofDirectory(environment)
  const data = join(root, "data")
  const socketDirectory = join(root, "socket")
  await mkdir(data, { mode: 0o700 })
  await mkdir(socketDirectory, { mode: 0o700 })
  const claim = await preregisterDisposableAofContainer({
    environment,
    imageId,
    data,
    socketDirectory,
    uid: process.getuid(),
    gid: process.getgid(),
  })
  return { owner, environment, claim }
}
// Independent Docker inspect fixture for the Unix-socket Redis contract.
const inspection = ({ intent }) => ({
  Id: id,
  Name: `/${intent.name}`,
  Image: imageId,
  Config: {
    Labels: {
      "com.remorseless.integration.owner": intent.runId,
      "com.remorseless.integration.intent": intent.id,
    },
    User: `${process.getuid()}:${process.getgid()}`,
    Entrypoint: ["redis-server"],
    Cmd: [
      "--port",
      "0",
      "--unixsocket",
      "/socket/redis.sock",
      "--unixsocketperm",
      "700",
      "--dir",
      "/data",
      "--appendonly",
      "yes",
      "--appendfilename",
      "appendonly.aof",
      "--appenddirname",
      "appendonlydir",
      "--appendfsync",
      "always",
      "--auto-aof-rewrite-percentage",
      "0",
      "--aof-use-rdb-preamble",
      "yes",
      "--aof-load-truncated",
      "no",
      "--save",
      "",
      "--maxmemory",
      "128mb",
      "--maxmemory-policy",
      "noeviction",
    ],
  },
  HostConfig: {
    NetworkMode: "none",
    ReadonlyRootfs: true,
    Privileged: false,
    CapDrop: ["ALL"],
    SecurityOpt: ["no-new-privileges"],
    NanoCpus: 1_000_000_000,
    Memory: 268_435_456,
    MemorySwap: 268_435_456,
    PidsLimit: 64,
    PortBindings: {},
  },
  Mounts: [
    { Type: "bind", Source: intent.data, Destination: "/data", RW: true },
    {
      Type: "bind",
      Source: intent.socketDirectory,
      Destination: "/socket",
      RW: true,
    },
  ],
})
const daemon = (record) => {
  const calls = []
  let present = Boolean(record)
  const commandRunner = async (command, args) => {
    assert.equal(command, "docker")
    calls.push(args)
    if (args[0] === "ps") {
      assert.deepEqual(args.slice(0, 5), [
        "ps",
        "--all",
        "--quiet",
        "--no-trunc",
        "--filter",
      ])
      assert.match(args[5], /^name=\^\/rr-aof-[a-f0-9-]+\$$/u)
      return present ? record.Id : ""
    }
    if (args[0] === "inspect") return JSON.stringify(record)
    assert.deepEqual(args, ["rm", "--force", record.Id])
    present = false
    return record.Id
  }
  return { commandRunner, calls }
}

test("durably claims a stopped isolated Redis creation before calling the daemon", async () => {
  const { owner, claim } = await fixture()
  const path = join(owner.directory, `intent-${claim.intent.id}.json`)
  assert.deepEqual(JSON.parse(await readFile(path)), claim.intent)
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  const args = disposableAofCreateArguments(claim)
  assert.equal(args[0], "create")
  assert(!args.includes("--detach"))
  assert.equal(args[args.indexOf("--name") + 1], claim.intent.name)
  assert.equal(args[args.indexOf("--network") + 1], "none")
})
test("cleans a committed creation whose stdout acknowledgement was lost", async () => {
  const { owner, claim } = await fixture()
  const fake = daemon(inspection(claim))
  const result = await cleanupDisposableContainers(owner, {
    ...fake,
    environment: {},
  })
  assert.equal(result.records[0].pendingCreationRecovered, true)
  assert.deepEqual(
    fake.calls.map((args) => args[0]),
    ["ps", "inspect", "rm", "ps"]
  )
  await assert.rejects(stat(owner.directory), { code: "ENOENT" })
})
test("retains an absent pending intent rather than assuming a late daemon commit is impossible", async () => {
  const { owner } = await fixture()
  const fake = daemon(null)
  await assert.rejects(
    cleanupDisposableContainers(owner, { ...fake, environment: {} }),
    /creation is unresolved; ownership retained/u
  )
  assert.equal(fake.calls.length, 1)
  assert(
    (await readdir(owner.directory)).some((name) => name.startsWith("intent-"))
  )
  assert((await stat(join(owner.directory, "fixtures"))).isDirectory())
})
test("cleans an acknowledged creation already removed by the child", async () => {
  const { owner, claim } = await fixture()
  await acknowledgeDisposableAofCreation(claim, inspection(claim))
  const result = await cleanupDisposableContainers(owner, {
    ...daemon(null),
    environment: {},
  })
  assert.equal(result.records[0].observedAbsent, true)
  assert.equal(result.records[0].createdId, id)
})
test("checks the acknowledged immutable ID before removing an observed container", async () => {
  const { owner, claim } = await fixture()
  await acknowledgeDisposableAofCreation(claim, inspection(claim))
  const record = inspection(claim)
  record.Id = "c".repeat(64)
  const fake = daemon(record)
  await assert.rejects(
    cleanupDisposableContainers(owner, { ...fake, environment: {} })
  )
  assert.equal(
    fake.calls.some((args) => args[0] === "rm"),
    false
  )
})
test("retries cleanup after a removal reply is lost using the durable recovered ID", async () => {
  const { owner, claim } = await fixture()
  const fake = daemon(inspection(claim))
  const interrupted = async (command, args, options) => {
    const result = await fake.commandRunner(command, args, options)
    if (args[0] === "rm") throw new Error("Removal reply interrupted")
    return result
  }
  await assert.rejects(
    cleanupDisposableContainers(owner, {
      commandRunner: interrupted,
      environment: {},
    }),
    /Removal reply interrupted/u
  )
  const acknowledgement = JSON.parse(
    await readFile(join(owner.directory, `created-${claim.intent.id}.json`))
  )
  assert.equal(acknowledgement.containerId, id)
  const result = await cleanupDisposableContainers(owner, {
    ...fake,
    environment: {},
  })
  assert.equal(result.records[0].observedAbsent, true)
})
for (const [name, change] of [
  [
    "name",
    (r) => {
      r.Name = "/unrelated"
    },
  ],
  [
    "image",
    (r) => {
      r.Image = `sha256:${"c".repeat(64)}`
    },
  ],
  [
    "owner label",
    (r) => {
      r.Config.Labels["com.remorseless.integration.owner"] = "another-run"
    },
  ],
  [
    "intent label",
    (r) => {
      r.Config.Labels["com.remorseless.integration.intent"] = "another-intent"
    },
  ],
  [
    "user",
    (r) => {
      r.Config.User = "another-user"
    },
  ],
  [
    "entrypoint",
    (r) => {
      r.Config.Entrypoint = ["sh"]
    },
  ],
  [
    "command",
    (r) => {
      r.Config.Cmd = ["--port", "6379"]
    },
  ],
  [
    "network",
    (r) => {
      r.HostConfig.NetworkMode = "bridge"
    },
  ],
  [
    "writable root",
    (r) => {
      r.HostConfig.ReadonlyRootfs = false
    },
  ],
  [
    "privileged",
    (r) => {
      r.HostConfig.Privileged = true
    },
  ],
  [
    "capabilities",
    (r) => {
      r.HostConfig.CapDrop = []
    },
  ],
  [
    "security options",
    (r) => {
      r.HostConfig.SecurityOpt = []
    },
  ],
  [
    "CPU",
    (r) => {
      r.HostConfig.NanoCpus = 0
    },
  ],
  [
    "memory",
    (r) => {
      r.HostConfig.Memory = 0
    },
  ],
  [
    "swap",
    (r) => {
      r.HostConfig.MemorySwap = -1
    },
  ],
  [
    "PIDs",
    (r) => {
      r.HostConfig.PidsLimit = 0
    },
  ],
  [
    "published ports",
    (r) => {
      r.HostConfig.PortBindings = { "6379/tcp": [] }
    },
  ],
  [
    "mount source",
    (r) => {
      r.Mounts[0].Source = "/unrelated"
    },
  ],
  [
    "mount type",
    (r) => {
      r.Mounts[0].Type = "volume"
    },
  ],
  [
    "mount mode",
    (r) => {
      r.Mounts[0].RW = false
    },
  ],
  [
    "extra mount",
    (r) => {
      r.Mounts.push({
        Type: "bind",
        Source: "/",
        Destination: "/other",
        RW: true,
      })
    },
  ],
]) {
  test(`refuses a ${name} collision without removing the container`, async () => {
    const { owner, claim } = await fixture()
    const record = inspection(claim)
    change(record)
    const fake = daemon(record)
    await assert.rejects(
      cleanupDisposableContainers(owner, { ...fake, environment: {} })
    )
    assert.equal(
      fake.calls.some((args) => args[0] === "rm"),
      false
    )
    assert((await stat(owner.directory)).isDirectory())
  })
}
test("rejects symlinked intent input before inspecting or deleting a container", async () => {
  const { owner, claim } = await fixture()
  const path = join(owner.directory, `intent-${claim.intent.id}.json`)
  await rm(path)
  await symlink(join(owner.directory, "owner.json"), path)
  const fake = daemon(inspection(claim))
  await assert.rejects(
    cleanupDisposableContainers(owner, { ...fake, environment: {} }),
    { code: "ELOOP" }
  )
  assert.equal(fake.calls.length, 0)
})
test("requires the parent journal before allocating child AOF data", async () => {
  await assert.rejects(
    createDisposableAofDirectory({ INTEGRATION_TESTS_ENABLED: "1" }),
    /parent disposable runner/u
  )
})
test("parent cancellation still fails closed on an unresolved creation and cleans Compose", async () => {
  const signals = new EventEmitter()
  let owned
  const calls = []
  const commandRunner = async (command, args, options) => {
    calls.push({ command, args })
    if (command === "pnpm") {
      const environment = options.environment
      const directory = environment.RR_DISPOSABLE_CONTAINER_DIRECTORY
      directories.add(directory)
      owned = directory
      const root = await createDisposableAofDirectory(environment)
      const data = join(root, "data"),
        socketDirectory = join(root, "socket")
      await mkdir(data, { mode: 0o700 })
      await mkdir(socketDirectory, { mode: 0o700 })
      await preregisterDisposableAofContainer({
        environment,
        imageId,
        data,
        socketDirectory,
        uid: process.getuid(),
        gid: process.getgid(),
      })
      signals.emit("SIGTERM")
      throw new Error("Creation reply interrupted")
    }
    if (args[0] === "image") return imageId
    if (args[0] === "compose" && args.includes("--quiet"))
      return args.at(-1) === "postgres" ? id : "c".repeat(64)
    if (args[0] === "inspect" && args.includes("{{.Image}}")) return imageId
    if (
      args[0] === "inspect" &&
      args.includes("{{json .NetworkSettings.Ports}}")
    )
      return JSON.stringify(
        args.at(-1) === id
          ? { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55432" }] }
          : { "6379/tcp": [{ HostIp: "127.0.0.1", HostPort: "56379" }] }
      )
    return ""
  }
  await assert.rejects(
    runDisposableIntegration({
      args: ["--no-build"],
      environment: {
        RR_INTEGRATION_POSTGRES_IMAGE_ID: imageId,
        RR_INTEGRATION_REDIS_IMAGE_ID: imageId,
      },
      commandRunner,
      signals,
    }),
    /creation is unresolved; ownership retained/u
  )
  assert((await stat(owned)).isDirectory())
  assert.equal(calls.filter((call) => call.args.includes("down")).length, 1)
  assert.equal(signals.listenerCount("SIGTERM"), 0)
})
