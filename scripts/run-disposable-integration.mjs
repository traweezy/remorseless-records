import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { normalizeScriptArguments } from "./lib/cli-arguments.mjs"

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const projectName = "remorseless-records-integration"
const composeArguments = [
  "compose",
  "--env-file",
  "/dev/null",
  "--project-name",
  projectName,
  "--file",
  "compose.integration.yml",
]
const imageTags = {
  postgres: "remorseless-records-integration-postgres:18.6-hardened",
  redis: "remorseless-records-integration-redis:8.10.1-hardened",
}
const imageIdPattern = /^sha256:[a-f0-9]{64}$/u

export const parseIntegrationArguments = (args) => {
  const normalized = normalizeScriptArguments(args)
  if (normalized.length === 0) return { build: true }
  if (normalized.length === 1 && normalized[0] === "--no-build")
    return { build: false }
  throw new Error("Expected no arguments or --no-build.")
}

const portFrom = (environment, name, fallback) => {
  const raw = environment[name]?.trim() || fallback
  if (!/^\d{4,5}$/u.test(raw))
    throw new Error(`${name} must be a non-privileged TCP port.`)
  const port = Number(raw)
  if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535)
    throw new Error(`${name} must be between 1024 and 65535.`)
  return port
}

export const integrationEnvironment = (environment) => {
  const postgresPort = portFrom(
    environment,
    "RR_INTEGRATION_POSTGRES_PORT",
    "55432"
  )
  const redisPort = portFrom(environment, "RR_INTEGRATION_REDIS_PORT", "56379")
  if (postgresPort === redisPort)
    throw new Error("Disposable PostgreSQL and Redis ports must be distinct.")
  return {
    ...environment,
    ADMIN_CORS: "http://127.0.0.1:7001",
    AUTH_CORS: "http://127.0.0.1:3000",
    BACKEND_PUBLIC_URL: "http://127.0.0.1:9000",
    CI: "true",
    COOKIE_SECRET: "disposable_cookie_secret",
    DATABASE_URL: `postgresql://postgres:local_integration_only@localhost:${postgresPort}/postgres`,
    DB_HOST: "localhost",
    DB_PASSWORD: "local_integration_only",
    DB_PORT: String(postgresPort),
    DB_USERNAME: "postgres",
    INTEGRATION_TESTS_ENABLED: "1",
    JWT_SECRET: "disposable_jwt_secret",
    MEDUSA_DISABLE_TELEMETRY: "true",
    RESEND_API_KEY: "",
    RESEND_FROM_EMAIL: "",
    RESEND_FROM: "",
    MEILISEARCH_HOST: "",
    MEILISEARCH_ADMIN_KEY: "",
    MEILISEARCH_CANDIDATE_INDEX: "",
    MINIO_ENDPOINT: "",
    MINIO_ACCESS_KEY: "",
    MINIO_SECRET_KEY: "",
    MINIO_FILE_URL: "",
    MINIO_BUCKET: "",
    MINIO_REGION: "",
    TAX_RATE_LOOKUP_API_KEY: "",
    TAX_RATE_LOOKUP_PROVIDER: "taxrate_io",
    TAX_RATE_LOOKUP_MODE: "zip",
    TAX_RATE_LOOKUP_MONITOR_POSTAL_CODE: "",
    OTEL_SDK_DISABLED: "true",
    OTEL_TRACES_EXPORTER: "none",
    OTEL_METRICS_EXPORTER: "none",
    OTEL_LOGS_EXPORTER: "none",
    OTEL_EXPORTER_OTLP_ENDPOINT: "",
    OTEL_EXPORTER_OTLP_HEADERS: "",
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "",
    OTEL_EXPORTER_OTLP_TRACES_HEADERS: "",
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "",
    OTEL_EXPORTER_OTLP_METRICS_HEADERS: "",
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "",
    OTEL_EXPORTER_OTLP_LOGS_HEADERS: "",
    NODE_ENV: "test",
    REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    STORE_CORS: "http://127.0.0.1:3000",
    STRIPE_API_KEY: "",
    STRIPE_LIFECYCLE_WEBHOOK_SECRET: "",
    STRIPE_LIFECYCLE_WEBHOOK_SECRET_PREVIOUS: "",
    STRIPE_PAYMENT_METHOD_CONFIGURATION: "",
    STRIPE_WEBHOOK_SECRET: "",
  }
}

