import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { test } from "node:test"

const consumerPath = (base, names) =>
  names.reduce(
    (consumer, name) => createRequire(consumer).resolve(name),
    new URL(base, import.meta.url)
  )

for (const [label, path] of [
  [
    "Lighthouse legacy glob",
    consumerPath("../package.json", [
      "@lhci/cli/package.json",
      "chrome-launcher",
      "rimraf",
      "glob",
      "minimatch",
      "brace-expansion",
    ]),
  ],
  [
    "Medusa modern glob",
    consumerPath("../backend/package.json", [
      "@medusajs/framework",
      "glob",
      "minimatch",
      "brace-expansion",
    ]),
  ],
]) {
  test(`${label} bounds nesting, comma-group recursion, and rewrite work`, {
    timeout: 10_000,
  }, () => {
    const output = execFileSync(
      process.execPath,
      [
        "--max-old-space-size=128",
        "--input-type=module",
        "-e",
        `
import assert from "node:assert/strict"
import { createRequire } from "node:module"
const loaded = createRequire(import.meta.url)(process.argv[1])
const expand = typeof loaded === "function" ? loaded : loaded.expand
assert.deepEqual(expand("release-{a,b}-{1..2}"), ["release-a-1", "release-a-2", "release-b-1", "release-b-2"])
assert.deepEqual(expand("{{a,b}}", { maxDepth: 0 }), ["{{a,b}}"])
assert.deepEqual(expand("{a},b}", { maxRewrites: 0 }), ["{a},b}"])
for (const input of [
  "{".repeat(4000) + "a,b" + "}".repeat(4000),
  "{" + "{a},".repeat(8000) + "b}",
  "{a}" + "}".repeat(128_000) + ",z}"
]) {
  const expanded = expand(input, { max: 10, maxLength: 1024 })
  assert.ok(Array.isArray(expanded))
  assert.ok(expanded.length <= 10)
  assert.ok(expanded.every((value) => value.length <= 1024))
}
console.log("ordinary globs preserved; hostile parsing bounded")
`,
        path,
      ],
      { encoding: "utf8", timeout: 5_000, maxBuffer: 16_384 }
    )
    assert.equal(
      output.trim(),
      "ordinary globs preserved; hostile parsing bounded"
    )
  })
}
