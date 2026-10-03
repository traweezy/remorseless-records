import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { normalizeScriptArguments } from "./lib/cli-arguments.mjs"
import { BACKUP_TARGETS } from "./lib/staging-backups.mjs"
import {
  evaluateStagingPitr,
  PITR_SCOPE_QUERY,
  verifyPitrScope,
} from "./lib/staging-pitr.mjs"
import { STAGING } from "./lib/staging-release.mjs"
import { verifiedStagingRailwayReader } from "./staging-release-readiness.mjs"

export const runStagingPitrAudit = async (args, capture) => {
  const normalized = normalizeScriptArguments(args)
  if (normalized.length === 1 && normalized[0] === "--help")
    return {
      help: "Usage: node scripts/staging-pitr-audit.mjs [--help]\nRead-only scoped staging PITR configuration and live archiver audit. Does not prove recovery or off-site retention.",
    }
  if (normalized.length !== 0) throw new Error("Invalid PITR audit arguments")
  const railway = await verifiedStagingRailwayReader(capture)
  const before = await railway(["api", PITR_SCOPE_QUERY, "--compact"])
  verifyPitrScope(before)
  const status = await railway([
    "postgres",
    "pitr",
    "status",
    "--project",
    STAGING.projectId,
    "--environment",
    STAGING.environmentId,
    "--service",
    BACKUP_TARGETS[0].serviceId,
    "--json",
  ])
  const after = await railway(["api", PITR_SCOPE_QUERY, "--compact"])
  return evaluateStagingPitr(status, before, after)
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const report = await runStagingPitrAudit(process.argv.slice(2))
    console.log(report.help ?? JSON.stringify(report, null, 2))
    if (!report.help && !report.passed) process.exitCode = 2
  } catch {
    console.error(
      JSON.stringify({
        readOnly: true,
        passed: false,
        error: "staging_pitr_evidence_unverified",
      })
    )
    process.exitCode = 1
  }
}
