import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { normalizeScriptArguments } from "./lib/cli-arguments.mjs"

test("copies direct script arguments without mutating the input", () => {
  const args = Object.freeze(["--output-dir", "/private/archive"])
  const normalized = normalizeScriptArguments(args)
  assert.deepEqual(normalized, args)
  assert.notEqual(normalized, args)
  assert.deepEqual(normalizeScriptArguments([]), [])
})

test("normalizes exactly one optional leading package-manager separator", () => {
  assert.deepEqual(normalizeScriptArguments(["--", "--help"]), ["--help"])
  assert.deepEqual(normalizeScriptArguments(["--"]), [])
  assert.deepEqual(normalizeScriptArguments(["--", "--", "--help"]), [
    "--",
    "--help",
  ])
})

test("preserves interior separators and flag values for strict validation", () => {
  const args = ["--archive", "--", "--apply"]
  assert.deepEqual(normalizeScriptArguments(args), args)
  assert.deepEqual(normalizeScriptArguments(["--help", "--"]), ["--help", "--"])
})

for (const script of [
  "data:redis:audit",
  "data:postgres:backup",
  "data:postgres:restore-drill",
])
  test(`${script} supports real pnpm help with and without its separator`, () => {
    for (const args of [["--help"], ["--", "--help"]]) {
      const result = spawnSync("pnpm", ["run", script, ...args], {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: { PATH: process.env.PATH, CI: "true" },
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 65_536,
      })
      assert.equal(result.error, undefined)
      assert.equal(result.signal, null)
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /Usage:/u)
      assert.doesNotMatch(result.stdout + result.stderr, /audit_unavailable/u)
    }
  })