const killGroup = (child, signal) => {
  if (process.platform === "win32") return child.kill(signal)
  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (error?.code !== "ESRCH") throw error
  }
}

// Kill the process group, including pnpm workers, before fixture cleanup.
export const runIntegrationCommand = (
  command,
  args,
  {
    environment = process.env,
    capture = false,
    timeoutMs = 15_000,
    signal,
    spawnProcess = spawn,
    terminateProcess = killGroup,
    schedule = setTimeout,
    cancelTimer = clearTimeout,
  } = {}
) =>
  new Promise((resolveResult, reject) => {
    if (signal?.aborted) {
      reject(new Error("Disposable integration command cancelled."))
      return
    }
    const child = spawnProcess(command, args, {
      cwd: repositoryRoot,
      env: environment,
      detached: process.platform !== "win32",
      stdio: capture ? ["ignore", "pipe", "ignore"] : "inherit",
    })
    let output = ""
    let outputBytes = 0
    let failure
    let escalation
    const terminate = (message) => {
      if (failure) return
      failure = new Error(message)
      terminateProcess(child, "SIGTERM")
      escalation = schedule(() => terminateProcess(child, "SIGKILL"), 5_000)
    }
    const abort = () => terminate("Disposable integration command cancelled.")
    const timer = schedule(
      () => terminate("Disposable integration command timed out."),
      timeoutMs
    )
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) abort()
    child.stdout?.on("data", (chunk) => {
      if (failure) return
      const chunkBytes = Buffer.byteLength(chunk)
      if (outputBytes + chunkBytes > 65_536) {
        terminate("Disposable integration command output exceeded its limit.")
        return
      }
      outputBytes += chunkBytes
      output += chunk
    })
    const cleanup = () => {
      cancelTimer(timer)
      if (escalation !== undefined) cancelTimer(escalation)
      signal?.removeEventListener("abort", abort)
    }
    child.once("error", () => {
      cleanup()
      reject(new Error("Disposable integration command could not start."))
    })
    child.once("close", (code) => {
      // A wrapper can exit before a descendant that ignored SIGTERM. Finish
      // terminating that owned group before releasing the cleanup barrier.
      if (failure) terminateProcess(child, "SIGKILL")
      cleanup()
      if (failure) reject(failure)
      else if (code !== 0)
        reject(new Error("Disposable integration command failed."))
      else resolveResult(output.trim())
    })
  })

