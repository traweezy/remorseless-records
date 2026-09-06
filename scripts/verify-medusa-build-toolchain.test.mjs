import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"

const buildSource = await readFile(
  new URL("../backend/scripts/build.mjs", import.meta.url),
  "utf8"
)

const cliSource = `
const assert = require("node:assert/strict")
const { mkdirSync, writeFileSync } = require("node:fs")
const { dirname } = require("node:path")
assert.deepEqual(process.argv.slice(2), ["build"])
writeFileSync("cli-ran", process.execPath)
if (process.env.MEDUSA_BUILD_FIXTURE_MODE === "failure") process.exit(9)
for (const artifact of [
  ".medusa/server/package.json",
  ".medusa/server/medusa-config.js",
  ".medusa/server/src/api/middlewares.js",
]) {
  if (process.env.MEDUSA_BUILD_FIXTURE_MODE === "incomplete" && artifact.endsWith("middlewares.js")) continue
  mkdirSync(dirname(artifact), { recursive: true })
  writeFileSync(artifact, "{}")
}
`

const fixture = async (context, mode = "success") => {
  const root = await mkdtemp(join(tmpdir(), "remorseless-medusa-launcher-"))
  context.after(() => rm(root, { force: true, recursive: true }))
  const backend = join(root, "backend")
  const launcher = join(backend, "scripts", "build.mjs")
  const cli = join(backend, "node_modules", "@medusajs", "cli", "cli.js")
  const postBuild = join(backend, "src", "scripts", "postBuild.js")
  const pnpm = join(root, "bin", "pnpm")
  for (const file of [launcher, cli, postBuild, pnpm]) {
    await mkdir(dirname(file), { recursive: true })
  }
  await writeFile(launcher, buildSource)
  await writeFile(join(backend, "package.json"), '{"name":"build-fixture"}')
  if (mode !== "missing-cli") {
    await writeFile(cli, cliSource)
  }
  await writeFile(
    postBuild,
    'require("node:fs").writeFileSync("post-build-ran", "done")'
  )
  await writeFile(
    pnpm,
    `#!${process.execPath}\nrequire("node:fs").writeFileSync("package-manager-ran", "unexpected"); process.exit(97)\n`
  )
  await chmod(pnpm, 0o700)
  await mkdir(join(backend, ".medusa"))
  const staleArtifact = join(backend, ".medusa", "stale")
  await writeFile(staleArtifact, "previous generated output")

  const run = () =>
    spawnSync(process.execPath, [launcher], {
      // Deliberately outside Backend: the launcher must anchor resolution/cwd.
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MEDUSA_BUILD_FIXTURE_MODE: mode,
        NODE_PATH: "",
        PATH: `${dirname(pnpm)}:${process.env.PATH ?? ""}`,
      },
      timeout: 5_000,
    })
  return { backend, run, staleArtifact }
}

const assertMissing = async (path) => {
  await assert.rejects(access(path), { code: "ENOENT" })
}

test("direct build uses the installed CLI and checks output before post-build", async (context) => {
  const input = await fixture(context)
  const result = input.run()

  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(
    await readFile(join(input.backend, "cli-ran"), "utf8"),
    process.execPath
  )
  assert.equal(
    await readFile(join(input.backend, "post-build-ran"), "utf8"),
    "done"
  )
  await assertMissing(input.staleArtifact)
  await assertMissing(join(input.backend, "package-manager-ran"))
})

for (const mode of ["failure", "incomplete"]) {
  test(`fails closed for ${mode} CLI output without invoking post-build`, async (context) => {
    const input = await fixture(context, mode)
    const result = input.run()

    assert.equal(result.error, undefined)
    assert.equal(result.signal, null)
    assert.equal(result.status, 1)
    assert.match(
      result.stderr,
      mode === "failure" ? /exited with 9/u : /ENOENT/u
    )
    await assertMissing(input.staleArtifact)
    await assertMissing(join(input.backend, "post-build-ran"))
    await assertMissing(join(input.backend, "package-manager-ran"))
  })
}

test("missing installed CLI fails before clearing previous output or installing", async (context) => {
  const input = await fixture(context, "missing-cli")
  const result = input.run()

  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Cannot find module '@medusajs\/cli\/cli\.js'/u)
  assert.equal(
    await readFile(input.staleArtifact, "utf8"),
    "previous generated output"
  )
  await assertMissing(join(input.backend, "cli-ran"))
  await assertMissing(join(input.backend, "post-build-ran"))
  await assertMissing(join(input.backend, "package-manager-ran"))
})
