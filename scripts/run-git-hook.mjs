import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const commands = Object.freeze({
  "pre-commit": Object.freeze(["qa:lint"]),
  "pre-push": Object.freeze(["qa:lint", "qa:storefront:coverage"]),
})
const fail = (message) => {
  throw new Error(message)
}

export const hookEnvironment = (environment) => {
  const result = { ...environment }
  for (const name of Object.keys(result)) {
    if (/^pnpm_config_(?:pm_on_fail|verify_deps_before_run)$/iu.test(name))
      delete result[name]
  }
  return {
    ...result,
    pnpm_config_pm_on_fail: "error",
    pnpm_config_verify_deps_before_run: "error",
    COREPACK_ENABLE_NETWORK: "0",
  }
}

const execute = (args, { root, environment, signal, capture, timeoutMs }) =>
  new Promise((resolvePromise, reject) => {
    if (signal.aborted) {
      reject(new Error("Git hook was cancelled."))
      return
    }
    const child = spawn("pnpm", args, {
      cwd: root,
      env: environment,
      detached: process.platform !== "win32",
      stdio: capture
        ? ["ignore", "pipe", "pipe"]
        : ["ignore", "inherit", "inherit"],
    })
    let failure
    let output = ""
    let bytes = 0
    const stop = (message) => {
      failure ??= new Error(message)
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, "SIGKILL")
        else child.kill("SIGKILL")
      } catch (error) {
        if (error?.code !== "ESRCH")
          failure = new Error("Git hook child cleanup failed.")
      }
    }
    const interrupt = () => stop("Git hook was cancelled.")
    const timer = setTimeout(
      () => stop("Git hook command exceeded its deadline."),
      timeoutMs
    )
    signal.addEventListener("abort", interrupt, { once: true })
    if (capture) {
      child.stdout.on("data", (chunk) => {
        bytes += chunk.length
        if (bytes > 4096) stop("pnpm version output exceeded its limit.")
        else output += chunk.toString("utf8")
      })
      child.stderr.on("data", (chunk) => {
        bytes += chunk.length
        if (bytes > 4096) stop("pnpm version output exceeded its limit.")
      })
    }
    child.on("error", () => {
      failure = new Error(
        "Cannot start pinned pnpm; put the declared pnpm version on PATH."
      )
    })
    child.once("close", (code, terminationSignal) => {
      clearTimeout(timer)
      signal.removeEventListener("abort", interrupt)
      if (failure) reject(failure)
      else if (terminationSignal || code !== 0)
        reject(new Error("Git hook command failed; no later gate was run."))
      else resolvePromise(output)
    })
  })

export const runGitHook = async ({
  hook,
  root = repositoryRoot,
  environment = process.env,
  signal = new AbortController().signal,
  timeoutMs = 30 * 60 * 1000,
  versionTimeoutMs = 5_000,
} = {}) => {
  if (!Object.hasOwn(commands, hook ?? ""))
    fail("Unknown Git hook; expected pre-commit or pre-push.")
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 30 * 60 * 1000 ||
    !Number.isSafeInteger(versionTimeoutMs) ||
    versionTimeoutMs < 100 ||
    versionTimeoutMs > 5_000
  )
    fail("Invalid Git hook deadline.")
  root = resolve(root)
  const manifest = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8")
  )
  if (
    manifest.name !== "remorseless-records" ||
    !/^pnpm@\d+\.\d+\.\d+$/u.test(manifest.packageManager ?? "")
  )
    fail("The repository must declare an exact pnpm packageManager version.")
  const expectedVersion = manifest.packageManager.slice(5)
  const childEnvironment = hookEnvironment(environment)
  const version = await execute(["--version"], {
    root,
    environment: childEnvironment,
    signal,
    capture: true,
    timeoutMs: versionTimeoutMs,
  }).catch(() => {
    if (signal.aborted) fail("Git hook was cancelled.")
    fail(
      `Cannot verify pnpm ${expectedVersion}; put that exact version on PATH. No version download or fallback is allowed.`
    )
  })
  if (version.trim() !== expectedVersion)
    fail(
      `Git hooks require pnpm ${expectedVersion} on PATH; no version download or fallback is allowed.`
    )
  for (const command of commands[hook]) {
    await execute(["run", command], {
      root,
      environment: childEnvironment,
      signal,
      capture: false,
      timeoutMs,
    })
  }
  return Object.freeze({
    event: "git.hook.passed",
    hook,
    gates: commands[hook].length,
  })
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  process.once("SIGINT", interrupt)
  process.once("SIGTERM", interrupt)
  try {
    if (process.argv.length !== 3) fail("Expected exactly one Git hook name.")
    console.log(
      JSON.stringify(
        await runGitHook({ hook: process.argv[2], signal: controller.signal })
      )
    )
  } catch (error) {
    console.error(
      `Git hook failed: ${error instanceof Error ? error.message : "unknown error"}`
    )
    process.exitCode = 1
  } finally {
    process.off("SIGINT", interrupt)
    process.off("SIGTERM", interrupt)
  }
}
