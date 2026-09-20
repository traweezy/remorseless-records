import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createConnection, createServer } from "node:net"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const socketPath = "/run/recovery-pg/.s.PGSQL.5432"
const passwordPath = "/run/recovery-password"
const relayPort = 15432
let bootstrapPhase = "credential"

export const startSocketRelay = async ({
  path = socketPath,
  port = relayPort,
} = {}) => {
  const sockets = new Set()
  const server = createServer((incoming) => {
    if (sockets.size >= 32) {
      incoming.destroy()
      return
    }
    const outgoing = createConnection(path)
    for (const socket of [incoming, outgoing]) {
      sockets.add(socket)
      socket.setTimeout(30_000, () => socket.destroy())
      socket.on("error", () => socket.destroy())
      socket.on("close", () => sockets.delete(socket))
    }
    incoming.pipe(outgoing)
    outgoing.pipe(incoming)
  })
  try {
    await new Promise((resolveReady, reject) => {
      server.once("error", reject)
      server.listen(port, "127.0.0.1", resolveReady)
    })
  } catch (error) {
    server.close()
    throw error
  }
  return async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((resolveClosed) => server.close(resolveClosed))
  }
}

const runBackend = async () => {
  const password = (await readFile(passwordPath, "utf8")).trim()
  if (!/^[A-Za-z0-9_-]{40,64}$/u.test(password))
    throw new Error("Invalid target credential.")
  bootstrapPhase = "relay"
  const closeRelay = await startSocketRelay()
  bootstrapPhase = "application"
  const child = spawn(
    process.execPath,
    [
      "--require",
      "./observability-register.cjs",
      "./node_modules/@medusajs/cli/cli.js",
      "start",
      "--verbose",
    ],
    {
      cwd: "/app",
      env: {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        HOME: "/tmp",
        NODE_ENV: "development",
        MEDUSA_WORKER_MODE: "server",
        MEDUSA_DISABLE_ADMIN: "1",
        DATABASE_URL: `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${relayPort}/postgres?sslmode=disable`,
        REDIS_URL: "redis://127.0.0.1:6379",
        COMMIT_SHA: process.env.COMMIT_SHA,
        JWT_SECRET: randomBytes(48).toString("base64url"),
        COOKIE_SECRET: randomBytes(48).toString("base64url"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  )
  let diagnostic = "unclassified"
  let missingModule
  let moduleDetail
  let suffix = ""
  const inspectOutput = (chunk) => {
    const sample = `${suffix}${chunk.toString("utf8")}`
    suffix = sample.slice(-256)
    if (/EACCES|EROFS|permission denied|read-only file system/iu.test(sample))
      diagnostic = "filesystem_permission"
    else if (/ECONNREFUSED|connection refused/iu.test(sample))
      diagnostic = "dependency_connection"
    else if (/password authentication failed|28P01/iu.test(sample))
      diagnostic = "database_authentication"
    else if (
      /Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND/iu.test(sample)
    ) {
      diagnostic = "module_missing"
      const matchingLine = sample
        .split("\n")
        .find((line) =>
          /Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND/iu.test(line)
        )
      if (matchingLine) {
        moduleDetail = matchingLine
          .replace(/(?:postgres(?:ql)?|redis):\/\/\S+/giu, "[url]")
          .replace(/[^a-z0-9@/._'"\[\] -]/giu, " ")
          .slice(0, 180)
      }
      const value =
        /Cannot find (?:module|package) ['"]([^'"\r\n]+)['"]/iu.exec(
          sample
        )?.[1]
      if (
        value &&
        value.length <= 120 &&
        /^(?:[a-z0-9_-]+|@[a-z0-9_-]+\/[a-z0-9_./-]+|\.{0,2}\/[a-z0-9_./-]+|\/app\/[a-z0-9_./-]+)$/iu.test(
          value
        )
      )
        missingModule = value
    } else if (/secret|must be configured|is required|invalid/iu.test(sample))
      diagnostic = "configuration"
  }
  child.stdout.on("data", inspectOutput)
  child.stderr.on("data", inspectOutput)
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    child.kill("SIGTERM")
    setTimeout(() => child.kill("SIGKILL"), 5000).unref()
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  try {
    const code = await new Promise((resolveExit, reject) => {
      child.once("error", reject)
      child.once("close", resolveExit)
    })
    process.stdout.write(
      `${JSON.stringify({ status: "backend_exit", code, diagnostic, missingModule, moduleDetail })}\n`
    )
    if (!stopping || code !== 0) process.exitCode = 1
  } finally {
    process.off("SIGINT", stop)
    process.off("SIGTERM", stop)
    await closeRelay()
  }
}

const main = async () => {
  if (process.argv[2] === "--relay-fixture") {
    const path = process.argv[3]
    if (!path?.startsWith("/run/recovery-pg/"))
      throw new Error("Invalid fixture socket.")
    await startSocketRelay({ path })
    process.stdout.write('{"status":"relay_ready"}\n')
    return
  }
  if (process.argv.length !== 2) throw new Error("Invalid arguments.")
  await runBackend()
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main()
  } catch {
    process.stdout.write(
      `${JSON.stringify({ status: "failed", phase: bootstrapPhase })}\n`
    )
    process.exitCode = 1
  }
}
