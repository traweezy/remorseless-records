import { spawn } from "node:child_process"

const composeArguments = [
  "compose",
  "--project-name",
  "remorseless-records-integration",
  "--file",
  "compose.integration.yml",
]

const portFrom = (name, fallback) => {
  const raw = process.env[name]?.trim() || fallback
  if (!/^\d{4,5}$/u.test(raw)) {
    throw new Error(`${name} must be a non-privileged TCP port.`)
  }
  const port = Number(raw)
  if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error(`${name} must be between 1024 and 65535.`)
  }
  return port
}

const postgresPort = portFrom("RR_INTEGRATION_POSTGRES_PORT", "55432")
const redisPort = portFrom("RR_INTEGRATION_REDIS_PORT", "56379")
if (postgresPort === redisPort) {
  throw new Error("Disposable PostgreSQL and Redis ports must be distinct.")
}

const environment = {
  ...process.env,
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
  NODE_ENV: "test",
  REDIS_URL: `redis://127.0.0.1:${redisPort}`,
  STORE_CORS: "http://127.0.0.1:3000",
  STRIPE_API_KEY: "",
  STRIPE_LIFECYCLE_WEBHOOK_SECRET: "",
  STRIPE_PAYMENT_METHOD_CONFIGURATION: "",
  STRIPE_WEBHOOK_SECRET: "",
}

let activeChild
let receivedSignal

const stopForSignal = (signal) => {
  if (receivedSignal) {
    return
  }
  receivedSignal = signal
  activeChild?.kill(signal)
}

const handleInterrupt = () => stopForSignal("SIGINT")
const handleTermination = () => stopForSignal("SIGTERM")
process.on("SIGINT", handleInterrupt)
process.on("SIGTERM", handleTermination)

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.environment ?? process.env,
      stdio: "inherit",
    })
    activeChild = child
    const clearActiveChild = () => {
      if (activeChild === child) {
        activeChild = undefined
      }
    }
    child.once("error", (error) => {
      clearActiveChild()
      reject(error)
    })
    child.once("exit", (code, signal) => {
      clearActiveChild()
      if (code === 0) {
        resolve()
        return
      }
      reject(
        new Error(
          `${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`
        )
      )
    })
  })

let failure
try {
  await run("docker", [
    ...composeArguments,
    "up",
    "--detach",
    "--wait",
    "--wait-timeout",
    "120",
  ])
  await run("pnpm", ["run", "qa:disposable-integration:services"], {
    environment,
  })
} catch (error) {
  failure = error
} finally {
  try {
    await run("docker", [
      ...composeArguments,
      "down",
      "--volumes",
      "--remove-orphans",
      "--timeout",
      "10",
    ])
  } catch (cleanupError) {
    failure ??= cleanupError
  }
  process.off("SIGINT", handleInterrupt)
  process.off("SIGTERM", handleTermination)
}

if (receivedSignal) {
  process.exitCode = receivedSignal === "SIGINT" ? 130 : 143
} else if (failure) {
  throw failure
}
