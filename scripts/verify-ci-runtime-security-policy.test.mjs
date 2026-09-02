import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

import {
  validateCiRuntimeManifest,
  validateWorkflowRuntimeSecurity,
} from "./verify-ci-runtime-security-policy.mjs"

const endpoints = [
  "*.actions.githubusercontent.com:443",
  "*.blob.core.windows.net:443",
  "api.github.com:443",
]
const manifest = JSON.parse(
  readFileSync(
    new URL("./security/ci-runtime-security-policy.json", import.meta.url),
    "utf8"
  )
)
const runtimeWorkflow = readFileSync(
  new URL("../.github/workflows/runtime-images.yml", import.meta.url),
  "utf8"
)
const workflow = `jobs:
  security:
    steps:
      - name: Harden runner
        uses: step-security/harden-runner@05e31511f85b41b11d1cf0ef85d0992719546e2c # v2.21.0
        with:
          egress-policy: block
          allowed-endpoints: >-
            *.actions.githubusercontent.com:443
            *.blob.core.windows.net:443
            api.github.com:443
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
      - name: Shai-Hulud 2.0 Detector
        uses: gensecaihq/Shai-Hulud-2.0-Detector@2755f94762bf5012bc7be82c93e172eabbcd0802 # v2.2.0
        with:
          fail-on-critical: true
          scan-lockfiles: true
          scan-node-modules: false
      - run: pnpm run qa:ci-runtime-security
`
const monitorWorkflow = `jobs:
  observe:
    steps:
      - name: Harden runner
        uses: step-security/harden-runner@05e31511f85b41b11d1cf0ef85d0992719546e2c # v2.21.0
        with:
          egress-policy: block
          allowed-endpoints: >-
            *.actions.githubusercontent.com:443
            *.blob.core.windows.net:443
            api.github.com:443
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
`

describe("CI runtime security policy", () => {
  it("accepts exact pins, blocked egress, and the reviewed endpoints", () => {
    assert.doesNotThrow(() =>
      validateWorkflowRuntimeSecurity(workflow, endpoints)
    )
    assert.doesNotThrow(() =>
      validateWorkflowRuntimeSecurity(
        monitorWorkflow,
        endpoints,
        "staging-monitor"
      )
    )
    const runtimePolicy = manifest.workflows.find(
      ({ path }) => path === ".github/workflows/runtime-images.yml"
    )
    assert.ok(runtimePolicy)
    assert.doesNotThrow(() =>
      validateWorkflowRuntimeSecurity(
        runtimeWorkflow,
        runtimePolicy.allowedEndpoints,
        runtimePolicy.profile,
        runtimePolicy.securityJobCount
      )
    )
  })

  it("rejects audit mode, stale pins, and endpoint broadening", () => {
    assert.throws(() =>
      validateWorkflowRuntimeSecurity(
        workflow.replace("egress-policy: block", "egress-policy: audit"),
        endpoints
      )
    )
    assert.throws(() =>
      validateWorkflowRuntimeSecurity(
        workflow.replace(
          "2755f94762bf5012bc7be82c93e172eabbcd0802",
          "a".repeat(40)
        ),
        endpoints
      )
    )
    assert.throws(() =>
      validateWorkflowRuntimeSecurity(workflow, [
        ...endpoints,
        "example.com:443",
      ])
    )
  })

  it("rejects missing scan controls and drifted self-verification", () => {
    assert.throws(() =>
      validateWorkflowRuntimeSecurity(
        workflow.replace("scan-lockfiles: true\n", ""),
        endpoints
      )
    )
    assert.throws(() =>
      validateWorkflowRuntimeSecurity(
        workflow.replace("pnpm run qa:ci-runtime-security", "pnpm run lint"),
        endpoints
      )
    )
  })

  it("rejects unreviewed manifest actions and DNS-over-HTTPS endpoints", () => {
    assert.doesNotThrow(() => validateCiRuntimeManifest(manifest))

    const dnsBroadened = structuredClone(manifest)
    dnsBroadened.workflows[0].allowedEndpoints = ["dns.google:443"]
    assert.throws(() => validateCiRuntimeManifest(dnsBroadened))

    const staleRuntime = structuredClone(manifest)
    staleRuntime.hardenRunner.runtime = "node20"
    assert.throws(() => validateCiRuntimeManifest(staleRuntime))

    const missingSecurityJob = structuredClone(manifest)
    missingSecurityJob.workflows[3].securityJobCount = 1
    assert.throws(() => validateCiRuntimeManifest(missingSecurityJob))
  })
})
