import { spawnSync } from "node:child_process"
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  evaluatePreflight,
  QUERY,
  validateManifest,
} from "./lib/client-staging-preflight.mjs"

const require = createRequire(import.meta.url)
const MAX_MANIFEST_BYTES = 64 * 1024
const MAX_RESPONSE_BYTES = 512 * 1024
const MAX_VARIABLE_PAGES = 16
const USAGE =
  "Usage: node scripts/client-staging-preflight.mjs --manifest <names-only.json>"
const SAFE_ERRORS = new Set([
  USAGE,
  "Cannot read a valid names-only manifest",
  "Railway metadata query failed; check authentication and access",
  "Railway metadata response was invalid",
  "Railway metadata response was incomplete",
])
const stableMetadata = (data) => {
  const environment = data.targetEnvironment
  return JSON.stringify({
    sourceProject: data.sourceProject,
    targetProject: data.targetProject,
    targetEnvironment: {
      id: environment.id,
      name: environment.name,
      projectId: environment.projectId,
      configEtag: environment.configEtag,
      sourceEnvironment: environment.sourceEnvironment,
      serviceInstances: environment.serviceInstances,
      deploymentTriggers: environment.deploymentTriggers,
    },
  })
}

export const parseArguments = (args) => {
  if (args.length === 1 && args[0] === "--help") return { help: true }
  if (args.length !== 2 || args[0] !== "--manifest" || !args[1]) {
    throw new Error(USAGE)
  }
  return { manifestPath: args[1] }
}

export const readManifest = (path) => {
  let descriptor
  try {
    if (!Number.isInteger(constants.O_NOFOLLOW)) {
      throw new Error("No-follow file opens are unavailable")
    }
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    const before = fstatSync(descriptor)
    if (
      !before.isFile() ||
      before.uid !== process.getuid?.() ||
      (before.mode & 0o777) !== 0o600 ||
      before.nlink !== 1 ||
      before.size === 0 ||
      before.size > MAX_MANIFEST_BYTES
    ) {
      throw new Error("Manifest file is not private and regular")
    }
    const bytes = Buffer.alloc(MAX_MANIFEST_BYTES + 1)
    let count = 0
    while (count < bytes.length) {
      const read = readSync(
        descriptor,
        bytes,
        count,
        bytes.length - count,
        null
      )
      if (read === 0) break
      count += read
    }
    const after = fstatSync(descriptor)
    if (
      count !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.mode !== before.mode ||
      after.uid !== before.uid
    ) {
      throw new Error("Manifest changed during read")
    }
    return JSON.parse(bytes.toString("utf8", 0, count))
  } catch {
    throw new Error("Cannot read a valid names-only manifest")
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

export const queryRailway = (manifest, spawn = spawnSync) => {
  const railwayExecutable = join(
    dirname(require.resolve("@railway/cli/package.json")),
    "bin",
    process.platform === "win32" ? "railway.exe" : "railway"
  )
  const edges = []
  const seenCursors = new Set()
  let cursor
  let firstPage
  let firstMetadata
  for (let page = 0; page < MAX_VARIABLE_PAGES; page += 1) {
    const args = [
      "api",
      QUERY,
      "--raw-var",
      `projectId=${manifest.target.projectId}`,
      "--raw-var",
      `environmentId=${manifest.target.environmentId}`,
      "--compact",
    ]
    if (cursor !== undefined) args.push("--raw-var", `after=${cursor}`)
    const result = spawn(railwayExecutable, args, {
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: MAX_RESPONSE_BYTES,
      env: { ...process.env, _: railwayExecutable },
    })
    if (result.error || result.status !== 0) {
      throw new Error(
        "Railway metadata query failed; check authentication and access"
      )
    }
    let parsed
    try {
      parsed = JSON.parse(result.stdout)
    } catch {
      throw new Error("Railway metadata response was invalid")
    }
    const environment = parsed?.data?.targetEnvironment
    const variables = environment?.variables
    if (
      parsed?.errors ||
      !parsed?.data ||
      !Array.isArray(variables?.edges) ||
      typeof variables?.pageInfo?.hasNextPage !== "boolean"
    ) {
      throw new Error("Railway metadata response was incomplete")
    }
    if (firstPage === undefined) {
      firstPage = parsed
      firstMetadata = stableMetadata(parsed.data)
    } else if (stableMetadata(parsed.data) !== firstMetadata) {
      throw new Error("Railway metadata response was incomplete")
    }
    edges.push(...variables.edges)
    if (!variables.pageInfo.hasNextPage) {
      firstPage.data.targetEnvironment.variables = {
        edges,
        pageInfo: { hasNextPage: false },
      }
      return firstPage
    }
    const next = variables.pageInfo.endCursor
    if (typeof next !== "string" || !next || seenCursors.has(next)) {
      throw new Error("Railway metadata response was incomplete")
    }
    seenCursors.add(next)
    cursor = next
  }
  throw new Error("Railway metadata response was incomplete")
}

export const runPreflight = (
  args,
  { read = readManifest, query = queryRailway, now = new Date() } = {}
) => {
  const parsedArgs = parseArguments(args)
  if (parsedArgs.help) return { help: true, passed: true, problems: [] }
  const manifest = read(parsedArgs.manifestPath)
  const manifestProblem = validateManifest(manifest, now)
  if (manifestProblem) return { passed: false, problems: [manifestProblem] }
  return evaluatePreflight(manifest, query(manifest), now)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const result = runPreflight(process.argv.slice(2))
    if (result.help) {
      process.stdout.write(`${USAGE}\n`)
    } else if (result.passed) {
      process.stdout.write(
        "Client staging preflight: PASS (live names, sealing, topology, and deployment state; provider key ownership still requires separate verification)\n"
      )
    } else {
      process.stderr.write("Client staging preflight: FAIL\n")
      for (const problem of result.problems) {
        process.stderr.write(`- ${problem}\n`)
      }
      process.exitCode = 1
    }
  } catch (error) {
    const message =
      error instanceof Error && SAFE_ERRORS.has(error.message)
        ? error.message
        : "Client staging preflight could not complete"
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }
}
