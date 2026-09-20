import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export const inspectCodeqlSarif = async (directory) => {
  const entries = (await readdir(directory, { withFileTypes: true })).filter(
    (entry) => entry.name.endsWith(".sarif")
  )
  assert.ok(entries.length > 0, "CodeQL must produce at least one SARIF file")

  let findings = 0
  let blocking = 0
  for (const entry of entries) {
    assert.ok(entry.isFile(), "CodeQL SARIF entries must be regular files")
    const report = JSON.parse(
      await readFile(join(directory, entry.name), "utf8")
    )
    assert.equal(report.version, "2.1.0", "Unexpected SARIF version")
    assert.ok(
      Array.isArray(report.runs) && report.runs.length > 0,
      "CodeQL SARIF must contain a run"
    )
    for (const run of report.runs) {
      assert.equal(run.tool?.driver?.name, "CodeQL", "Unexpected SARIF tool")
      assert.ok(Array.isArray(run.results), "CodeQL results are missing")
      for (const result of run.results) {
        const componentIndex = result.rule?.toolComponent?.index
        const ruleIndex = result.rule?.index
        assert.ok(
          Number.isSafeInteger(ruleIndex),
          "CodeQL result must identify its rule"
        )
        const component =
          componentIndex === undefined
            ? run.tool.driver
            : run.tool.extensions?.[componentIndex]
        const rule = component?.rules?.[ruleIndex]
        assert.equal(rule?.id, result.ruleId, "CodeQL result rule mismatch")
        const rawSeverity = rule.properties?.["security-severity"]
        assert.ok(
          (typeof rawSeverity === "string" ||
            typeof rawSeverity === "number") &&
            /^\d+(?:\.\d+)?$/u.test(String(rawSeverity)),
          "CodeQL finding must have a security severity"
        )
        const severity = Number(rawSeverity)
        assert.ok(
          Number.isFinite(severity) && severity >= 0 && severity <= 10,
          "CodeQL finding must have a security severity"
        )
        findings += 1
        if (severity >= 7 || result.level === "error") blocking += 1
      }
    }
  }
  return { files: entries.length, findings, blocking }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (invokedDirectly) {
  const directory = process.argv[2]
  assert.ok(
    directory,
    "Usage: node scripts/verify-codeql-sarif.mjs <directory>"
  )
  const result = await inspectCodeqlSarif(directory)
  assert.equal(
    result.blocking,
    0,
    `CodeQL reported ${result.blocking} HIGH/CRITICAL finding(s) in ${result.files} SARIF file(s)`
  )
  process.stdout.write(
    `CodeQL gate passed: ${result.files} SARIF file(s), ${result.findings} total finding(s), 0 HIGH/CRITICAL\n`
  )
}
