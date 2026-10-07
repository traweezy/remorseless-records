const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const backendRoot = path.resolve(__dirname, "..")
const installedModules = path.join(backendRoot, "node_modules")
const temporaryRoots = []

const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

const scriptSource = `
module.exports.default = async ({ container, args }) => {
  if (args.includes("--fail")) throw new Error("owned script failure")
  require("node:fs").writeFileSync(process.env.MEDUSA_EXEC_RECEIPT, JSON.stringify({
    args,
    cwd: process.cwd(),
    workerMode: process.env.MEDUSA_WORKER_MODE,
    databaseUrl: process.env.DATABASE_URL,
    roleSplit: process.env.DATABASE_ROLE_SPLIT_REQUIRED,
    container: container.resolve("fixture.identity"),
    bootstrap: container.resolve("fixture.bootstrap"),
  }))
}
`

// Only the database/application loaders are replaced. The wrapper, bridge,
// installed Medusa command, script import, logger and exit path execute normally.
const preloadSource = `
const fs = require("node:fs")
const path = require("node:path")
const Module = require("node:module")
const commandPath = require.resolve("@medusajs/medusa/commands/exec", { paths: [process.cwd()] })
const loadersPath = require.resolve(path.resolve(path.dirname(commandPath), "../loaders"))
const bootstrap = []
const logger = { info() {}, error(message, error) { console.error(message, error.message) } }
const container = { resolve(key) {
  if (key === "fixture.identity") return "owned container"
  if (key === "fixture.bootstrap") return bootstrap
  return logger
} }
require.cache[loadersPath] = { id: loadersPath, filename: loadersPath, loaded: true, exports: {
  __esModule: true,
  initializeContainer: async (directory, options) => {
    if (process.env.MEDUSA_EXEC_FAIL_BOOTSTRAP === "true") throw new Error("owned bootstrap failure")
    bootstrap.push({ directory, ...options })
    return container
  },
  default: async ({ directory, skipLoadingEntryPoints, expressApp }) => {
    bootstrap.push({ directory, skipLoadingEntryPoints, expressApp: typeof expressApp })
    return { container }
  },
} }
const load = Module._load
Module._load = function(request, parent, isMain) {
  const loaded = load.call(this, request, parent, isMain)
  if (request === "child_process" || request === "node:child_process") {
    return { ...loaded, spawnSync(command, args, options) {
      fs.writeFileSync(process.env.MEDUSA_EXEC_LAUNCH, JSON.stringify({ command, args, shell: options.shell }))
      return loaded.spawnSync(command, args, options)
    } }
  }
  return loaded
}
`

