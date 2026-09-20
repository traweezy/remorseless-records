import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { normalizeScriptArguments } from "./lib/cli-arguments.mjs"
import { createRecoveryScope } from "./lib/recovery-process.mjs"
import {
  publicTrivyFailureFields,
  trivyDatabaseFreshnessDiagnostic,
} from "./lib/trivy-db-diagnostic.mjs"
import {
  checkedEvidenceDirectory,
  cleanupEvidenceCache,
  createEvidenceDirectory,
  decodeEvidence,
  freezeEvidenceFile,
  hashEvidenceFile,
  readEvidenceFile,
  resolveRuntimeScanner,
  runRuntimeEvidenceCommand,
  setEvidenceDirectoryMode,
  writeEvidenceFile,
} from "./lib/runtime-image-evidence.mjs"
import { buildRuntimeImageRecord } from "./write-runtime-image-record.mjs"
import {
  runtimeEvidencePolicy as policy,
  runtimeFindingPolicy,
  runtimeScanAccepted,
  summarizeRuntimeVulnerabilities,
  validateRuntimeDatabase,
  verifyRuntimeImageArtifacts,
} from "./verify-runtime-image-artifacts.mjs"

const imagePattern = /^sha256:[a-f0-9]{64}$/u
const unixHostPattern = /^unix:\/\/\/[^\s\u0000-\u001f\u007f]+$/u
export const parseRuntimeScanArguments = (args) => {
  const values = normalizeScriptArguments(args)
  if (values.length === 1 && values[0] === "--help") return { help: true }
  assert.equal(values.length, 8)
  const entries = []
  for (let index = 0; index < values.length; index += 2) {
    assert.ok(
      ["--service", "--revision", "--image-id", "--output"].includes(
        values[index]
      )
    )
    assert.ok(
      typeof values[index + 1] === "string" &&
        !values[index + 1].startsWith("--")
    )
    entries.push([values[index].slice(2), values[index + 1]])
  }
  const result = Object.fromEntries(entries)
  assert.equal(Object.keys(result).length, 4)
  assert.ok(Object.hasOwn(policy.services, result.service))
  assert.match(result.revision, /^[a-f0-9]{40}$/u)
  assert.match(result["image-id"], imagePattern)
  assert.ok(result.output.length > 0)
  return {
    service: result.service,
    revision: result.revision,
    imageId: result["image-id"],
    output: resolve(result.output),
  }
}

const imageIdentity = (source, expected) => {
  const image = decodeEvidence(source)
  assert.equal(image.id, expected.imageId)
  assert.equal(image.os, "linux")
  assert.equal(image.architecture, "amd64")
  assert.equal(image.user, "1000:1000")
  assert.equal(image.revision, expected.revision)
  assert.equal(image.source, policy.repository)
  return image
}
const databaseSnapshot = async (cache) => ({
  data: await hashEvidenceFile(
    join(cache, "db", "trivy.db"),
    4 * 1024 * 1024 * 1024
  ),
  metadata: await hashEvidenceFile(
    join(cache, "db", "metadata.json"),
    64 * 1024
  ),
})

