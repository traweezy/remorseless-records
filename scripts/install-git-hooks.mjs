import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { constants } from "node:fs"
import * as filesystem from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const hookNames = Object.freeze(["pre-commit", "pre-push"])
const legacyDigests = Object.freeze({
  "pre-commit":
    "fb71e0139ef55a55d7d2b4b91b9b2ae2c4f7451ceddec747bdf7a33ac9d761aa",
  "pre-push":
    "19a548da62547e333b2f0a641bda9f423a296edc9f188e598d65c2ffe6d1eb29",
})
const routingVariables = Object.freeze([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
])
const fail = (message) => {
  throw new Error(message)
}
const digest = (value) => createHash("sha256").update(value).digest("hex")
const sourceFor = (name) =>
  `#!/bin/sh\n# Remorseless Records managed hook v1.\nexec node scripts/run-git-hook.mjs ${name}\n`
const backupName = (name) => `${name}.remorseless-legacy-backup`

export const parseHookInstallArguments = (args) => {
  if (args.length === 0)
    return Object.freeze({ migrateLegacy: false, help: false })
  if (args.length === 1 && args[0] === "--migrate-legacy")
    return Object.freeze({ migrateLegacy: true, help: false })
  if (args.length === 1 && args[0] === "--help")
    return Object.freeze({ migrateLegacy: false, help: true })
  return fail("Unknown hook installation argument.")
}

export const isReviewedLegacyHook = (name, source, root) =>
  hookNames.includes(name) &&
  typeof source === "string" &&
  typeof root === "string" &&
  root.length > 1 &&
  source.split(root).length === 3 &&
  digest(source.replaceAll(root, "<REPOSITORY_ROOT>")) === legacyDigests[name]

const readSnapshot = async (io, path) => {
  let handle
  try {
    const initial = await io.lstat(path)
    if (!initial.isFile() || initial.nlink !== 1 || initial.size > 16_384)
      fail("Hook targets must be bounded regular files without hard links.")
    handle = await io.open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    const metadata = await handle.stat()
    if (
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      metadata.size > 16_384 ||
      metadata.ino !== initial.ino ||
      metadata.dev !== initial.dev
    )
      fail("Hook target changed or is not a bounded regular file.")
    const buffer = Buffer.alloc(16_385)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        null
      )
      if (bytesRead === 0) break
      length += bytesRead
    }
    const after = await handle.stat()
    if (
      length > 16_384 ||
      length !== after.size ||
      after.mtimeMs !== metadata.mtimeMs ||
      after.ctimeMs !== metadata.ctimeMs
    )
      fail("Hook target changed or exceeded its read limit.")
    const bytes = buffer.subarray(0, length)
    return {
      bytes,
      mode: metadata.mode & 0o777,
      ino: metadata.ino,
      dev: metadata.dev,
    }
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  } finally {
    await handle?.close()
  }
}

const sameSnapshot = (left, right) =>
  left === null || right === null
    ? left === right
    : left.ino === right.ino &&
      left.dev === right.dev &&
      left.mode === right.mode &&
      left.bytes.equals(right.bytes)

const assertDirectory = async (io, path) => {
  const metadata = await io.lstat(path)
  if (!metadata.isDirectory() || (await io.realpath(path)) !== path)
    fail(
      "Hook directories must be canonical directories without symbolic links."
    )
  return { ino: metadata.ino, dev: metadata.dev }
}

const gitOutput = (args, root, environment, allowMissing = false) => {
  try {
    return execFileSync("git", args, {
      cwd: root,
      env: environment,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
      maxBuffer: 8_192,
    }).trim()
  } catch (error) {
    if (allowMissing && error.status === 1 && !error.stdout?.length) return null
    return fail("Git hook directory discovery failed.")
  }
}

const verifyRepository = async (io, root, environment) => {
  if (routingVariables.some((name) => environment[name] !== undefined))
    fail("Unset Git repository-routing overrides before installing hooks.")
  await assertDirectory(io, root)
  if (
    gitOutput(["rev-parse", "--show-toplevel"], root, environment) !== root ||
    gitOutput(["rev-parse", "--is-bare-repository"], root, environment) !==
      "false"
  )
    fail("Hooks require the reviewed non-bare repository root.")
  const gitDirectory = join(root, ".git")
  if (
    gitOutput(["rev-parse", "--absolute-git-dir"], root, environment) !==
      gitDirectory ||
    resolve(
      root,
      gitOutput(["rev-parse", "--git-common-dir"], root, environment)
    ) !== gitDirectory
  )
    fail(
      "Linked or external Git directories require a separate hook installation review."
    )
  if (
    gitOutput(
      ["config", "--get-all", "core.hooksPath"],
      root,
      environment,
      true
    ) !== null
  )
    fail(
      "Custom core.hooksPath is configured; no hooks or Git settings were changed."
    )
  const manifest = JSON.parse(
    await io.readFile(join(root, "package.json"), "utf8")
  )
  if (manifest.name !== "remorseless-records")
    fail("Unexpected repository identity.")
  await assertDirectory(io, gitDirectory)
  const hooksDirectory = join(gitDirectory, "hooks")
  const directoryIdentity = await assertDirectory(io, hooksDirectory)
  return { hooksDirectory, directoryIdentity }
}

