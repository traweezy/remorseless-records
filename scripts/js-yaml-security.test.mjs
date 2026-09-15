import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { test } from "node:test"

const require = createRequire(import.meta.url)
const lighthouseRequire = createRequire(
  require.resolve("@lhci/cli/package.json")
)
const puppeteerRequire = createRequire(
  require.resolve("puppeteer/package.json")
)
const cosmiconfigRequire = createRequire(
  puppeteerRequire.resolve("cosmiconfig/package.json")
)

for (const [consumer, consumerRequire, version] of [
  ["Lighthouse configuration", lighthouseRequire, "3.15.2"],
  ["Puppeteer configuration", cosmiconfigRequire, "4.3.2"],
]) {
  test(`${consumer} bounds empty YAML merge sources`, {
    timeout: 10_000,
  }, () => {
    assert.equal(consumerRequire("js-yaml/package.json").version, version)
    // Exercise each consumer's installed parser in a bounded child. The
    // previous releases accepted every empty mapping without charging their
    // merge budget (GHSA-2883-xcg3-v3hh).
    const output = execFileSync(
      process.execPath,
      [
        "--max-old-space-size=64",
        "--input-type=module",
        "-e",
        `
import assert from "node:assert/strict"
import { createRequire } from "node:module"
const yaml = createRequire(import.meta.url)(process.argv[1])
const emptyMerges = (count) =>
  "empty: &empty {}\\nresult: {<<: [" + Array(count).fill("*empty").join(", ") + "]}\\n"
assert.deepEqual(yaml.load("defaults: &defaults {retries: 2, enabled: true}\\njob: {<<: *defaults, name: 'récords'}\\n"), {
  defaults: { retries: 2, enabled: true },
  job: { retries: 2, enabled: true, name: "récords" },
})
assert.deepEqual(yaml.load(emptyMerges(8), { maxTotalMergeKeys: 8 }), {empty: {}, result: {}})
assert.throws(() => yaml.load(emptyMerges(9), {maxTotalMergeKeys: 8}), /maxTotalMergeKeys/u)
assert.throws(() => yaml.load("empty: &empty {}\\nresult: {<<: *empty}\\n", {maxTotalMergeKeys: 0}), /maxTotalMergeKeys/u)
assert.throws(() => yaml.load("empty: &empty {}\\na: {<<: [*empty, *empty, *empty]}\\nb: {<<: [*empty, *empty, *empty]}\\n", {maxTotalMergeKeys: 5}), /maxTotalMergeKeys/u)
const cumulativeDefault = "empty: &empty {}\\n" + Array.from({length: 101}, (_, index) =>
  "item" + index + ": {<<: [" + Array(100).fill("*empty").join(", ") + "]}\\n").join("")
assert.throws(() => yaml.load(cumulativeDefault), /maxTotalMergeKeys/u)
console.log("ordinary YAML preserved; explicit, cumulative, and default merge limits enforced")
`,
        consumerRequire.resolve("js-yaml"),
      ],
      {
        encoding: "utf8",
        timeout: 5_000,
        maxBuffer: 16_384,
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
    assert.equal(
      output.trim(),
      "ordinary YAML preserved; explicit, cumulative, and default merge limits enforced"
    )
  })
}
