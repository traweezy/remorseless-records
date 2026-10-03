import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const releaseOnlyVariables = new Set([
  "DATABASE_MIGRATION_URL",
  "DATABASE_BACKUP_URL",
  "DATABASE_ROLE_PROFILE",
])

export const runtimeEnvironment = (environment) =>
  Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => !releaseOnlyVariables.has(name) && !name.startsWith("PG")
    )
  )

export const runtimeRoleAuditRequired = (value) => {
  const normalized = (value ?? "").trim().toLowerCase()
  if (["true", "1"].includes(normalized)) return true
  if (["false", "0", ""].includes(normalized)) return false
  throw new Error("invalid_role_split_setting")
}

export const startRuntime = ({
  environment = process.env,
  executable = process.execPath,
  script = fileURLToPath(import.meta.url),
  execve = process.execve,
  run = spawnSync,
  chdir = process.chdir,
} = {}) => {
  if (typeof execve !== "function") throw new Error("execve_unavailable")
  const clean = runtimeEnvironment(environment)
  if (Object.keys(clean).length !== Object.keys(environment).length) {
    // Replacing the process also removes its original /proc/self/environ.
    // A JavaScript delete alone would leave that original memory readable.
    // Provider variables and ancestor processes are separate trust boundaries.
    execve(executable, [executable, script], clean)
    throw new Error("runtime_replacement_returned")
  }
  const required = runtimeRoleAuditRequired(clean.DATABASE_ROLE_SPLIT_REQUIRED)
  if (!clean.DATABASE_URL?.trim()) throw new Error("database_url_missing")
  const root = dirname(script)
  chdir(root)
  if (required) {
    const audit = run(
      executable,
      [join(root, "src/cli/audit-database-role.js")],
      {
        cwd: root,
        env: { ...clean, DATABASE_ROLE_PROFILE: "runtime" },
        shell: false,
        timeout: 45_000,
        killSignal: "SIGKILL",
        maxBuffer: 65_536,
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
    if (audit.error || audit.signal || audit.status !== 0) {
      throw new Error("runtime_database_role_rejected")
    }
  }
  execve(
    executable,
    [
      executable,
      "--require",
      join(root, "observability-register.cjs"),
      join(root, "node_modules/@medusajs/cli/cli.js"),
      "start",
      "--verbose",
    ],
    clean
  )
  throw new Error("runtime_replacement_returned")
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 2) throw new Error("unexpected_start_arguments")
    startRuntime()
  } catch {
    // Never print execve errors, audit output, arguments or connection values.
    process.stderr.write(
      "[runtime-start] status=failed reason=startup_boundary\n"
    )
    process.exitCode = 1
  }
}
