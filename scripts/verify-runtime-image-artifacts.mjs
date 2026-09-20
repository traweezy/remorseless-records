import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  assertEvidenceFileAbsent,
  decodeEvidence,
  evidenceDigest,
  readEvidenceFile,
  sha256,
} from "./lib/runtime-image-evidence.mjs"

export const runtimeEvidencePolicy = JSON.parse(
  readFileSync(
    new URL("./security/runtime-image-policy.json", import.meta.url),
    "utf8"
  )
)
const policy = runtimeEvidencePolicy
const digestPattern = /^sha256:[0-9a-f]{64}$/u
const hashPattern = /^[0-9a-f]{64}$/u
const severities = ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"]
export const runtimeScanMaxAgeMs = 30 * 60 * 1000
export const runtimeFindingPolicy = Object.freeze({
  severities: ["UNKNOWN", "HIGH", "CRITICAL"],
  ignoreUnfixed: false,
  scanners: ["vuln"],
  vex: false,
})
export const runtimeScanAccepted = (counts) =>
  runtimeFindingPolicy.severities.every((severity) => counts[severity] === 0)
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
const scalar = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 1024 &&
  !/[\u0000-\u001f\u007f]/u.test(value)
const keys = (value, expected) => {
  assert.ok(object(value))
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort())
}
const timestamp = (value) => {
  assert.match(
    value,
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/u
  )
  assert.ok(Number.isFinite(Date.parse(value)))
  return Date.parse(value)
}
const checksum = (value, limit) => {
  keys(value, ["bytes", "sha256"])
  assert.ok(
    Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= limit
  )
  assert.match(value.sha256, hashPattern)
}
const reportChecksum = (value, filename) => {
  keys(value, ["file", "bytes", "sha256"])
  assert.equal(value.file, filename)
  checksum({ bytes: value.bytes, sha256: value.sha256 }, 32 * 1024 * 1024)
}

export const validateRuntimeDatabase = (database, startedAt, completedAt) => {
  keys(database, [
    "repository",
    "version",
    "updatedAt",
    "nextUpdate",
    "downloadedAt",
    "before",
    "after",
  ])
  assert.equal(database.repository, `${policy.trivy.databaseRepository}:2`)
  assert.equal(database.version, 2)
  const start = timestamp(startedAt)
  const end = timestamp(completedAt)
  const updated = timestamp(database.updatedAt)
  const downloaded = timestamp(database.downloadedAt)
  const next = timestamp(database.nextUpdate)
  assert.ok(
    updated <= downloaded && downloaded <= start && start <= end && end < next
  )
  assert.ok(
    end - updated <= 48 * 60 * 60 * 1000 && end - start <= 10 * 60 * 1000
  )
  for (const sample of [database.before, database.after]) {
    keys(sample, ["data", "metadata"])
    checksum(sample.data, 4 * 1024 * 1024 * 1024)
    checksum(sample.metadata, 64 * 1024)
  }
  assert.deepEqual(
    database.before,
    database.after,
    "Trivy database bytes changed during evidence collection."
  )
}

