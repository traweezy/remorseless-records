import { fileURLToPath } from "node:url"
import { normalizeScriptArguments } from "./lib/cli-arguments.mjs"
import {
  CREDENTIAL_SERVICES,
  compareExposedCredentials,
  EXPOSURE_SOURCE,
  parseExposedCredentials,
  verifyCredentialServices,
} from "./lib/credential-exposure.mjs"
import { STAGING } from "./lib/staging-release.mjs"
import {
  captureCommand,
  verifiedStagingRailwayReader,
} from "./staging-release-readiness.mjs"

const help = `Usage: node scripts/staging-credential-audit.mjs [--require-retired]
Read-only, exact store/staging comparison against the known historical log.
Reads scoped Railway service variables into memory and emits only fixed family
labels/count-free presence results. Never prints values, hashes, URLs or errors.
This checks configuration only, not running processes or old-key rejection.
Exit 0: audit completed; 2: --require-retired found exposed configured values;
1: target, historical evidence or complete service inventory unverified.
`

export const auditStagingCredentials = async (
  args,
  {
    capture = captureCommand,
    railwayReader = verifiedStagingRailwayReader,
    now = () => new Date(),
  } = {}
) => {
  const normalized = normalizeScriptArguments(args)
  if (normalized.length === 1 && normalized[0] === "--help") return { help }
  if (
    normalized.length > 1 ||
    (normalized.length === 1 && normalized[0] !== "--require-retired")
  )
    throw new Error("Unsupported credential audit arguments")
  // Verify the target before reading any credential-bearing input.
  const railway = await railwayReader(capture)
  const serviceArgs = [
    "service",
    "list",
    "--project",
    STAGING.projectId,
    "--environment",
    STAGING.environmentId,
    "--json",
  ]
  verifyCredentialServices(await railway(serviceArgs))
  const raw = await capture("git", [
    "show",
    `${EXPOSURE_SOURCE.commit}:${EXPOSURE_SOURCE.path}`,
  ])
  const exposed = parseExposedCredentials(raw)
  const inventories = []
  for (const service of CREDENTIAL_SERVICES) {
    const variables = await railway([
      "variable",
      "list",
      "--project",
      STAGING.projectId,
      "--environment",
      STAGING.environmentId,
      "--service",
      service.id,
      "--json",
    ])
    inventories.push({ ...service, variables })
  }
  verifyCredentialServices(await railway(serviceArgs))
  const report = {
    schemaVersion: 1,
    checkedAt: now().toISOString(),
    readOnly: true,
    source: EXPOSURE_SOURCE,
    ...compareExposedCredentials(exposed, inventories),
  }
  return {
    report,
    exitCode: normalized.length && !report.exposedCredentialsAbsent ? 2 : 0,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await auditStagingCredentials(process.argv.slice(2))
    console.log(result.help ?? JSON.stringify(result.report))
    process.exitCode = result.exitCode ?? 0
  } catch {
    console.error(
      JSON.stringify({
        event: "credential_audit.failed",
        reason: "evidence_unavailable",
      })
    )
    process.exitCode = 1
  }
}