export const runDisposableIntegration = async ({
  args = [],
  environment = process.env,
  commandRunner = runIntegrationCommand,
  signals = process,
} = {}) => {
  const { build } = parseIntegrationArguments(args)
  const fixtureEnvironment = integrationEnvironment(environment)
  const expectedIds = Object.fromEntries(
    Object.keys(imageTags).map((service) => {
      const value =
        environment[`RR_INTEGRATION_${service.toUpperCase()}_IMAGE_ID`]
      if ((!build || value !== undefined) && !imageIdPattern.test(value ?? ""))
        throw new Error(
          "Prebuilt fixtures require both exact scanned image IDs."
        )
      return [service, value]
    })
  )
  const controller = new AbortController()
  let receivedSignal
  const stopForSignal = (signal) => {
    if (receivedSignal) return
    receivedSignal = signal
    controller.abort()
  }
  const handleInterrupt = () => stopForSignal("SIGINT")
  const handleTermination = () => stopForSignal("SIGTERM")
  signals.on("SIGINT", handleInterrupt)
  signals.on("SIGTERM", handleTermination)
  const run = (command, commandArgs, options = {}) =>
    commandRunner(command, commandArgs, {
      environment,
      signal: controller.signal,
      ...options,
    })
  let startupAttempted = false
  let failure
  try {
    // Pre-existing resources are not ours to replace or remove.
    for (const resource of [
      ["ps", "--all"],
      ["network", "ls"],
      ["volume", "ls"],
    ]) {
      const existing = await run(
        "docker",
        [
          ...resource,
          "--filter",
          `label=com.docker.compose.project=${projectName}`,
          "--format",
          resource[0] === "volume" ? "{{.Name}}" : "{{.ID}}",
        ],
        { capture: true }
      )
      if (existing)
        throw new Error(
          "Disposable integration project already has resources; refusing to replace or remove them."
        )
    }
    if (build)
      await run("docker", [...composeArguments, "build"], {
        timeoutMs: 600_000,
      })
    const imageIds = {}
    for (const [service, tag] of Object.entries(imageTags)) {
      const imageId = await run(
        "docker",
        ["image", "inspect", "--format", "{{.Id}}", tag],
        { capture: true }
      )
      if (
        !imageIdPattern.test(imageId) ||
        (expectedIds[service] && imageId !== expectedIds[service])
      )
        throw new Error(
          "Disposable fixture image does not match its scanned identity."
        )
      imageIds[service] = imageId
    }
    if (controller.signal.aborted)
      throw new Error("Disposable integration cancelled before startup.")
    startupAttempted = true
    await run(
      "docker",
      [
        ...composeArguments,
        "up",
        "--no-build",
        "--pull",
        "never",
        "--detach",
        "--wait",
        "--wait-timeout",
        "120",
      ],
      { timeoutMs: 150_000 }
    )
    for (const service of Object.keys(imageTags)) {
      const containerId = await run(
        "docker",
        [...composeArguments, "ps", "--quiet", service],
        { capture: true }
      )
      if (!/^[a-f0-9]{64}$/u.test(containerId))
        throw new Error("Disposable fixture container identity is unavailable.")
      const actualImageId = await run(
        "docker",
        ["inspect", "--format", "{{.Image}}", containerId],
        { capture: true }
      )
      if (actualImageId !== imageIds[service])
        throw new Error(
          "Started fixture image does not match its scanned identity."
        )
      const portBindings = JSON.parse(
        await run(
          "docker",
          [
            "inspect",
            "--format",
            "{{json .NetworkSettings.Ports}}",
            containerId,
          ],
          { capture: true }
        )
      )
      const containerPort = service === "postgres" ? "5432/tcp" : "6379/tcp"
      const hostPort =
        service === "postgres"
          ? fixtureEnvironment.DB_PORT
          : new URL(fixtureEnvironment.REDIS_URL).port
      if (
        JSON.stringify(portBindings) !==
        JSON.stringify({
          [containerPort]: [{ HostIp: "127.0.0.1", HostPort: hostPort }],
        })
      )
        throw new Error(
          "Disposable fixture loopback port was not published as configured."
        )
    }
    await run("pnpm", ["run", "qa:disposable-integration:services"], {
      environment: fixtureEnvironment,
      timeoutMs: 900_000,
    })
  } catch (error) {
    failure = error
  } finally {
    if (startupAttempted) {
      try {
        await commandRunner(
          "docker",
          [
            ...composeArguments,
            "down",
            "--volumes",
            "--remove-orphans",
            "--timeout",
            "10",
          ],
          { environment, timeoutMs: 30_000 }
        )
      } catch (cleanupError) {
        failure ??= cleanupError
      }
    }
    signals.off("SIGINT", handleInterrupt)
    signals.off("SIGTERM", handleTermination)
  }
  if (receivedSignal) return receivedSignal === "SIGINT" ? 130 : 143
  if (failure) throw failure
  return 0
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = await runDisposableIntegration({
      args: process.argv.slice(2),
    })
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Disposable integration failed."
    )
    process.exitCode = 1
  }
}