export const validateRuntimeImageRecord = (
  record,
  { requireAccepted = true } = {}
) => {
  keys(record, [
    "schemaVersion",
    "service",
    "subject",
    "image",
    "digest",
    "imageId",
    "revision",
    "platform",
    "baseImage",
    "dockerfile",
    "source",
    "scan",
    "reports",
    "publication",
  ])
  assert.equal(record.schemaVersion, 2)
  assert.ok(Object.hasOwn(policy.services, record.service))
  const service = policy.services[record.service]
  assert.equal(record.subject, service.image)
  assert.equal(record.image, `${service.image}:${record.revision}`)
  assert.match(record.digest, digestPattern)
  assert.match(record.imageId, digestPattern)
  assert.match(record.revision, /^[0-9a-f]{40}$/u)
  assert.equal(record.platform, "linux/amd64")
  assert.equal(record.baseImage, policy.runtimeBaseImage)
  assert.equal(record.dockerfile, service.dockerfile)
  assert.equal(record.source, policy.repository)
  keys(record.scan, [
    "scanner",
    "database",
    "startedAt",
    "completedAt",
    "policy",
    "counts",
    "fixedHighCritical",
    "coverage",
    "accepted",
  ])
  keys(record.scan.scanner, ["version", "binary"])
  assert.equal(
    record.scan.scanner.version,
    policy.trivy.scannerVersion.slice(1)
  )
  checksum(record.scan.scanner.binary, 512 * 1024 * 1024)
  assert.equal(record.scan.scanner.binary.sha256, policy.trivy.binarySha256)
  validateRuntimeDatabase(
    record.scan.database,
    record.scan.startedAt,
    record.scan.completedAt
  )
  assert.deepEqual(record.scan.policy, runtimeFindingPolicy)
  keys(record.scan.counts, severities)
  for (const count of Object.values(record.scan.counts))
    assert.ok(Number.isSafeInteger(count) && count >= 0 && count <= 20000)
  assert.ok(
    Number.isSafeInteger(record.scan.fixedHighCritical) &&
      record.scan.fixedHighCritical >= 0 &&
      record.scan.fixedHighCritical <=
        record.scan.counts.HIGH + record.scan.counts.CRITICAL
  )
  assert.equal(record.scan.accepted, runtimeScanAccepted(record.scan.counts))
  if (requireAccepted)
    assert.equal(
      record.scan.accepted,
      true,
      "UNKNOWN/HIGH/CRITICAL runtime vulnerabilities remain."
    )
  assert.ok(
    Array.isArray(record.scan.coverage) &&
      record.scan.coverage.length >= 2 &&
      record.scan.coverage.length <= 100
  )
  for (const entry of record.scan.coverage) {
    keys(entry, ["class", "type", "packages"])
    assert.ok(
      ["os-pkgs", "lang-pkgs"].includes(entry.class) && scalar(entry.type)
    )
    assert.ok(
      Number.isSafeInteger(entry.packages) &&
        entry.packages > 0 &&
        entry.packages <= 10000
    )
  }
  assert.ok(
    record.scan.coverage.some(
      (entry) => entry.class === "os-pkgs" && entry.type === "debian"
    )
  )
  assert.ok(
    record.scan.coverage.some(
      (entry) => entry.class === "lang-pkgs" && entry.type === "node-pkg"
    )
  )
  keys(record.reports, ["vulnerabilities", "sbom", "databaseMetadata"])
  reportChecksum(record.reports.vulnerabilities, `${record.service}.vuln.json`)
  reportChecksum(record.reports.sbom, `${record.service}.cdx.json`)
  reportChecksum(record.reports.databaseMetadata, `${record.service}.db.json`)
  assert.equal(
    record.reports.databaseMetadata.sha256,
    record.scan.database.before.metadata.sha256
  )
  assert.equal(
    record.reports.databaseMetadata.bytes,
    record.scan.database.before.metadata.bytes
  )
  if (record.publication === null) assert.equal(record.digest, record.imageId)
  else {
    keys(record.publication, ["manifest", "descriptor"])
    reportChecksum(
      record.publication.descriptor,
      `${record.service}.descriptor.json`
    )
    reportChecksum(
      record.publication.manifest,
      `${record.service}.manifest.json`
    )
    assert.equal(record.digest, `sha256:${record.publication.manifest.sha256}`)
  }
}

export const validateCurrentRuntimeImageRecord = (record, currentTime) => {
  assert.ok(Number.isSafeInteger(currentTime) && currentTime >= 0)
  const completed = timestamp(record.scan.completedAt)
  const updated = timestamp(record.scan.database.updatedAt)
  const next = timestamp(record.scan.database.nextUpdate)
  assert.ok(
    completed <= currentTime,
    "Runtime scan completion is in the future."
  )
  assert.ok(
    currentTime - completed <= runtimeScanMaxAgeMs,
    "Runtime scan evidence is older than 30 minutes."
  )
  assert.ok(
    currentTime - updated <= 48 * 60 * 60 * 1000 && currentTime < next,
    "Runtime vulnerability database is stale or expired."
  )
}

const labelsMatch = (labels, identity) => {
  assert.equal(labels?.["org.opencontainers.image.revision"], identity.revision)
  assert.equal(labels?.["org.opencontainers.image.source"], policy.repository)
}

