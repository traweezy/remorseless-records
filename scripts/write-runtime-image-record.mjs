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
    schemaVersion: 3,
    service,
    subject: servicePolicy?.image,
    image: `${servicePolicy?.image}:${revision}`,
    digest: imageId,
    imageId,
    revision,
    platform: "linux/amd64",
    baseImage: policy.runtimeBaseImage,
    dockerfile: servicePolicy?.dockerfile,
    source: policy.repository,
    scan: { backport: null, ...scan },
    reports,
    publication: null,
  }
  validateRuntimeImageRecord(record, { requireAccepted: false })
  return record
}