const fixture = ({ built = false } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rr-medusa-exec-"))
  temporaryRoots.push(root)
  const runtime = built ? path.join(root, ".medusa", "server") : root
  for (const directory of new Set([root, runtime])) {
    fs.mkdirSync(directory, { recursive: true })
    fs.symlinkSync(
      installedModules,
      path.join(directory, "node_modules"),
      "dir"
    )
    write(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { "@medusajs/medusa": "2.18.0" } })
    )
  }
  for (const name of [
    "run-medusa.js",
    "run-medusa-exec.js",
    "run-medusa-arguments.js",
  ]) {
    write(
      path.join(root, "scripts", name),
      fs.readFileSync(path.join(__dirname, name), "utf8")
    )
  }
  const script = path.join(root, "src", "scripts", "owned.js")
  const requestedScript = built
    ? path.join(root, "src", "scripts", "owned.ts")
    : script
  write(path.join(runtime, "src", "scripts", "owned.js"), scriptSource)
  if (built) write(requestedScript, 'throw new Error("uncompiled source ran")')
  const preload = path.join(root, "preload.cjs")
  write(preload, preloadSource)
  const receipt = path.join(root, "receipt.json")
  const launch = path.join(root, "launch.json")
  const environment = {
    PATH: process.env.PATH,
    NODE_ENV: "production",
    NODE_OPTIONS: `--require=${preload}`,
    MEDUSA_EXEC_RECEIPT: receipt,
    MEDUSA_EXEC_LAUNCH: launch,
    DATABASE_URL: "postgresql://app_runtime:fixture@localhost/fixture",
    DATABASE_ROLE_SPLIT_REQUIRED: "true",
    MEDUSA_WORKER_MODE: "shared",
  }
  const run = (args = [], file = requestedScript, overrides = {}) =>
    spawnSync(
      process.execPath,
      [path.join(root, "scripts", "run-medusa.js"), file, ...args],
      {
        cwd: root,
        encoding: "utf8",
        shell: false,
        timeout: 15_000,
        env: { ...environment, ...overrides },
      }
    )
  const runInstalledCli = (args) =>
    spawnSync(
      process.execPath,
      [
        path.join(root, "node_modules", "@medusajs", "cli", "cli.js"),
        "exec",
        script,
        ...args,
      ],
      {
        cwd: root,
        encoding: "utf8",
        shell: false,
        timeout: 15_000,
        env: environment,
      }
    )
  return { root, runtime, run, runInstalledCli, receipt, launch }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe("real Medusa script execution boundary", () => {
  it("reproduces dropped flag arguments in the installed CLI parser", () => {
    const input = fixture()
    const result = input.runInstalledCli(["--", "--sha=fixture", "--apply"])
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    const receipt = JSON.parse(fs.readFileSync(input.receipt, "utf8"))
    expect(receipt.args).toEqual([])
  })

  it.each([false, true])(
    "preserves literal flags and native bootstrap (built=%s)",
    (built) => {
      const input = fixture({ built })
      const shellMarker = path.join(input.root, "unexpected-shell-marker")
      const args = [
        "--sha=0123456789abcdef0123456789abcdef01234567",
        "--apply",
        "--product-id=prod_owned",
        "--message=words with spaces",
        `--literal=$(touch ${shellMarker})`,
        "--literal-backtick=`echo unexpected`",
        "semi;colon",
        "--",
        "trailing value",
      ]
      const result = input.run(["--", ...args])
      expect(result.error).toBeUndefined()
      expect(result.signal).toBeNull()
      expect(result.status).toBe(0)
      const receipt = JSON.parse(fs.readFileSync(input.receipt, "utf8"))
      expect(receipt).toEqual({
        args,
        cwd: input.runtime,
        workerMode: "server",
        databaseUrl: "postgresql://app_runtime:fixture@localhost/fixture",
        roleSplit: "true",
        container: "owned container",
        bootstrap: [
          { directory: input.runtime, skipDbConnection: true },
          {
            directory: input.runtime,
            skipLoadingEntryPoints: true,
            expressApp: "function",
          },
        ],
      })
      const launch = JSON.parse(fs.readFileSync(input.launch, "utf8"))
      expect(launch.command).toBe(process.execPath)
      expect(launch.shell).toBe(false)
      expect(launch.args.slice(3)).toEqual(args)
      expect(launch.args[2]).toBe(
        built
          ? "./src/scripts/owned.js"
          : path.join(input.root, "src", "scripts", "owned.js")
      )
      expect(fs.existsSync(shellMarker)).toBe(false)
    }
  )

  it("keeps native script failure nonzero instead of reporting success", () => {
    const input = fixture()
    const result = input.run(["--fail"])
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("owned script failure")
    expect(fs.existsSync(input.receipt)).toBe(false)
  })

  it("propagates native container initialization failure through the bridge", () => {
    const input = fixture()
    const result = input.run([], undefined, {
      MEDUSA_EXEC_FAIL_BOOTSTRAP: "true",
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Medusa script execution failed")
    expect(result.stderr).toContain("owned bootstrap failure")
    expect(fs.existsSync(input.receipt)).toBe(false)
  })

  it("rejects a missing script before launching native execution", () => {
    const input = fixture()
    const result = input.run([], path.join(input.root, "missing.js"))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Script not found")
    expect(fs.existsSync(input.launch)).toBe(false)
    expect(fs.existsSync(input.receipt)).toBe(false)
  })

  it("does not substitute built scripts for TypeScript outside src/scripts", () => {
    const input = fixture({ built: true })
    const external = path.join(input.root, "other", "owned.ts")
    write(external, 'throw new Error("outside source guard retained")')
    write(path.join(input.runtime, "src", "scripts", "owned.js"), scriptSource)
    const result = input.run([], external)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("outside source guard retained")
    const launch = JSON.parse(fs.readFileSync(input.launch, "utf8"))
    expect(launch.args[2]).toBe(external)
    expect(fs.existsSync(input.receipt)).toBe(false)
  })
})