export const summarizeRuntimeVulnerabilities = (report, identity) => {
  assert.equal(report.SchemaVersion, 2)
  assert.equal(report.ArtifactType, "container_image")
  assert.equal(report.ArtifactName, identity.imageId)
  assert.equal(report.Metadata?.ImageID, identity.imageId)
  assert.equal(report.Metadata?.OS?.Family, "debian")
  assert.notEqual(report.Metadata.OS.EOSL, true)
  assert.equal(report.Metadata.ImageConfig?.architecture, "amd64")
  assert.equal(report.Metadata.ImageConfig?.os, "linux")
  labelsMatch(report.Metadata.ImageConfig?.config?.Labels, identity)
  assert.ok(
    Array.isArray(report.Results) &&
      report.Results.length >= 2 &&
      report.Results.length <= 100
  )
  const counts = Object.fromEntries(severities.map((value) => [value, 0]))
  const coverage = []
  const inventory = new Set()
  let fixedHighCritical = 0
  for (const result of report.Results) {
    assert.ok(
      ["os-pkgs", "lang-pkgs"].includes(result.Class) && scalar(result.Type)
    )
    assert.ok(
      Array.isArray(result.Packages) &&
        result.Packages.length > 0 &&
        result.Packages.length <= 10000
    )
    for (const item of result.Packages) {
      assert.ok(scalar(item.Name) && scalar(item.Version))
      assert.ok(scalar(item.Identifier?.PURL))
      assert.match(
        item.Identifier.PURL,
        result.Class === "os-pkgs" ? /^pkg:deb\//u : /^pkg:npm\//u
      )
      inventory.add(item.Identifier.PURL)
    }
    for (const name of ["ExperimentalModifiedFindings", "ModifiedFindings"])
      assert.ok(
        result[name] === undefined ||
          (Array.isArray(result[name]) && result[name].length === 0)
      )
    assert.ok(
      result.Vulnerabilities === undefined ||
        Array.isArray(result.Vulnerabilities)
    )
    assert.ok((result.Vulnerabilities?.length ?? 0) <= 20000)
    for (const item of result.Vulnerabilities ?? []) {
      assert.ok(
        scalar(item.VulnerabilityID) &&
          scalar(item.PkgName) &&
          scalar(item.InstalledVersion) &&
          Object.hasOwn(counts, item.Severity)
      )
      assert.ok(
        item.FixedVersion === undefined ||
          (typeof item.FixedVersion === "string" &&
            (item.FixedVersion === "" || scalar(item.FixedVersion)))
      )
      counts[item.Severity]++
      if (["HIGH", "CRITICAL"].includes(item.Severity) && item.FixedVersion)
        fixedHighCritical++
    }
    coverage.push({
      class: result.Class,
      type: result.Type,
      packages: result.Packages.length,
    })
  }
  assert.ok(
    coverage.some(
      (entry) => entry.class === "os-pkgs" && entry.type === "debian"
    )
  )
  assert.ok(
    coverage.some(
      (entry) => entry.class === "lang-pkgs" && entry.type === "node-pkg"
    )
  )
  return {
    counts,
    fixedHighCritical,
    coverage,
    inventory: [...inventory].sort(),
  }
}

export const validateRuntimeImageSbom = (sbom, record, inventory = []) => {
  validateRuntimeImageRecord(record, { requireAccepted: false })
  assert.equal(sbom.bomFormat, "CycloneDX")
  assert.match(sbom.specVersion, /^1\.[4-9]$/u)
  assert.match(sbom.serialNumber, /^urn:uuid:[0-9a-f-]{36}$/u)
  assert.equal(sbom.metadata?.component?.type, "container")
  assert.equal(sbom.metadata.component.name, record.imageId)
  const properties = sbom.metadata.component.properties
  assert.ok(Array.isArray(properties))
  for (const [name, expected] of [
    ["aquasecurity:trivy:ImageID", record.imageId],
    [
      "aquasecurity:trivy:Labels:org.opencontainers.image.revision",
      record.revision,
    ],
    [
      "aquasecurity:trivy:Labels:org.opencontainers.image.source",
      policy.repository,
    ],
  ]) {
    const matches = properties.filter((item) => item.name === name)
    assert.equal(matches.length, 1)
    assert.equal(matches[0].value, expected)
  }
  assert.ok(
    Array.isArray(sbom.components) &&
      sbom.components.length > 0 &&
      sbom.components.length <= 20000
  )
  const packages = new Set(
    sbom.components
      .filter((item) => item.type === "library")
      .map((item) => item.purl)
  )
  assert.ok(
    inventory.every((item) => packages.has(item)),
    "SBOM omits packages found in the vulnerability report."
  )
  assert.ok(
    timestamp(sbom.metadata.timestamp) >=
      Math.floor(timestamp(record.scan.startedAt) / 1000) * 1000 &&
      timestamp(sbom.metadata.timestamp) <= timestamp(record.scan.completedAt)
  )
}

