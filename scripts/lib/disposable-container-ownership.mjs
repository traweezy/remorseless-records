import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, isAbsolute, join, resolve } from "node:path"

const OWNER = "com.remorseless.integration.owner"
const INTENT = "com.remorseless.integration.intent"
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u
const image = /^sha256:[a-f0-9]{64}$/u
const containerId = /^[a-f0-9]{64}$/u
const redisArguments = [
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
]
const durableJson = async (path, value) => {
  const file = await open(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600
  )
  try {
    await file.writeFile(JSON.stringify(value) + "\n")
    await file.sync()
  } finally {
    await file.close()
  }
  const directory = await open(
    resolve(path, ".."),
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  )
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}
const privateDirectory = async (path) => {
  assert(isAbsolute(path) && resolve(path) === path)
  const stat = await lstat(path)
  assert(stat.isDirectory() && !stat.isSymbolicLink())
  assert.equal(stat.uid, process.getuid())
  assert.equal(stat.mode & 0o777, 0o700)
  assert.equal(await realpath(path), path)
  return { dev: stat.dev, ino: stat.ino }
}
const privateJson = async (path) => {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await file.stat()
    assert(stat.isFile() && stat.size > 0 && stat.size <= 16_384)
    assert.equal(stat.uid, process.getuid())
    assert.equal(stat.mode & 0o777, 0o600)
    const bytes = await file.readFile()
    assert.equal(bytes.length, stat.size)
    return JSON.parse(bytes.toString("utf8"))
  } finally {
    await file.close()
  }
}
const readOwner = async ({ directory, runId }) => {
  assert(basename(directory).startsWith("rr-disposable-containers-"))
  assert(uuid.test(runId))
  const identity = await privateDirectory(directory)
  const metadata = await privateJson(join(directory, "owner.json"))
  assert.deepEqual(
    Object.keys(metadata).sort(),
    ["directory", "imageId", "kind", "runId", "schemaVersion"].sort()
  )
  assert.equal(metadata.kind, "disposable-container-ownership")
  assert.equal(metadata.schemaVersion, 1)
  assert.equal(metadata.directory, directory)
  assert.equal(metadata.runId, runId)
  assert(image.test(metadata.imageId))
  await privateDirectory(join(directory, "fixtures"))
  return { ...metadata, identity }
}
const ownerFromEnvironment = async (environment) => {
  const directory = environment.RR_DISPOSABLE_CONTAINER_DIRECTORY
  const runId = environment.RR_DISPOSABLE_CONTAINER_RUN_ID
  assert.equal(environment.INTEGRATION_TESTS_ENABLED, "1")
  assert.equal(
    typeof directory,
    "string",
    "The parent disposable runner must own AOF containers"
  )
  assert.equal(typeof runId, "string")
  return readOwner({ directory, runId })
}

