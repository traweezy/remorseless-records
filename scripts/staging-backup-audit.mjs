import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { normalizeScriptArguments } from "./lib/cli-arguments.mjs"
import {
  BACKUPS_QUERY,
  evaluateStagingBackups,
} from "./lib/staging-backups.mjs"
import { verifiedStagingRailwayReader } from "./staging-release-readiness.mjs"

export const runStagingBackupAudit = async (args, capture) => {
  const normalized = normalizeScriptArguments(args)
  if (normalized.length === 1 && normalized[0] === "--help")
    return {
      help: "Usage: node scripts/staging-backup-audit.mjs [--help]\nRead-only audit of the three pinned staging volume backup schedules and recent records.",
    }
  if (normalized.length !== 0) throw new Error("Invalid backup audit arguments")
  const railway = await verifiedStagingRailwayReader(capture)
  return evaluateStagingBackups(
    await railway(["api", BACKUPS_QUERY, "--compact"])
  )
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const report = await runStagingBackupAudit(process.argv.slice(2))
    console.log(report.help ?? JSON.stringify(report, null, 2))
    if (!report.help && !report.passed) process.exitCode = 2
  } catch {
    console.error(
      JSON.stringify({
        readOnly: true,
        passed: false,
        error: "staging_backup_evidence_unverified",
      })
    )
    process.exitCode = 1
  }
}
