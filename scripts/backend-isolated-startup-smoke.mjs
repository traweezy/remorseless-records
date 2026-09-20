import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { lstat, readFile, realpath, stat } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const backendBootstrap = fileURLToPath(
  new URL("./lib/backend-isolated-bootstrap.mjs", import.meta.url)
)
const targetRunner = fileURLToPath(
  new URL("./postgres-isolated-target.mjs", import.meta.url)
)
const redisImageId =
  "sha256:99267d3e232c751add077e98c4fc1b9e508d4241740b52229e44986f7173f71b"
const backendUser = "1000:1000"
const redisUser = "999:999"
const smokeLabel = "com.remorseless.recovery.backend-smoke"
const imagePattern = /^sha256:[a-f0-9]{64}$/u
const revisionPattern = /^[a-f0-9]{40}$/u
const containerPattern = /^[a-f0-9]{64}$/u
const help = `Usage: backend-isolated-startup-smoke --target-dir <restored-private-target> --backend-image <sha256:id> --revision <40-hex-sha>
Requires an already restored, source-bound disposable PostgreSQL target and a
local Backend runtime image whose OCI revision and COMMIT_SHA equal --revision.
Runs server-only Medusa and disposable Redis in an unnetworked Docker namespace;
probes local /live and /ready, then removes only its own containers. The
restored target can be changed by Medusa startup defaults; keep the source
snapshot bundle immutable and use a fresh target for every smoke.
`

const safeEnvironment = () => ({
  PATH: "/usr/local/bin:/usr/bin:/bin",
  HOME: process.env.HOME ?? "/tmp",
  LANG: "C",
})

export const runBounded = async (
  command,
  args,
  { timeoutMs = 15_000, maxBytes = 131_072, signal } = {}
) =>
  new Promise((resolveOutput, reject) => {
    const commandSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs)
    const child = spawn(command, args, {
      env: safeEnvironment(),
      stdio: ["ignore", "pipe", "ignore"],
      signal: commandSignal,
      killSignal: "SIGTERM",
    })
    let output = ""
    let failed = false
    const forceKill = () =>
      setTimeout(() => child.kill("SIGKILL"), 3000).unref()
    commandSignal.addEventListener("abort", forceKill, { once: true })
    child.on("error", () => {
      failed = true
    })
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8")
      if (Buffer.byteLength(output) > maxBytes) {
        failed = true
        child.kill("SIGKILL")
      }
    })
    child.once("close", (code, signalName) => {
      if (failed || signalName || code !== 0)
        reject(new Error("Bounded subprocess failed."))
      else resolveOutput(output.trim())
    })
  })

const dockerCommand = (args, options) =>
  runBounded("docker", ["--context", "default", ...args], options)

export const parseArguments = (args) => {
  if (args.length === 1 && args[0] === "--help") return { help: true }
  assert.equal(args.length, 6)
  const values = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    assert.ok(
      ["--target-dir", "--backend-image", "--revision"].includes(key) &&
        !(key in values)
    )
    values[key] = args[index + 1]
  }
  assert.equal(Object.keys(values).length, 3)
  assert.equal(resolve(values["--target-dir"]), values["--target-dir"])
  assert.match(values["--backend-image"], imagePattern)
  assert.match(values["--revision"], revisionPattern)
  return {
    targetDir: values["--target-dir"],
    backendImageId: values["--backend-image"],
    revision: values["--revision"],
  }
}

const parseSingleObject = (raw) => {
  const parsed = JSON.parse(raw)
  assert.ok(Array.isArray(parsed) && parsed.length === 1)
  return parsed[0]
}

const assertImage = async (docker, imageId, revision) => {
  const image = parseSingleObject(await docker(["image", "inspect", imageId]))
  assert.equal(image.Id, imageId)
  if (revision) {
    assert.equal(
      image.Config?.Labels?.["org.opencontainers.image.revision"],
      revision
    )
    assert.ok(image.Config?.Env?.includes(`COMMIT_SHA=${revision}`))
    assert.equal(image.Config?.User, "node")
  }
}