export const createDisposableContainerOwner = async (imageId) => {
  assert(image.test(imageId))
  const directory = await mkdtemp(join(tmpdir(), "rr-disposable-containers-"))
  await mkdir(join(directory, "fixtures"), { mode: 0o700 })
  const metadata = {
    schemaVersion: 1,
    kind: "disposable-container-ownership",
    directory,
    runId: randomUUID(),
    imageId,
  }
  await durableJson(join(directory, "owner.json"), metadata)
  return readOwner(metadata)
}
export const disposableContainerEnvironment = (owner) => ({
  RR_DISPOSABLE_CONTAINER_DIRECTORY: owner.directory,
  RR_DISPOSABLE_CONTAINER_RUN_ID: owner.runId,
})
export const createDisposableAofDirectory = async (
  environment = process.env
) => {
  const owner = await ownerFromEnvironment(environment)
  return mkdtemp(join(owner.directory, "fixtures", "aof-"))
}
const validateIntent = async (owner, intent) => {
  assert.deepEqual(
    Object.keys(intent).sort(),
    [
      "schemaVersion",
      "id",
      "name",
      "runId",
      "imageId",
      "data",
      "socketDirectory",
      "uid",
      "gid",
    ].sort()
  )
  assert.equal(intent.schemaVersion, 1)
  assert(uuid.test(intent.id))
  assert.equal(intent.name, `rr-aof-${intent.id}`)
  assert.equal(intent.runId, owner.runId)
  assert.equal(intent.imageId, owner.imageId)
  assert.equal(intent.uid, process.getuid())
  assert.equal(intent.gid, process.getgid())
  for (const path of [intent.data, intent.socketDirectory]) {
    assert(path.startsWith(join(owner.directory, "fixtures") + "/"))
    await privateDirectory(path)
  }
  assert.notEqual(intent.data, intent.socketDirectory)
  assert(
    Buffer.byteLength(join(intent.socketDirectory, "redis.sock")) <= 107,
    "Owned Redis Unix socket path exceeds the Linux limit"
  )
}
export const preregisterDisposableAofContainer = async ({
  environment = process.env,
  imageId,
  data,
  socketDirectory,
  uid,
  gid,
}) => {
  const owner = await ownerFromEnvironment(environment)
  const id = randomUUID()
  const intent = {
    schemaVersion: 1,
    id,
    name: `rr-aof-${id}`,
    runId: owner.runId,
    imageId,
    data,
    socketDirectory,
    uid,
    gid,
  }
  await validateIntent(owner, intent)
  // This durable claim precedes the daemon call, including lost stdout replies.
  await durableJson(join(owner.directory, `intent-${id}.json`), intent)
  return { owner, intent }
}
export const disposableAofCreateArguments = ({ intent }) => [
  "create",
  "--name",
  intent.name,
  "--label",
  `${OWNER}=${intent.runId}`,
  "--label",
  `${INTENT}=${intent.id}`,
  "--pull",
  "never",
  "--network",
  "none",
  "--read-only",
  "--cap-drop",
  "ALL",
  "--security-opt",
  "no-new-privileges",
  "--cpus",
  "1",
  "--memory",
  "256m",
  "--memory-swap",
  "256m",
  "--pids-limit",
  "64",
  "--user",
  `${intent.uid}:${intent.gid}`,
  "--mount",
  `type=bind,source=${intent.data},target=/data`,
  "--mount",
  `type=bind,source=${intent.socketDirectory},target=/socket`,
  "--entrypoint",
  "redis-server",
  intent.imageId,
  ...redisArguments,
]
const verifyContainer = (intent, record) => {
  assert(containerId.test(record.Id))
  assert.equal(record.Name, `/${intent.name}`)
  assert.equal(record.Image, intent.imageId)
  assert.equal(record.Config.Labels?.[OWNER], intent.runId)
  assert.equal(record.Config.Labels?.[INTENT], intent.id)
  assert.equal(record.Config.User, `${intent.uid}:${intent.gid}`)
  assert.deepEqual(record.Config.Entrypoint, ["redis-server"])
  assert.deepEqual(record.Config.Cmd, redisArguments)
  assert.equal(record.HostConfig.NetworkMode, "none")
  assert.equal(record.HostConfig.ReadonlyRootfs, true)
  assert.equal(record.HostConfig.Privileged, false)
  assert.deepEqual(record.HostConfig.CapDrop, ["ALL"])
  assert.deepEqual(record.HostConfig.SecurityOpt, ["no-new-privileges"])
  assert.equal(record.HostConfig.NanoCpus, 1_000_000_000)
  assert.equal(record.HostConfig.Memory, 268_435_456)
  assert.equal(record.HostConfig.MemorySwap, 268_435_456)
  assert.equal(record.HostConfig.PidsLimit, 64)
  assert.deepEqual(Object.keys(record.HostConfig.PortBindings ?? {}), [])
  const mounts = record.Mounts.map(({ Type, Source, Destination, RW }) => ({
    Type,
    Source,
    Destination,
    RW,
  }))
  const expected = [
    { Type: "bind", Source: intent.data, Destination: "/data", RW: true },
    {
      Type: "bind",
      Source: intent.socketDirectory,
      Destination: "/socket",
      RW: true,
    },
  ]
  assert.deepEqual(
    mounts.sort((a, b) => a.Destination.localeCompare(b.Destination)),
    expected.sort((a, b) => a.Destination.localeCompare(b.Destination))
  )
}
export const acknowledgeDisposableAofCreation = async (claim, record) => {
  const owner = await readOwner(claim.owner)
  assert.deepEqual(owner, claim.owner)
  await validateIntent(owner, claim.intent)
  assert.deepEqual(
    await privateJson(join(owner.directory, `intent-${claim.intent.id}.json`)),
    claim.intent
  )
  verifyContainer(claim.intent, record)
  await durableJson(join(owner.directory, `created-${claim.intent.id}.json`), {
    intentId: claim.intent.id,
    containerId: record.Id,
  })
}