export const scanRuntimeImage = async (
  options,
  {
    environment = process.env,
    run = runRuntimeEvidenceCommand,
    resolveScanner = resolveRuntimeScanner,
    now = Date.now,
    signal,
  } = {}
) => {
  let phase = "arguments"
  let cache
  let cacheIdentity
  let outputCreated = false
  let failureDiagnostic
  const scope = createRecoveryScope(15 * 60 * 1000)
  const activeSignal = signal
    ? AbortSignal.any([scope.signal, signal])
    : scope.signal
  try {
    assert.ok(options && Object.hasOwn(policy.services, options.service))
    assert.match(options.revision, /^[a-f0-9]{40}$/u)
    assert.match(options.imageId, imagePattern)
    assert.ok(
      isAbsolute(options.output) && resolve(options.output) === options.output
    )
    assert.ok(
      isAbsolute(environment.HOME) &&
        typeof environment.PATH === "string" &&
        environment.PATH.length > 0 &&
        environment.PATH.length <= 32768 &&
        !/[\u0000-\u001f\u007f]/u.test(environment.PATH)
    )
    if (environment.DOCKER_HOST !== undefined)
      assert.match(environment.DOCKER_HOST, unixHostPattern)
    const childEnvironment = {
      HOME: environment.HOME,
      PATH: environment.PATH,
      LANG: "C",
    }
    const execute = (command, args, timeout = 300000) =>
      run(command, args, {
        environment: childEnvironment,
        signal: AbortSignal.any([activeSignal, AbortSignal.timeout(timeout)]),
      })
    activeSignal.throwIfAborted()
    phase = "initialize"
    await createEvidenceDirectory(options.output)
    outputCreated = true
    const host =
      environment.DOCKER_HOST ??
      decodeEvidence(
        await execute(
          "docker",
          ["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"],
          30000
        )
      )
    assert.match(host, unixHostPattern)
    childEnvironment.DOCKER_HOST = host
    phase = "image_identity"
    const inspect = () =>
      execute(
        "docker",
        [
          "--host",
          host,
          "image",
          "inspect",
          "--format",
          '{"id":{{json .Id}},"os":{{json .Os}},"architecture":{{json .Architecture}},"user":{{json .Config.User}},"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}},"source":{{json (index .Config.Labels "org.opencontainers.image.source")}}}',
          options.imageId,
        ],
        30000
      )
    const beforeImage = imageIdentity(await inspect(), options)
    phase = "scanner_identity"
    const executable = await resolveScanner(childEnvironment.PATH)
    assert.equal(executable.sha256, policy.trivy.binarySha256)
    cache = await mkdtemp(join(tmpdir(), "rr-runtime-trivy-"))
    cacheIdentity = await checkedEvidenceDirectory(cache, true)
    const base = ["--config", "/dev/null", "--cache-dir", cache, "--quiet"]
    const common = [
      "image",
      ...base,
      "--image-src",
      "docker",
      "--docker-host",
      host,
      "--platform",
      "linux/amd64",
      "--scanners",
      "vuln",
      "--pkg-types",
      "os,library",
      "--severity",
      "UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL",
      "--list-all-pkgs",
      "--ignorefile",
      "/dev/null",
      "--ignore-unfixed=false",
      "--skip-java-db-update",
      "--skip-check-update",
      "--skip-vex-repo-update",
      "--skip-version-check",
      "--disable-telemetry",
      "--offline-scan",
      "--timeout",
      "5m",
      "--db-repository",
      `${policy.trivy.databaseRepository}:2`,
    ]
    const version = () =>
      execute(
        executable.path,
        [...base, "--version", "--format", "json"],
        30000
      ).then(decodeEvidence)
    assert.equal(
      (await version()).Version,
      policy.trivy.scannerVersion.slice(1)
    )
    phase = "download_database"
    await execute(executable.path, [...common, "--download-db-only"])
    phase = "freeze_database"
    await checkedEvidenceDirectory(join(cache, "db"))
    await setEvidenceDirectoryMode(join(cache, "db"), 0o700)
    await freezeEvidenceFile(
      join(cache, "db", "trivy.db"),
      4 * 1024 * 1024 * 1024
    )
    await freezeEvidenceFile(join(cache, "db", "metadata.json"), 64 * 1024)
    await setEvidenceDirectoryMode(join(cache, "db"), 0o500)
    const metadataSource = await readEvidenceFile(
      join(cache, "db", "metadata.json"),
      64 * 1024
    )
    const metadata = decodeEvidence(metadataSource)
    const before = await databaseSnapshot(cache)
    const startedAt = new Date(now()).toISOString()
    const database = {
      repository: `${policy.trivy.databaseRepository}:2`,
      version: metadata.Version,
      updatedAt: metadata.UpdatedAt,
      nextUpdate: metadata.NextUpdate,
      downloadedAt: metadata.DownloadedAt,
      before,
      after: before,
    }
    const validateDatabase = (completedAt) => {
      try {
        validateRuntimeDatabase(database, startedAt, completedAt)
      } catch (error) {
        failureDiagnostic = trivyDatabaseFreshnessDiagnostic(
          metadata,
          Date.parse(completedAt),
          Date.parse(startedAt)
        )
        throw error
      }
    }
    validateDatabase(startedAt)
    const scannerBefore = await version()
    assert.equal(scannerBefore.Version, policy.trivy.scannerVersion.slice(1))
    assert.deepEqual(scannerBefore.VulnerabilityDB, metadata)
    const databaseMetadata = await writeEvidenceFile(
      options.output,
      `${options.service}.db.json`,
      metadataSource
    )
    phase = "scan_vulnerabilities"
    const reportSource = await execute(executable.path, [
      ...common,
      "--skip-db-update",
      "--format",
      "json",
      options.imageId,
    ])
    const vulnerabilities = await writeEvidenceFile(
      options.output,
      `${options.service}.vuln.json`,
      reportSource
    )
    const { inventory: _inventory, ...summary } =
      summarizeRuntimeVulnerabilities(decodeEvidence(reportSource), options)
    phase = "scan_sbom"
    const sbomSource = await execute(executable.path, [
      ...common,
      "--skip-db-update",
      "--format",
      "cyclonedx",
      options.imageId,
    ])
    const sbom = await writeEvidenceFile(
      options.output,
      `${options.service}.cdx.json`,
      sbomSource
    )
    phase = "verify_session"
    database.after = await databaseSnapshot(cache)
    assert.deepEqual(await version(), scannerBefore)
    assert.deepEqual(await resolveScanner(childEnvironment.PATH), executable)
    assert.deepEqual(imageIdentity(await inspect(), options), beforeImage)
    const completedAt = new Date(now()).toISOString()
    validateDatabase(completedAt)
    const record = buildRuntimeImageRecord({
      ...options,
      scan: {
        scanner: {
          version: scannerBefore.Version,
          binary: { bytes: executable.bytes, sha256: executable.sha256 },
        },
        database,
        startedAt,
        completedAt,
        policy: runtimeFindingPolicy,
        ...summary,
        accepted: runtimeScanAccepted(summary.counts),
      },
      reports: { vulnerabilities, sbom, databaseMetadata },
    })
    await writeEvidenceFile(
      options.output,
      `${options.service}.image.json`,
      `${JSON.stringify(record, null, 2)}\n`
    )
    phase = "verify_artifacts"
    await verifyRuntimeImageArtifacts(
      join(options.output, `${options.service}.image.json`)
    )
    activeSignal.throwIfAborted()
    return {
      event: "runtime.image.verified",
      service: options.service,
      imageId: options.imageId,
      revision: options.revision,
      counts: record.scan.counts,
      fixedHighCritical: record.scan.fixedHighCritical,
    }
  } catch {
    if (outputCreated) {
      try {
        await writeEvidenceFile(
          options.output,
          "failure.json",
          `${JSON.stringify({ event: "runtime.image.failed", phase, ...publicTrivyFailureFields(failureDiagnostic) })}\n`
        )
      } catch {
        /* Never follow an unsafe replacement output path. */
      }
    }
    throw Object.assign(new Error("Runtime image evidence rejected."), {
      phase,
      ...publicTrivyFailureFields(failureDiagnostic),
    })
  } finally {
    try {
      if (cache && cacheIdentity)
        await cleanupEvidenceCache(cache, cacheIdentity)
      activeSignal.throwIfAborted()
    } catch {
      if (outputCreated) {
        try {
          await writeEvidenceFile(
            options.output,
            "failure.json",
            `${JSON.stringify({ event: "runtime.image.failed", phase: "cleanup" })}\n`
          )
        } catch {
          /* Preserve existing failure evidence or unsafe replacement paths. */
        }
      }
      throw Object.assign(
        new Error("Runtime image evidence cleanup rejected."),
        { phase: "cleanup" }
      )
    } finally {
      scope.close()
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseRuntimeScanArguments(process.argv.slice(2))
    if (options.help)
      console.log(
        "Usage: node scripts/scan-runtime-image.mjs --service <backend|storefront> --revision <sha> --image-id <sha256:id> --output <new-private-directory>\nUses reviewed Trivy and a fresh private DB; no image pull or publication. Only local Unix Docker endpoints. Retains full findings; all UNKNOWN/HIGH/CRITICAL findings fail."
      )
    else console.log(JSON.stringify(await scanRuntimeImage(options)))
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "runtime.image.failed",
        phase: error?.phase ?? "arguments",
        ...publicTrivyFailureFields(error),
      })
    )
    process.exitCode = 1
  }
}