const assertContainer = async (
  docker,
  { name, id, owner, imageId, networkMode, user, mounts = [] }
) => {
  const container = parseSingleObject(
    await docker(["container", "inspect", name])
  )
  assert.equal(container.Id, id)
  assert.equal(container.Image, imageId)
  assert.equal(container.Config?.Labels?.[smokeLabel], owner)
  assert.equal(container.Config?.User, user)
  assert.equal(container.HostConfig?.NetworkMode, networkMode)
  assert.equal(container.HostConfig?.ReadonlyRootfs, true)
  assert.equal(container.HostConfig?.Privileged, false)
  assert.ok(container.HostConfig?.CapDrop?.includes("ALL"))
  assert.ok(
    container.HostConfig?.SecurityOpt?.some((entry) =>
      entry.startsWith("no-new-privileges")
    )
  )
  assert.ok(
    !container.HostConfig?.PortBindings ||
      Object.keys(container.HostConfig.PortBindings).length === 0
  )
  assert.equal(container.State?.Running, true)
  for (const expected of mounts) {
    assert.ok(
      container.Mounts?.some(
        (mount) =>
          mount.Type === "bind" &&
          mount.Source === expected.source &&
          mount.Destination === expected.destination &&
          mount.RW === false
      )
    )
  }
}

const limits = [
  "--read-only",
  "--cap-drop",
  "ALL",
  "--security-opt",
  "no-new-privileges",
  "--pids-limit",
  "256",
  "--memory",
  "1024m",
  "--cpus",
  "2",
]

export const containerPlans = ({
  targetDir,
  backendImageId,
  revision,
  owner,
  names,
  bootstrapPath = backendBootstrap,
}) => ({
  anchor: [
    "run",
    "-d",
    "--name",
    names.anchor,
    "--label",
    `${smokeLabel}=${owner}`,
    "--network",
    "none",
    ...limits,
    "--user",
    backendUser,
    "--entrypoint",
    "node",
    backendImageId,
    "-e",
    "setInterval(() => {}, 2147483647)",
  ],
  redis: [
    "run",
    "-d",
    "--name",
    names.redis,
    "--label",
    `${smokeLabel}=${owner}`,
    "--network",
    `container:${names.anchor}`,
    ...limits,
    "--user",
    redisUser,
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
    "--loglevel",
    "warning",
  ],
  backend: [
    "run",
    "-d",
    "--name",
    names.backend,
    "--label",
    `${smokeLabel}=${owner}`,
    "--network",
    `container:${names.anchor}`,
    ...limits,
    "--user",
    backendUser,
    "--tmpfs",
    "/tmp:rw,nosuid,noexec,size=64m",
    "--mount",
    `type=bind,source=${join(targetDir, "socket")},target=/run/recovery-pg,readonly`,
    "--mount",
    `type=bind,source=${join(targetDir, "password")},target=/run/recovery-password,readonly`,
    "--mount",
    `type=bind,source=${bootstrapPath},target=/run/smoke-bootstrap.mjs,readonly`,
    "--env",
    `COMMIT_SHA=${revision}`,
    "--entrypoint",
    "node",
    backendImageId,
    "/run/smoke-bootstrap.mjs",
  ],
})

const verifyRestoredTarget = async (targetDir, signal) => {
  const raw = await runBounded(
    process.execPath,
    [targetRunner, "verify", "--target-dir", targetDir],
    { timeoutMs: 180_000, maxBytes: 8192, signal }
  )
  const result = JSON.parse(raw)
  assert.equal(result.status, "isolated_restored_target_verified")
  assert.equal(result.targetDir, targetDir)
  assert.match(result.containerId, containerPattern)
  return result
}

