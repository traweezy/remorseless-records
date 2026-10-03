import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { test } from "node:test"
import { dirname, join } from "node:path"
import {
  cp,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { bracesRegression } from "./lib/braces-backport-regression.mjs"
import { verifyBracesBackport } from "./lib/braces-backport.mjs"

const consumers = [
  [
    "Medusa Admin watcher",
    [
      "@medusajs/medusa",
      "@medusajs/admin-bundler",
      "@medusajs/admin-vite-plugin",
      "chokidar",
      "braces",
    ],
  ],
  [
    "Medusa container globbing",
    ["@medusajs/framework", "awilix", "fast-glob", "micromatch", "braces"],
  ],
]

for (const [label, chain] of consumers) {
  const path = chain.reduce(
    (base, name) => createRequire(base).resolve(name),
    new URL("../backend/package.json", import.meta.url)
  )
  test(`${label} bounds string and direct AST nesting without changing ordinary patterns`, {
    timeout: 10_000,
  }, async () => {
    await verifyBracesBackport(await realpath(dirname(path)))
    const output = execFileSync(
      process.execPath,
      ["--max-old-space-size=64", "-e", bracesRegression, path],
      { encoding: "utf8", timeout: 5_000, maxBuffer: 16_384 }
    )
    assert.equal(
      output.trim(),
      "bounded nesting; ordinary glob and existing limits preserved"
    )
  })
}

test("backport integrity rejects modified, oversized and linked package files", async (t) => {
  const original = consumers[1][1].reduce(
    (base, name) => createRequire(base).resolve(name),
    new URL("../backend/package.json", import.meta.url)
  )
  const temporary = await mkdtemp(join(tmpdir(), "rr-braces-integrity-"))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const target = join(temporary, "braces")
  await cp(await realpath(dirname(original)), target, { recursive: true })
  assert.equal((await verifyBracesBackport(target)).verifiedFiles, 8)
  const compile = join(target, "lib", "compile.js")
  const trusted = await readFile(compile)
  await writeFile(
    compile,
    Buffer.concat([trusted, Buffer.from("\n// modified")])
  )
  await assert.rejects(verifyBracesBackport(target))
  await writeFile(compile, Buffer.alloc(65536))
  await assert.rejects(verifyBracesBackport(target))
  await rm(compile)
  await symlink(join(dirname(original), "lib", "compile.js"), compile)
  await assert.rejects(verifyBracesBackport(target))
})
