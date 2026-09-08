import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"

const storefrontRequire = createRequire(
  new URL("../storefront/package.json", import.meta.url)
)

// This is dependency compatibility coverage, not an active app/config-loader path.
test("Storefront tsx loads typed relative configs without basename collisions", async () => {
  const apiPath = storefrontRequire.resolve("tsx/cjs/api")
  const root = await mkdtemp(join(tmpdir(), "remorseless-tsx-runtime-"))
  const extensionsBefore = { ...storefrontRequire.extensions }
  try {
    for (const label of ["first", "second"]) {
      const directory = join(root, label)
      await mkdir(directory, { mode: 0o700 })
      await writeFile(
        join(directory, "value.ts"),
        `export const value: string = ${JSON.stringify(label)}\n`,
        { mode: 0o600, flag: "wx" }
      )
      await writeFile(
        join(directory, "config.ts"),
        `import { value } from "./value.ts"
type Config = { label: string; attempts: number }
export const config = { label: value, attempts: 1 } satisfies Config
`,
        { mode: 0o600, flag: "wx" }
      )
    }
    const entry = join(root, "smoke.cjs")
    await writeFile(
      entry,
      `const assert = require("node:assert/strict")
const { require: tsxRequire } = require(process.argv[2])
const first = tsxRequire("./first/config.ts", __filename)
const second = tsxRequire("./second/config.ts", __filename)
assert.deepEqual(first.config, { label: "first", attempts: 1 })
assert.deepEqual(second.config, { label: "second", attempts: 1 })
assert.notStrictEqual(first, second)
assert.strictEqual(tsxRequire("./first/config.ts", __filename), first)
console.log(JSON.stringify({ loaded: 2, relativeDependencies: 2 }))
`,
      { mode: 0o600, flag: "wx" }
    )
    const result = spawnSync(
      process.execPath,
      // Native type stripping must not accidentally satisfy the tsx smoke test.
      ["--no-experimental-strip-types", entry, apiPath],
      {
        cwd: root,
        env: {
          TMPDIR: root,
          PATH: dirname(process.execPath),
          TSX_DISABLE_CACHE: "1",
        },
        encoding: "utf8",
        timeout: 5_000,
        killSignal: "SIGKILL",
        maxBuffer: 65_536,
      }
    )
    assert.equal(result.error, undefined)
    assert.equal(result.signal, null)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, "")
    assert.deepEqual(JSON.parse(result.stdout), {
      loaded: 2,
      relativeDependencies: 2,
    })
    assert.deepEqual({ ...storefrontRequire.extensions }, extensionsBefore)
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 2 })
  }
})
