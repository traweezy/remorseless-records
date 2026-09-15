import {
  runtimeEvidencePolicy as policy,
  validateRuntimeImageRecord,
} from "./verify-runtime-image-artifacts.mjs"

// Records are constructed only from a completed scan session. The old CLI
// accepting a digest and revision alone could not establish scan provenance.
export const buildRuntimeImageRecord = ({
  imageId,
  revision,
  service,
  scan,
  reports,
}) => {
  const servicePolicy = policy.services[service]
  const record = {
    schemaVersion: 2,
    service,
    subject: servicePolicy?.image,
    image: `${servicePolicy?.image}:${revision}`,
    digest: imageId,
    imageId,
    revision,
    platform: "linux/amd64",
    baseImage: policy.nodeImage,
    dockerfile: servicePolicy?.dockerfile,
    source: policy.repository,
    scan,
    reports,
    publication: null,
  }
  validateRuntimeImageRecord(record, { requireAccepted: false })
  return record
}
