import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  validateRuntimeImageRecord,
  validateRuntimeImageSbom,
} from "./verify-runtime-image-artifacts.mjs"
import {
  validateRuntimeImagePolicyManifest,
  validateRuntimeWorkflowSource,
} from "./verify-runtime-image-policy.mjs"
import { buildRuntimeImageRecord } from "./write-runtime-image-record.mjs"

const revision = "a".repeat(40)
const digest = `sha256:${"b".repeat(64)}`
const workflowSource = readFileSync(
  new URL("../.github/workflows/runtime-images.yml", import.meta.url),
  "utf8"
)
const record = buildRuntimeImageRecord({
  digest,
  revision,
  service: "backend",
})
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.7",
  serialNumber: "urn:uuid:11111111-2222-3333-4444-555555555555",
  metadata: {
    component: {
      "bom-ref": `pkg:oci/backend@${digest}`,
      type: "container",
      properties: [
        {
          name: "aquasecurity:trivy:Labels:org.opencontainers.image.revision",
          value: revision,
        },
        {
          name: "aquasecurity:trivy:Labels:org.opencontainers.image.source",
          value: "https://github.com/traweezy/remorseless-records",
        },
      ],
    },
  },
  components: [{ type: "library", name: "example", version: "1.0.0" }],
}

test("accepts an exact runtime record and bound CycloneDX SBOM", () => {
  assert.doesNotThrow(() => validateRuntimeImageRecord(record))
  assert.doesNotThrow(() => validateRuntimeImageSbom(sbom, record))
})

test("rejects digest, revision, service, and SBOM subject drift", () => {
  assert.throws(() =>
    validateRuntimeImageRecord({ ...record, digest: "sha256:short" })
  )
  assert.throws(() =>
    validateRuntimeImageRecord({ ...record, revision: "main" })
  )
  assert.throws(() =>
    validateRuntimeImageRecord({ ...record, service: "worker" })
  )
  assert.throws(() =>
    validateRuntimeImageSbom(
      {
        ...sbom,
        metadata: {
          component: { ...sbom.metadata.component, "bom-ref": "unbound" },
        },
      },
      record
    )
  )
})

test("rejects an incomplete policy manifest", () => {
  assert.throws(() => validateRuntimeImagePolicyManifest({ schemaVersion: 1 }))
})

test("accepts split read-only validation and master-only publication", () => {
  assert.doesNotThrow(() => validateRuntimeWorkflowSource(workflowSource))
})

test("rejects manual publication outside the exact master ref", () => {
  const broadened = workflowSource.replace(
    "github.ref == 'refs/heads/master' && (github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.publish == true))",
    "github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.publish == true)"
  )
  assert.notEqual(broadened, workflowSource)
  assert.throws(() => validateRuntimeWorkflowSource(broadened))
})

test("rejects write permissions on the validation job", () => {
  const broadened = workflowSource.replace(
    "permissions:\n      contents: read\n    strategy:",
    "permissions:\n      contents: read\n      packages: write\n    strategy:"
  )
  assert.notEqual(broadened, workflowSource)
  assert.throws(() => validateRuntimeWorkflowSource(broadened))
})

test("rejects a publication path that skips smoke or exact-image push", () => {
  const skippedSmoke = workflowSource.replace(
    "- name: Smoke exact runtime image\n        shell: bash",
    "- name: Smoke exact runtime image\n        if: ${{ github.event_name == 'push' }}\n        shell: bash"
  )
  assert.notEqual(skippedSmoke, workflowSource)
  assert.throws(() => validateRuntimeWorkflowSource(skippedSmoke))

  const skippedPush = workflowSource.replace(
    'run: docker push "${IMAGE_REF}"',
    'run: echo "${IMAGE_REF}"'
  )
  assert.notEqual(skippedPush, workflowSource)
  assert.throws(() => validateRuntimeWorkflowSource(skippedPush))
})