export const cleanupDisposableContainerClaim = async (
  { owner, intent },
  { commandRunner, environment }
) => {
  assert.deepEqual(await readOwner(owner), owner)
  await validateIntent(owner, intent)
  assert.deepEqual(
    await privateJson(join(owner.directory, `intent-${intent.id}.json`)),
    intent
  )
  let created
  try {
    created = await privateJson(
      join(owner.directory, `created-${intent.id}.json`)
    )
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  if (created) {
    assert.deepEqual(Object.keys(created).sort(), ["containerId", "intentId"])
    assert.equal(created.intentId, intent.id)
    assert(containerId.test(created.containerId))
  }
  const run = (args) =>
    commandRunner("docker", args, {
      environment,
      capture: true,
      timeoutMs: 15_000,
    })
  const find = () =>
    run([
      "ps",
      "--all",
      "--quiet",
      "--no-trunc",
      "--filter",
      `name=^/${intent.name}$`,
    ])
  const found = await find()
  if (!found) {
    // An aborted CLI can leave a daemon request in flight. A quiet interval
    // cannot prove that a pending create will never commit later.
    if (!created)
      throw new Error(
        `Disposable container creation is unresolved; ownership retained at ${owner.directory}`
      )
    return {
      intentId: intent.id,
      createdId: created.containerId,
      observedAbsent: true,
    }
  }
  assert(containerId.test(found), "Ambiguous disposable container name")
  if (created) assert.equal(found, created.containerId)
  const record = JSON.parse(
    await run(["inspect", "--format", "{{json .}}", found])
  )
  assert.equal(record.Id, found)
  verifyContainer(intent, record)
  // Persist the recovered identity before removal so partial cleanup can retry.
  if (!created)
    await acknowledgeDisposableAofCreation({ owner, intent }, record)
  await run(["rm", "--force", found])
  assert.equal(await find(), "", "Owned container removal remains unverified")
  return {
    intentId: intent.id,
    removedId: found,
    pendingCreationRecovered: !created,
  }
}

export const cleanupDisposableContainers = async (
  owner,
  { commandRunner, environment }
) => {
  const current = await readOwner(owner)
  assert.deepEqual(current, owner, "Disposable ownership directory changed")
  const files = await readdir(owner.directory)
  const intents = []
  const acknowledged = new Set()
  for (const name of files) {
    if (name === "owner.json" || name === "fixtures") continue
    const match = /^(intent|created)-([a-f0-9-]+)\.json$/u.exec(name)
    assert(match && uuid.test(match[2]), "Unexpected disposable ownership file")
    if (match[1] === "intent") intents.push(match[2])
    else acknowledged.add(match[2])
  }
  assert([...acknowledged].every((id) => intents.includes(id)))
  const records = []
  for (const id of intents.sort()) {
    const intent = await privateJson(join(owner.directory, `intent-${id}.json`))
    assert.equal(intent.id, id)
    records.push(
      await cleanupDisposableContainerClaim(
        { owner, intent },
        { commandRunner, environment }
      )
    )
  }
  assert.deepEqual(await readOwner(owner), owner)
  await rm(owner.directory, { recursive: true })
  return { ownedDirectoryRemoved: true, records }
}