export const validatePublishedManifest = (source, record) => {
  const manifest = decodeEvidence(source)
  assert.equal(manifest.schemaVersion, 2)
  assert.ok(
    [
      "application/vnd.oci.image.manifest.v1+json",
      "application/vnd.docker.distribution.manifest.v2+json",
    ].includes(manifest.mediaType)
  )
  assert.equal(
    manifest.manifests,
    undefined,
    "A multi-platform index cannot stand in for the scanned image."
  )
  assert.ok(
    [
      "application/vnd.oci.image.config.v1+json",
      "application/vnd.docker.container.image.v1+json",
    ].includes(manifest.config?.mediaType)
  )
  assert.equal(manifest.config.digest, record.imageId)
  assert.ok(
    Number.isSafeInteger(manifest.config.size) && manifest.config.size > 0
  )
  assert.ok(
    Array.isArray(manifest.layers) &&
      manifest.layers.length > 0 &&
      manifest.layers.length <= 512
  )
  for (const layer of manifest.layers) {
    assert.match(layer.digest, digestPattern)
    assert.ok(Number.isSafeInteger(layer.size) && layer.size > 0)
    assert.ok(
      [
        "application/vnd.oci.image.layer.v1.tar",
        "application/vnd.oci.image.layer.v1.tar+gzip",
        "application/vnd.oci.image.layer.v1.tar+zstd",
        "application/vnd.docker.image.rootfs.diff.tar.gzip",
      ].includes(layer.mediaType)
    )
    assert.equal(layer.urls, undefined)
  }
  return `sha256:${sha256(source)}`
}

export const validatePublishedDescriptor = (descriptor, source, record) => {
  assert.equal(descriptor.digest, validatePublishedManifest(source, record))
  assert.equal(descriptor.size, Buffer.byteLength(source))
  assert.equal(descriptor.mediaType, decodeEvidence(source).mediaType)
  assert.equal(descriptor.urls, undefined)
}

export const verifyRuntimeImageArtifacts = async (
  recordPath,
  { requireAccepted = true, requireCurrent = false, now = Date.now } = {}
) => {
  const record = decodeEvidence(await readEvidenceFile(resolve(recordPath)))
  validateRuntimeImageRecord(record, { requireAccepted })
  const checkFailure = async () => {
    if (requireAccepted)
      await assertEvidenceFileAbsent(
        join(dirname(resolve(recordPath)), "failure.json")
      )
    if (record.publication)
      await assertEvidenceFileAbsent(
        join(dirname(resolve(recordPath)), "publication-failure.json")
      )
  }
  await checkFailure()
  const sources = {}
  for (const [name, reference] of Object.entries(record.reports)) {
    const source = await readEvidenceFile(
      join(dirname(resolve(recordPath)), reference.file)
    )
    assert.deepEqual(evidenceDigest(reference.file, source), reference)
    sources[name] = source
  }
  const report = decodeEvidence(sources.vulnerabilities)
  const { inventory, ...summary } = summarizeRuntimeVulnerabilities(
    report,
    record
  )
  assert.deepEqual(summary, {
    counts: record.scan.counts,
    fixedHighCritical: record.scan.fixedHighCritical,
    coverage: record.scan.coverage,
  })
  assert.ok(
    timestamp(report.CreatedAt) >= timestamp(record.scan.startedAt) &&
      timestamp(report.CreatedAt) <= timestamp(record.scan.completedAt)
  )
  validateRuntimeImageSbom(decodeEvidence(sources.sbom), record, inventory)
  const metadata = decodeEvidence(sources.databaseMetadata)
  assert.deepEqual(metadata, {
    Version: 2,
    NextUpdate: record.scan.database.nextUpdate,
    UpdatedAt: record.scan.database.updatedAt,
    DownloadedAt: record.scan.database.downloadedAt,
  })
  if (record.publication) {
    const source = await readEvidenceFile(
      join(dirname(resolve(recordPath)), record.publication.manifest.file)
    )
    assert.deepEqual(
      evidenceDigest(record.publication.manifest.file, source),
      record.publication.manifest
    )
    assert.equal(validatePublishedManifest(source, record), record.digest)
    const descriptorSource = await readEvidenceFile(
      join(dirname(resolve(recordPath)), record.publication.descriptor.file)
    )
    assert.deepEqual(
      evidenceDigest(record.publication.descriptor.file, descriptorSource),
      record.publication.descriptor
    )
    validatePublishedDescriptor(
      decodeEvidence(descriptorSource),
      source,
      record
    )
  }
  await checkFailure()
  if (requireCurrent) validateCurrentRuntimeImageRecord(record, now())
  return record
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const requireCurrent = process.argv[2] === "--require-current"
  assert.equal(
    process.argv.length,
    requireCurrent ? 4 : 3,
    "Usage: node scripts/verify-runtime-image-artifacts.mjs [--require-current] <record.json>"
  )
  const record = await verifyRuntimeImageArtifacts(
    process.argv[requireCurrent ? 3 : 2],
    { requireCurrent }
  )
  console.info(
    `Runtime image evidence verified: ${record.service} ${record.digest}; DB sha256:${record.scan.database.before.data.sha256}; scan completed ${record.scan.completedAt}.`
  )
}
