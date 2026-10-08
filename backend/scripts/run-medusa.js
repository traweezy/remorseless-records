const { spawnSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const { buildForwardedArgs } = require("./run-medusa-arguments")

const rawScript = process.argv[2]
const rawScriptArgs = process.argv.slice(3)

if (!rawScript) {
  console.error("Usage: node ./scripts/run-medusa.js <script> [-- <args...>]")
  process.exit(1)
}

const resolveScriptPath = (input) => {
  const root = process.cwd()
  const resolved = path.isAbsolute(input) ? input : path.resolve(root, input)

  if (path.extname(resolved) !== ".ts") {
    return resolved
  }

  const scriptsRoot = path.resolve(root, "src", "scripts")
  if (!resolved.startsWith(`${scriptsRoot}${path.sep}`)) {
    return resolved
  }

  const relativePath = path
    .relative(scriptsRoot, resolved)
    .replace(/\.ts$/, ".js")
  const builtCandidate = path.resolve(
    root,
    ".medusa",
    "server",
    "src",
    "scripts",
    relativePath
  )

  return fs.existsSync(builtCandidate) ? builtCandidate : resolved
}

const scriptIdentities = (input) => {
  const resolved = path.resolve(input)
  try {
    return [resolved, fs.realpathSync(resolved)]
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      return [resolved]
    }
    throw error
  }
}

const wrapperRoot = path.resolve(__dirname, "..")
const backendRoot =
  path.basename(wrapperRoot) === "server" &&
  path.basename(path.dirname(wrapperRoot)) === ".medusa"
    ? path.resolve(wrapperRoot, "..", "..")
    : wrapperRoot
const repairPaths = [backendRoot, path.join(backendRoot, ".medusa", "server")]
  .flatMap((directory) =>
    ["ts", "js"].map((extension) =>
      path.join(
        directory,
        "src",
        "scripts",
        `repair-failed-catalog-creation.${extension}`
      )
    )
  )
  .flatMap(scriptIdentities)
const disabledRepairPaths = new Set(repairPaths)
const scriptPath = resolveScriptPath(rawScript)
if (
  [rawScript, scriptPath]
    .flatMap(scriptIdentities)
    .some((identity) => disabledRepairPaths.has(identity))
) {
  console.error(
    "Failed-creation repair must use the initialized native Admin operation; full application bootstrap is disabled for this script."
  )
  process.exit(1)
}

const root = process.cwd()
const serverRoot = path.join(root, ".medusa", "server")
const hasServerRoot = fs.existsSync(serverRoot)
const candidates = [
  path.join(serverRoot, "node_modules", "@medusajs", "cli", "cli.js"),
  path.join(root, "node_modules", "@medusajs", "cli", "cli.js"),
]

const cliPath = candidates.find((candidate) => fs.existsSync(candidate))

if (!cliPath) {
  console.error("Medusa CLI not found in .medusa/server or node_modules.")
  process.exit(1)
}

if (!fs.existsSync(scriptPath)) {
  console.error(`Script not found at ${scriptPath}`)
  process.exit(1)
}

const normalizeForCwd = (targetPath) => {
  if (hasServerRoot && targetPath.startsWith(`${serverRoot}${path.sep}`)) {
    const relativePath = path.relative(serverRoot, targetPath)
    return relativePath.startsWith(".") ? relativePath : `./${relativePath}`
  }
  return targetPath
}

const forwardedArgs = buildForwardedArgs(rawScriptArgs)
const result = spawnSync(
  process.execPath,
  [
    path.join(__dirname, "run-medusa-exec.js"),
    cliPath,
    normalizeForCwd(scriptPath),
    ...forwardedArgs,
  ],
  {
    stdio: "inherit",
    cwd: hasServerRoot ? serverRoot : root,
    env: process.env,
    shell: false,
  }
)

process.exit(result.status ?? 1)
