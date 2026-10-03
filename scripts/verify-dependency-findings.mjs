import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { bracesBackport } from "./lib/braces-backport.mjs"
import {
  collectBracesProof,
  countBracesExceptions,
  exactBracesFinding,
  validateBracesProof,
} from "./lib/braces-backport-proof.mjs"

const levels = ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"]
export const assessFilesystemFindings = (report, proof, start, end) => {
  assert.equal(report.SchemaVersion, 2)
  assert.ok(["filesystem", "repository"].includes(report.ArtifactType))
  assert.ok(Array.isArray(report.Results) && report.Results.length > 0)
  const counts = Object.fromEntries(levels.map((level) => [level, 0]))
  for (const result of report.Results) {
    for (const field of ["ModifiedFindings", "ExperimentalModifiedFindings"])
      assert.ok(result[field] === undefined || result[field].length === 0)
    for (const field of ["Vulnerabilities", "Secrets", "Misconfigurations"]) {
      assert.ok(result[field] === undefined || Array.isArray(result[field]))
      for (const finding of result[field] ?? []) {
        assert.ok(Object.hasOwn(counts, finding.Severity))
        counts[finding.Severity]++
      }
    }
  }
  const mitigatedHigh = countBracesExceptions(report, proof, start, end)
  return {
    counts,
    verifiedBackportHigh: mitigatedHigh,
    accepted:
      counts.UNKNOWN === 0 &&
      counts.CRITICAL === 0 &&
      counts.HIGH === mitigatedHigh,
  }
}

export const assessAuditFindings = (report, proof, start, end) => {
  assert.ok(
    report &&
      !report.error &&
      report.advisories &&
      !Array.isArray(report.advisories)
  )
  assert.ok(report.metadata?.totalDependencies > 0)
  for (const level of ["info", "low", "moderate", "high", "critical"])
    assert.ok(
      Number.isSafeInteger(report.metadata.vulnerabilities[level]) &&
        report.metadata.vulnerabilities[level] >= 0
    )
  let mitigatedHigh = 0
  let blocked = 0
  const reported = { high: 0, critical: 0 }
  for (const advisory of Object.values(report.advisories)) {
    assert.ok(
      ["info", "low", "moderate", "high", "critical"].includes(
        advisory.severity
      )
    )
    if (Object.hasOwn(reported, advisory.severity))
      reported[advisory.severity]++
    if (["info", "low"].includes(advisory.severity)) continue
    if (
      advisory.github_advisory_id === bracesBackport.ghsa &&
      advisory.module_name === "braces" &&
      advisory.severity === "high" &&
      proof !== null
    ) {
      validateBracesProof(proof, start, end)
      assert.ok(
        Array.isArray(advisory.findings) && advisory.findings.length > 0
      )
      assert.ok(
        advisory.findings.every(
          (item) =>
            item.version === "3.0.3" &&
            Array.isArray(item.paths) &&
            item.paths.length > 0
        )
      )
      mitigatedHigh++
    } else blocked++
  }
  for (const level of ["high", "critical"])
    assert.equal(
      report.metadata.vulnerabilities[level],
      reported[level],
      "Audit omitted blocking findings"
    )
  // pnpm retains previously reviewed Router counts in metadata while omitting
  // those exact configured ignores from advisories. All returned findings gate.
  return {
    counts: report.metadata.vulnerabilities,
    verifiedBackportHigh: mitigatedHigh,
    blockingAdvisories: blocked,
    accepted: blocked === 0,
  }
}

export const workspaceBracesProof = async (root) => {
  assert.equal(
    createHash("sha256")
      .update(await readFile(join(root, "patches/braces@3.0.3.patch")))
      .digest("hex"),
    bracesBackport.patchSha256
  )
  return collectBracesProof(
    ["node_modules", "backend/node_modules", "storefront/node_modules"].map(
      (path) => join(root, path)
    ),
    root
  )
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = await realpath(fileURLToPath(new URL("..", import.meta.url)))
  assert.equal(await realpath(process.cwd()), root)
  const args = process.argv.slice(2)
  const mode = args[0]
  assert.ok(
    (mode === "filesystem" &&
      args.length === 2 &&
      args[1] === "artifacts/filesystem.vuln.json") ||
      (mode === "audit" &&
        (args.length === 1 || (args.length === 2 && args[1] === "--prod")))
  )
  const start = new Date().toISOString()
  let report
  let needsProof
  await mkdir(join(root, "artifacts"), { recursive: true })
  if (mode === "filesystem") {
    const source = await readFile(join(root, args[1]))
    assert.ok(source.length <= 32 * 1024 * 1024)
    report = JSON.parse(source)
    needsProof = report.Results?.some((result) =>
      result.Vulnerabilities?.some((item) => exactBracesFinding(result, item))
    )
  } else {
    const result = spawnSync(
      "pnpm",
      ["audit", "--json", "--audit-level=moderate", ...args.slice(1)],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 32 * 1024 * 1024,
      }
    )
    assert.ok(
      !result.error && result.signal === null && [0, 1].includes(result.status)
    )
    report = JSON.parse(result.stdout)
    await writeFile(
      join(root, "artifacts/dependency-audit.json"),
      result.stdout
    )
    needsProof = Object.values(report.advisories ?? {}).some(
      (item) => item.github_advisory_id === bracesBackport.ghsa
    )
  }
  const proof = needsProof ? await workspaceBracesProof(root) : null
  const end = new Date().toISOString()
  const result =
    mode === "filesystem"
      ? assessFilesystemFindings(report, proof, start, end)
      : assessAuditFindings(report, proof, start, end)
  await writeFile(
    join(root, `artifacts/${mode}.backport.json`),
    `${JSON.stringify({ ...result, proof }, null, 2)}\n`
  )
  console.info(JSON.stringify({ event: `security.${mode}`, ...result }))
  assert.equal(result.accepted, true, "Unmitigated security findings remain")
}
