import { spawn } from "node:child_process"

export const recoveryTimeoutMs = (raw) => {
  if (raw === undefined) return 30 * 60 * 1000
  if (!/^[1-9]\d*$/u.test(raw)) throw new Error("Invalid recovery deadline.")
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 100 || value > 4 * 60 * 60 * 1000)
    throw new Error("Recovery deadline must be between 100 ms and 4 hours.")
  return value
}

export const createRecoveryScope = (timeoutMs) => {
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  const timer = setTimeout(interrupt, timeoutMs)
  process.once("SIGINT", interrupt)
  process.once("SIGTERM", interrupt)
  return {
    signal: controller.signal,
    close: () => {
      clearTimeout(timer)
      process.off("SIGINT", interrupt)
      process.off("SIGTERM", interrupt)
    },
  }
}

// Do not inherit application secrets or libpq routing/option overrides.
export const recoveryEnvironment = (connection, environment = process.env) => ({
  ...(environment.HOME ? { HOME: environment.HOME } : {}),
  LANG: "C",
  PATH: environment.PATH,
  ...connection.environment,
})

export const runRecoveryCommand = (
  command,
  args,
  { environment, signal, maxOutputBytes = 20 * 1024 * 1024 }
) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Recovery was cancelled or exceeded its deadline."))
      return
    }
    let child
    try {
      child = spawn(command, args, {
        env: environment,
        stdio: ["ignore", "pipe", "ignore"],
        signal,
        killSignal: "SIGKILL",
      })
    } catch {
      reject(new Error("Recovery command could not start."))
      return
    }
    const chunks = []
    let bytes = 0
    let failed = false
    child.on("error", () => {
      failed = true
    })
    child.stdout.on("error", () => {
      failed = true
      child.kill("SIGKILL")
    })
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length
      if (bytes > maxOutputBytes) {
        failed = true
        child.kill("SIGKILL")
      } else if (!failed) chunks.push(chunk)
    })
    // Wait for close, including after abort/error, before removing private files.
    child.once("close", (code, terminationSignal) => {
      if (failed || signal.aborted || terminationSignal || code !== 0) {
        reject(
          new Error(
            "Recovery command failed, was cancelled, or exceeded its limits."
          )
        )
        return
      }
      resolve(Buffer.concat(chunks).toString("utf8").trim())
    })
  })

export const parseRecoveryArguments = (
  args,
  valueFlags,
  allowApply = false
) => {
  const result = {}
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (flag === "--apply" && allowApply && !result.apply) result.apply = true
    else if (valueFlags.includes(flag) && !(flag in result)) {
      const value = args[++index]
      if (!value || value.startsWith("--"))
        throw new Error("Missing recovery argument.")
      result[flag] = value
    } else throw new Error("Unknown or duplicate recovery argument.")
  }
  for (const flag of valueFlags) {
    if (!result[flag]) throw new Error("Missing required recovery argument.")
  }
  return result
}