const readVerifiedState = async (targetDir, result) => {
  assert.equal(await realpath(targetDir), targetDir)
  assert.match(basename(targetDir), /^pg16-target-[a-f0-9]{32}$/u)
  const metadata = await lstat(join(targetDir, "state.json"))
  assert.ok(metadata.isFile() && !metadata.isSymbolicLink())
  assert.equal(metadata.uid, process.getuid())
  assert.equal(metadata.mode & 0o077, 0)
  const state = JSON.parse(
    await readFile(join(targetDir, "state.json"), "utf8")
  )
  assert.equal(state.phase, "restored")
  assert.equal(state.root, targetDir)
  assert.equal(state.containerId, result.containerId)
  assert.equal(state.targetSystemId, result.targetSystemId)
  assert.notEqual(state.sourceSystemId, state.targetSystemId)
  assert.match(state.daemonId, /^[a-f0-9-]{36}$/u)
  return state
}

const healthProbe = `const f=async(p)=>{const r=await fetch('http://127.0.0.1:9000'+p,{signal:AbortSignal.timeout(1500)});return {code:r.status,body:await r.json()}};Promise.all([f('/live'),f('/ready')]).then(([live,ready])=>process.stdout.write(JSON.stringify({live,ready})+'\\n')).catch(()=>process.exitCode=1)`

export const validateHealth = (raw, revision) => {
  const { live, ready } = JSON.parse(raw)
  assert.equal(live.code, 200)
  assert.equal(live.body?.status, "ok")
  assert.equal(live.body?.version, revision)
  assert.equal(ready.code, 200)
  assert.equal(ready.body?.status, "ok")
  assert.equal(ready.body?.version, revision)
  assert.deepEqual(
    ready.body?.checks?.map((entry) => [entry.name, entry.status]).sort(),
    [
      ["database", "ok"],
      ["redis", "ok"],
    ]
  )
  return ["database", "redis"]
}

const cleanup = async (docker, names, created, owner) => {
  const failures = []
  const listed = (
    await docker([
      "container",
      "ls",
      "--all",
      "--filter",
      `label=${smokeLabel}=${owner}`,
      "--format",
      "{{.Names}}",
    ])
  )
    .split("\n")
    .filter(Boolean)
  const expected = new Set(Object.values(names))
  for (const name of listed) assert.ok(expected.has(name))
  for (const name of [names.backend, names.redis, names.anchor]) {
    if (!listed.includes(name)) continue
    try {
      const item = parseSingleObject(
        await docker(["container", "inspect", name])
      )
      if (created.has(name)) assert.equal(item.Id, created.get(name))
      assert.equal(item.Config?.Labels?.[smokeLabel], owner)
      await docker(["rm", "--force", name], { timeoutMs: 15_000 })
    } catch {
      failures.push(name)
    }
  }
  assert.equal(failures.length, 0, "Owned container cleanup failed.")
}

