import assert from "node:assert/strict"
import { readFileSync, realpathSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)))
const policy = JSON.parse(
  readFileSync(`${root}/scripts/security/runtime-image-policy.json`, "utf8")
)
const digestPattern = /^sha256:[0-9a-f]{64}$/u
const revisionPattern = /^[0-9a-f]{40}$/u

export const validateRuntimeImageRecord = (record) => {
  assert.equal(record.schemaVersion, 1)
  assert.ok(Object.hasOwn(policy.services, record.service))
  const service = policy.services[record.service]
  assert.equal(record.subject, service.image)
  assert.equal(record.image, `${service.image}:${record.revision}`)
  assert.match(record.digest, digestPattern)
  assert.match(record.revision, revisionPattern)
  assert.equal(record.baseImage, policy.nodeImage)
  assert.equal(record.dockerfile, service.dockerfile)
  assert.equal(record.source, policy.repository)
}

export const validateRuntimeImageSbom = (sbom, record) => {
  validateRuntimeImageRecord(record)
  assert.equal(sbom.bomFormat, "CycloneDX")
  assert.match(sbom.specVersion, /^1\.[4-9]$/u)
  assert.match(sbom.serialNumber, /^urn:uuid:[0-9a-f-]{36}$/u)
  assert.equal(sbom.metadata?.component?.type, "container")
  assert.ok(Array.isArray(sbom.components) && sbom.components.length > 0)

  const component = sbom.metadata.component
  const properties = new Map(
    (component.properties ?? []).map(({ name, value }) => [name, value])
  )
  const digestEvidence = [
    component["bom-ref"],
    component.purl,
    properties.get("aquasecurity:trivy:ImageID"),
    properties.get("aquasecurity:trivy:RepoDigest"),
  ].filter((value) => typeof value === "string")
  assert.ok(
    digestEvidence.some((value) => value.includes(record.digest)),
    "SBOM must identify the exact image digest"
  )
  assert.equal(
    properties.get(
      "aquasecurity:trivy:Labels:org.opencontainers.image.revision"
    ),
    record.revision
  )
  assert.equal(
    properties.get("aquasecurity:trivy:Labels:org.opencontainers.image.source"),
    policy.repository
  )
}

export const verifyRuntimeImageArtifacts = (recordPath, sbomPath) => {
  const record = JSON.parse(readFileSync(resolve(recordPath), "utf8"))
  const sbom = JSON.parse(readFileSync(resolve(sbomPath), "utf8"))
  validateRuntimeImageSbom(sbom, record)
  console.info(
    `Runtime image artifacts verified: ${record.service} ${record.digest}, ${sbom.components.length} components.`
  )
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (executedPath === fileURLToPath(import.meta.url)) {
  assert.equal(
    process.argv.length,
    4,
    "Usage: node scripts/verify-runtime-image-artifacts.mjs <record.json> <sbom.cdx.json>"
  )
  verifyRuntimeImageArtifacts(process.argv[2], process.argv[3])
}
