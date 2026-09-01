const fs = require("fs")
const { execFileSync } = require("child_process")
const path = require("path")
const {
  copyNewRegularFile,
  createNewRegularFile,
  readExistingRegularFile,
  updateExistingRegularFile,
} = require("./secure-file-operations")
const {
  assertCanonicalPathInside,
  renderPnpmWorkspaceConfig,
  rewriteLockfile,
} = require("./post-build-configuration")
const { verifyAdminCspBuild } = require("./verify-admin-csp-build")

const MEDUSA_SERVER_PATH = path.join(process.cwd(), ".medusa", "server")
const MEDUSA_PACKAGE_JSON = path.join(MEDUSA_SERVER_PATH, "package.json")
const MEDUSA_WORKSPACE_YAML = path.join(
  MEDUSA_SERVER_PATH,
  "pnpm-workspace.yaml"
)
const MEDUSA_PATCHES_DIR = path.join(MEDUSA_SERVER_PATH, "patches")
const MEDUSA_ADMIN_INDEX = path.join(
  MEDUSA_SERVER_PATH,
  "public",
  "admin",
  "index.html"
)
const OBSERVABILITY_BOOTSTRAP_SOURCE = path.join(
  process.cwd(),
  "scripts",
  "observability-register.cjs"
)
const OBSERVABILITY_BOOTSTRAP_TARGET = path.join(
  MEDUSA_SERVER_PATH,
  "observability-register.cjs"
)
const LOCAL_PACKAGE_JSON = path.join(process.cwd(), "package.json")
const REPOSITORY_ROOT = path.resolve(process.cwd(), "..")
const ROOT_PACKAGE_JSON = path.join(REPOSITORY_ROOT, "package.json")
const ROOT_WORKSPACE_YAML = path.join(REPOSITORY_ROOT, "pnpm-workspace.yaml")
const ADMIN_IS_DISABLED = ["true", "1"].includes(
  process.env.MEDUSA_DISABLE_ADMIN
)
const PNPM_CONFIG_CWD = fs.existsSync(ROOT_WORKSPACE_YAML)
  ? REPOSITORY_ROOT
  : process.cwd()
const DEFAULT_ALLOWED_BUILDS = [
  "@medusajs/telemetry",
  "@swc/core",
  "esbuild",
  "lefthook",
  "msgpackr-extract",
  "protobufjs",
  "sharp",
]

// Check if .medusa/server exists - if not, build process failed
if (!fs.existsSync(MEDUSA_SERVER_PATH)) {
  throw new Error(
    ".medusa/server directory not found. This indicates the Medusa build process failed. Please check for build errors."
  )
}

const observabilityBootstrap = fs.lstatSync(OBSERVABILITY_BOOTSTRAP_SOURCE)
if (
  !observabilityBootstrap.isFile() ||
  observabilityBootstrap.isSymbolicLink()
) {
  throw new Error("OpenTelemetry bootstrap must be a regular non-symlink file.")
}
copyNewRegularFile(
  OBSERVABILITY_BOOTSTRAP_SOURCE,
  OBSERVABILITY_BOOTSTRAP_TARGET,
  0o644
)

const adminDocumentFound = updateExistingRegularFile(
  MEDUSA_ADMIN_INDEX,
  (adminDocument) =>
    adminDocument
      .replace("<html>", '<html lang="en">')
      .replace(/,\s*user-scalable=no/g, ""),
  { missingOkay: true }
)

if (adminDocumentFound) {
  verifyAdminCspBuild(
    path.join(MEDUSA_SERVER_PATH, "public", "admin", "assets")
  )
} else if (!ADMIN_IS_DISABLED) {
  throw new Error(
    "Admin index is required when MEDUSA_DISABLE_ADMIN is not enabled."
  )
}

// Copy pnpm-lock.yaml (scoped to the backend importer for frozen installs)
const localLockPath = path.join(process.cwd(), "pnpm-lock.yaml")
const rootLockPath = path.join(process.cwd(), "..", "pnpm-lock.yaml")
const lockSource = fs.existsSync(ROOT_WORKSPACE_YAML)
  ? rootLockPath
  : localLockPath

const lockTarget = path.join(MEDUSA_SERVER_PATH, "pnpm-lock.yaml")
const rawLock = readExistingRegularFile(lockSource, "utf-8")
createNewRegularFile(
  lockTarget,
  rewriteLockfile(
    rawLock,
    fs.existsSync(ROOT_WORKSPACE_YAML) ? "backend" : "."
  ),
  0o644
)

const readOverrides = (packagePath) => {
  if (!fs.existsSync(packagePath)) {
    return null
  }
  const content = JSON.parse(readExistingRegularFile(packagePath, "utf-8"))
  const overrides = content?.pnpm?.overrides
  if (overrides === undefined) {
    return null
  }
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new TypeError(`Invalid pnpm overrides in ${packagePath}.`)
  }
  return overrides
}

const readPnpmConfigValue = (name) => {
  const output = execFileSync("pnpm", ["config", "get", name, "--json"], {
    cwd: PNPM_CONFIG_CWD,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
  if (!output || output === "undefined") {
    return undefined
  }

  try {
    return JSON.parse(output)
  } catch (error) {
    throw new Error(`pnpm returned invalid JSON for ${name}.`, {
      cause: error,
    })
  }
}

const readPnpmConfigObject = (name) => {
  const value = readPnpmConfigValue(name)
  if (value === undefined) {
    return null
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`pnpm ${name} must be an object.`)
  }
  return value
}

const readPnpmConfigArray = (name) => {
  const values = readPnpmConfigValue(name)
  if (values === undefined) {
    return []
  }
  if (
    !Array.isArray(values) ||
    values.some((value) => typeof value !== "string" || value.length === 0)
  ) {
    throw new TypeError(`pnpm ${name} must be an array of non-empty strings.`)
  }
  return values
}

const readPnpmConfigBoolean = (name, fallback) => {
  const value = readPnpmConfigValue(name)
  if (value === undefined) {
    return fallback
  }
  if (typeof value !== "boolean") {
    throw new TypeError(`pnpm ${name} must be a boolean.`)
  }
  return value
}

const readPnpmConfigNonNegativeInteger = (name) => {
  const value = readPnpmConfigValue(name)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`pnpm ${name} must be a non-negative integer.`)
  }
  return value
}