const writeNewFile = async (io, path, bytes, mode) => {
  const handle = await io.open(path, "wx", 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.chmod(mode)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

// This installer manages two fixed files only. Its migration recognizer accepts
// the complete reviewed legacy wrappers, with only their two root paths varied.
export const installGitHooks = async ({
  root = repositoryRoot,
  environment = process.env,
  migrateLegacy = false,
  io = filesystem,
} = {}) => {
  if (typeof migrateLegacy !== "boolean") fail("Invalid hook migration option.")
  if (
    !migrateLegacy &&
    (environment.CI === "true" || environment.NODE_ENV === "production")
  )
    return Object.freeze({
      event: "git.hooks.install_skipped",
      changed: 0,
      backups: 0,
    })
  root = resolve(root)
  const { hooksDirectory, directoryIdentity } = await verifyRepository(
    io,
    root,
    environment
  )
  await assertDirectory(io, join(root, "githooks"))
  if (!(await readSnapshot(io, join(root, "scripts", "run-git-hook.mjs"))))
    fail("The tracked Git hook dispatcher is missing.")
  const plans = []
  for (const name of hookNames) {
    const source = await readSnapshot(io, join(root, "githooks", name))
    if (!source || source.bytes.toString("utf8") !== sourceFor(name))
      fail("Tracked hook source differs from the reviewed dispatcher wrapper.")
    const target = join(hooksDirectory, name)
    const previous = await readSnapshot(io, target)
    const managed = previous?.bytes.equals(source.bytes) ?? false
    const legacy =
      previous !== null &&
      isReviewedLegacyHook(name, previous.bytes.toString("utf8"), root)
    if (previous && !managed && !legacy)
      fail("Refusing to replace an unowned Git hook.")
    if (legacy && !migrateLegacy)
      fail(
        "Reviewed legacy hooks require explicit --migrate-legacy; no hooks changed."
      )
    const backupPath = join(hooksDirectory, backupName(name))
    const backup = await readSnapshot(io, backupPath)
    if (
      backup &&
      (!isReviewedLegacyHook(name, backup.bytes.toString("utf8"), root) ||
        (legacy && !backup.bytes.equals(previous.bytes)))
    )
      fail(
        "Existing legacy backup is unrecognized; no backup will be overwritten."
      )
    plans.push({
      name,
      target,
      previous,
      bytes: source.bytes,
      legacy,
      backup,
      backupPath,
      changed: !managed || previous.mode !== 0o755,
    })
  }
  const changes = plans.filter((plan) => plan.changed)
  if (changes.length === 0)
    return Object.freeze({
      event: "git.hooks.installed",
      changed: 0,
      backups: 0,
    })
  const temporaryPaths = new Set()
  const activated = []
  let backups = 0
  const assertUnchanged = async (plan) => {
    assert.deepEqual(
      await assertDirectory(io, hooksDirectory),
      directoryIdentity,
      "Git hook directory changed during installation."
    )
    if (!sameSnapshot(await readSnapshot(io, plan.target), plan.previous))
      fail("Git hook changed during installation; refusing replacement.")
  }
  try {
    // Finish validation and create recoverable backups before either activation.
    for (const plan of changes) {
      await assertUnchanged(plan)
      if (plan.legacy && !plan.backup) {
        await writeNewFile(io, plan.backupPath, plan.previous.bytes, 0o600)
        backups++
      }
      plan.temporary = join(
        hooksDirectory,
        `.remorseless-${plan.name}-${randomUUID()}.tmp`
      )
      temporaryPaths.add(plan.temporary)
      await writeNewFile(io, plan.temporary, plan.bytes, 0o755)
      plan.installed = await readSnapshot(io, plan.temporary)
    }
    for (const plan of changes) {
      await assertUnchanged(plan)
      await io.rename(plan.temporary, plan.target)
      temporaryPaths.delete(plan.temporary)
      activated.push(plan)
    }
  } catch (error) {
    let recoveryFailed = false
    for (const plan of activated.reverse()) {
      try {
        assert.deepEqual(
          await assertDirectory(io, hooksDirectory),
          directoryIdentity
        )
        if (!sameSnapshot(await readSnapshot(io, plan.target), plan.installed))
          fail("Changed hook must not be overwritten by rollback.")
        if (plan.previous) {
          const recovery = join(
            hooksDirectory,
            `.remorseless-recover-${plan.name}-${randomUUID()}.tmp`
          )
          temporaryPaths.add(recovery)
          await writeNewFile(
            io,
            recovery,
            plan.previous.bytes,
            plan.previous.mode
          )
          await io.rename(recovery, plan.target)
          temporaryPaths.delete(recovery)
        } else await io.unlink(plan.target)
      } catch {
        recoveryFailed = true
      }
    }
    if (recoveryFailed)
      fail(
        "Hook installation failed and concurrent changes prevented recovery; retain legacy backups for manual review."
      )
    throw error
  } finally {
    for (const temporary of temporaryPaths) {
      try {
        await io.unlink(temporary)
      } catch (error) {
        if (error?.code !== "ENOENT") throw error
      }
    }
  }
  return Object.freeze({
    event: "git.hooks.installed",
    changed: changes.length,
    backups,
  })
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseHookInstallArguments(process.argv.slice(2))
    if (options.help) {
      console.log(
        "Usage: node scripts/install-git-hooks.mjs [--migrate-legacy]\nInstalls two reviewed hooks without changing Git configuration. Legacy migration preserves private backups; custom hooks are refused. CI/production prepare is skipped."
      )
    } else console.log(JSON.stringify(await installGitHooks(options)))
  } catch (error) {
    console.error(
      `Git hook installation failed: ${error instanceof Error ? error.message : "unknown error"}`
    )
    process.exitCode = 1
  }
}