export const runSmoke = async (
  options,
  {
    docker = dockerCommand,
    verifyTarget = verifyRestoredTarget,
    readState = readVerifiedState,
    pause = (milliseconds) =>
      new Promise((done) => setTimeout(done, milliseconds)),
    assertLocalSocket = async () => {
      assert.ok((await stat("/var/run/docker.sock")).isSocket())
    },
    signal,
  } = {}
) => {
  signal?.throwIfAborted()
  const { targetDir, backendImageId, revision } = options
  assert.equal(
    await docker([
      "context",
      "inspect",
      "default",
      "--format",
      "{{.Endpoints.docker.Host}}",
    ]),
    "unix:///var/run/docker.sock"
  )
  await assertLocalSocket()
  const verified = await verifyTarget(targetDir, signal)
  const state = await readState(targetDir, verified)
  assert.equal(await docker(["info", "--format", "{{.ID}}"]), state.daemonId)
  await assertImage(docker, backendImageId, revision)
  await assertImage(docker, redisImageId)
  const owner = randomBytes(16).toString("hex")
  const names = Object.fromEntries(
    ["anchor", "redis", "backend"].map((kind) => [
      kind,
      `rr-backend-smoke-${owner}-${kind}`,
    ])
  )
  const plans = containerPlans({
    targetDir,
    backendImageId,
    revision,
    owner,
    names,
  })
  const created = new Map()
  let result
  let workError
  let phase = "anchor_start"
  try {
    for (const kind of ["anchor", "redis", "backend"]) {
      signal?.throwIfAborted()
      phase = `${kind}_start`
      if (kind === "backend") {
        phase = "redis_readiness"
        const readyUntil = Date.now() + 20_000
        while (true) {
          try {
            assert.equal(
              await docker(
                ["exec", names.redis, "redis-cli", "-h", "127.0.0.1", "ping"],
                { timeoutMs: 5000, signal }
              ),
              "PONG"
            )
            break
          } catch {
            signal?.throwIfAborted()
            if (Date.now() >= readyUntil)
              throw new Error("Redis readiness timed out.")
            await pause(500)
          }
        }
      }
      const id = await docker(plans[kind], { timeoutMs: 30_000, signal })
      assert.match(id, containerPattern)
      created.set(names[kind], id)
      phase = `${kind}_boundary`
      await assertContainer(docker, {
        name: names[kind],
        id,
        owner,
        imageId: kind === "redis" ? redisImageId : backendImageId,
        networkMode:
          kind === "anchor" ? "none" : `container:${created.get(names.anchor)}`,
        user: kind === "redis" ? redisUser : backendUser,
        mounts:
          kind === "backend"
            ? [
                {
                  source: join(targetDir, "socket"),
                  destination: "/run/recovery-pg",
                },
                {
                  source: join(targetDir, "password"),
                  destination: "/run/recovery-password",
                },
                {
                  source: backendBootstrap,
                  destination: "/run/smoke-bootstrap.mjs",
                },
              ]
            : [],
      })
    }
    phase = "backend_readiness"
    const deadline = Date.now() + 180_000
    while (true) {
      signal?.throwIfAborted()
      let raw
      try {
        raw = await docker(["exec", names.backend, "node", "-e", healthProbe], {
          timeoutMs: 5000,
          maxBytes: 8192,
          signal,
        })
      } catch {
        signal?.throwIfAborted()
        const running = await docker([
          "container",
          "inspect",
          names.backend,
          "--format",
          "{{.State.Running}}",
        ])
        if (running !== "true") {
          let diagnostic = "unavailable"
          let missingModule
          let moduleDetail
          try {
            const lines = (
              await docker(["logs", "--tail", "4", names.backend], {
                timeoutMs: 5000,
                maxBytes: 4096,
              })
            ).split("\n")
            for (const line of lines) {
              const event = JSON.parse(line)
              if (event.status === "backend_exit") {
                const allowed = new Set([
                  "unclassified",
                  "filesystem_permission",
                  "dependency_connection",
                  "database_authentication",
                  "module_missing",
                  "configuration",
                ])
                if (allowed.has(event.diagnostic)) diagnostic = event.diagnostic
                if (
                  event.diagnostic === "module_missing" &&
                  typeof event.missingModule === "string" &&
                  event.missingModule.length <= 120 &&
                  /^(?:[a-z0-9_-]+|@[a-z0-9_-]+\/[a-z0-9_./-]+|\.{0,2}\/[a-z0-9_./-]+|\/app\/[a-z0-9_./-]+)$/iu.test(
                    event.missingModule
                  )
                )
                  missingModule = event.missingModule
                if (
                  event.diagnostic === "module_missing" &&
                  typeof event.moduleDetail === "string" &&
                  event.moduleDetail.length <= 180 &&
                  /^[a-z0-9@/._'"\[\] -]+$/iu.test(event.moduleDetail)
                )
                  moduleDetail = event.moduleDetail
              } else if (
                event.status === "failed" &&
                ["credential", "relay", "application"].includes(event.phase)
              )
                diagnostic = `bootstrap_${event.phase}`
            }
          } catch {
            diagnostic = "unavailable"
          }
          const failure = new Error("Backend exited before readiness.")
          failure.diagnostic = diagnostic
          failure.missingModule = missingModule
          failure.moduleDetail = moduleDetail
          throw failure
        }
        if (Date.now() >= deadline)
          throw new Error("Backend readiness timed out.")
        await pause(2000)
        continue
      }
      const payload = JSON.parse(raw)
      for (const probe of [payload.live, payload.ready]) {
        if (probe?.body?.version && probe.body.version !== revision)
          throw new Error("Backend revision mismatch.")
      }
      try {
        const checks = validateHealth(raw, revision)
        result = {
          status: "backend_isolated_startup_verified",
          revision,
          backendImageId,
          targetSystemId: state.targetSystemId,
          checks,
          network: "none",
          workerMode: "server",
        }
        break
      } catch {
        signal?.throwIfAborted()
        if (Date.now() >= deadline)
          throw new Error("Backend readiness timed out.")
        await pause(2000)
      }
    }
  } catch (error) {
    if (error && typeof error === "object") error.smokePhase = phase
    workError = error
  }
  try {
    await cleanup(docker, names, created, owner)
  } catch (error) {
    if (error && typeof error === "object") error.smokePhase = "cleanup"
    workError = error
  }
  if (workError) throw workError
  return result
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.once("SIGINT", cancel)
  process.once("SIGTERM", cancel)
  try {
    const options = parseArguments(process.argv.slice(2))
    const result = options.help
      ? help
      : await runSmoke(options, { signal: controller.signal })
    controller.signal.throwIfAborted()
    process.stdout.write(
      typeof result === "string" ? result : `${JSON.stringify(result)}\n`
    )
  } catch (error) {
    const allowed = new Set([
      "anchor_start",
      "anchor_boundary",
      "redis_start",
      "redis_boundary",
      "redis_readiness",
      "backend_start",
      "backend_boundary",
      "backend_readiness",
      "cleanup",
    ])
    const phase = allowed.has(error?.smokePhase)
      ? error.smokePhase
      : "preflight"
    const reasons = new Map([
      ["Backend exited before readiness.", "backend_exited"],
      ["Backend readiness timed out.", "readiness_timeout"],
      ["Backend revision mismatch.", "revision_mismatch"],
      ["Redis readiness timed out.", "redis_timeout"],
      ["Owned container cleanup failed.", "cleanup_failed"],
    ])
    const reason = reasons.get(error?.message) ?? "unknown"
    const allowedDiagnostics = new Set([
      "unavailable",
      "unclassified",
      "filesystem_permission",
      "dependency_connection",
      "database_authentication",
      "module_missing",
      "configuration",
      "bootstrap_credential",
      "bootstrap_relay",
      "bootstrap_application",
    ])
    const diagnostic = allowedDiagnostics.has(error?.diagnostic)
      ? error.diagnostic
      : undefined
    const missingModule =
      diagnostic === "module_missing" &&
      typeof error?.missingModule === "string" &&
      error.missingModule.length <= 120
        ? error.missingModule
        : undefined
    const moduleDetail =
      diagnostic === "module_missing" &&
      typeof error?.moduleDetail === "string" &&
      error.moduleDetail.length <= 180 &&
      /^[a-z0-9@/._'"\[\] -]+$/iu.test(error.moduleDetail)
        ? error.moduleDetail
        : undefined
    process.stderr.write(
      `${JSON.stringify({ status: "failed", phase, reason, diagnostic, missingModule, moduleDetail })}\n`
    )
    process.exitCode = 1
  } finally {
    process.off("SIGINT", cancel)
    process.off("SIGTERM", cancel)
  }
}