const readPnpmAllowBuilds = () => {
  const values = readPnpmConfigObject("allowBuilds") ?? {}
  for (const [dependency, approved] of Object.entries(values)) {
    if (typeof approved !== "boolean") {
      throw new TypeError(`Invalid build approval for ${dependency}.`)
    }
  }
  return values
}

const copyPatchedDependencies = (patchedDependencies) => {
  if (!patchedDependencies || Object.keys(patchedDependencies).length === 0) {
    return null
  }

  fs.mkdirSync(MEDUSA_PATCHES_DIR, { recursive: true, mode: 0o755 })
  const patchDirectory = fs.lstatSync(MEDUSA_PATCHES_DIR)
  if (!patchDirectory.isDirectory() || patchDirectory.isSymbolicLink()) {
    throw new Error("Generated patch destination must be a real directory.")
  }

  const targetNames = new Set()

  return Object.fromEntries(
    Object.entries(patchedDependencies).map(([dependency, patchPath]) => {
      if (typeof patchPath !== "string" || patchPath.length === 0) {
        throw new Error(`Invalid patch path for ${dependency}.`)
      }

      const sourcePath = path.isAbsolute(patchPath)
        ? patchPath
        : path.resolve(PNPM_CONFIG_CWD, patchPath)
      const relativeSource = path.relative(PNPM_CONFIG_CWD, sourcePath)
      if (
        relativeSource === ".." ||
        relativeSource.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeSource)
      ) {
        throw new Error(
          `Patch path escapes the reviewed workspace: ${dependency}`
        )
      }
      try {
        assertCanonicalPathInside(PNPM_CONFIG_CWD, sourcePath)
      } catch (error) {
        throw new Error(
          `Patch path escapes the reviewed workspace: ${dependency}`,
          { cause: error }
        )
      }

      const targetFileName = path.basename(sourcePath)
      if (targetNames.has(targetFileName)) {
        throw new Error(`Patch filename collision: ${targetFileName}`)
      }
      targetNames.add(targetFileName)
      const targetPath = path.join(MEDUSA_PATCHES_DIR, targetFileName)
      copyNewRegularFile(sourcePath, targetPath, 0o644)

      return [dependency, `patches/${targetFileName}`]
    })
  )
}

const overrides =
  readPnpmConfigObject("overrides") ??
  readOverrides(LOCAL_PACKAGE_JSON) ??
  readOverrides(ROOT_PACKAGE_JSON)
const defaultAllowBuilds = Object.fromEntries(
  DEFAULT_ALLOWED_BUILDS.map((dependency) => [dependency, true])
)
const legacyAllowBuilds = Object.fromEntries(
  readPnpmConfigArray("onlyBuiltDependencies").map((dependency) => [
    dependency,
    true,
  ])
)
const allowBuilds = {
  ...defaultAllowBuilds,
  ...legacyAllowBuilds,
  ...readPnpmAllowBuilds(),
}
const minimumReleaseAgeExclude = Array.from(
  new Set(readPnpmConfigArray("minimumReleaseAgeExclude"))
)
const minimumReleaseAge = readPnpmConfigNonNegativeInteger("minimumReleaseAge")
const minimumReleaseAgeStrict = readPnpmConfigBoolean(
  "minimumReleaseAgeStrict",
  true
)
const minimumReleaseAgeIgnoreMissingTime = readPnpmConfigBoolean(
  "minimumReleaseAgeIgnoreMissingTime",
  false
)
const trustLockfile = readPnpmConfigBoolean("trustLockfile", false)
const blockExoticSubdeps = readPnpmConfigBoolean("blockExoticSubdeps", true)
const hoistPattern = readPnpmConfigArray("hoistPattern")
const packageExtensions = readPnpmConfigObject("packageExtensions")
const resolvePeersFromWorkspaceRoot = readPnpmConfigBoolean(
  "resolvePeersFromWorkspaceRoot",
  true
)
const patchedDependencies = copyPatchedDependencies(
  readPnpmConfigObject("patchedDependencies")
)

createNewRegularFile(
  MEDUSA_WORKSPACE_YAML,
  renderPnpmWorkspaceConfig({
    allowBuilds,
    blockExoticSubdeps,
    hoistPattern,
    minimumReleaseAge,
    minimumReleaseAgeExclude,
    minimumReleaseAgeIgnoreMissingTime,
    minimumReleaseAgeStrict,
    overrides,
    packageExtensions,
    resolvePeersFromWorkspaceRoot,
    patchedDependencies,
    trustLockfile,
  }),
  0o644
)

updateExistingRegularFile(MEDUSA_PACKAGE_JSON, (packageDocument) => {
  const packageJson = JSON.parse(packageDocument)
  delete packageJson.pnpm
  return `${JSON.stringify(packageJson, null, 2)}\n`
})

// Install dependencies
console.log("Installing dependencies in .medusa/server...")
execFileSync(
  "pnpm",
  ["i", "--prod", "--frozen-lockfile", "--lockfile-dir", "."],
  {
    cwd: MEDUSA_SERVER_PATH,
    stdio: "inherit",
    env: {
      ...process.env,
      CI: process.env.CI ?? "true",
    },
  }
)
