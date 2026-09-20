import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

import {
  validateCiRuntimeManifest,
  validateTrivyFilesystemGate,
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
          fail-on-high: true
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

  it("keeps the pinned runtime installer endpoint exact and blocked by default", () => {
    const runtimePolicy = manifest.workflows.find(
      ({ path }) => path === ".github/workflows/runtime-images.yml"
    )
    assert.ok(runtimePolicy.allowedEndpoints.includes("get.trivy.dev:443"))
    for (const changed of [
      runtimeWorkflow.replace("            get.trivy.dev:443\n", ""),
      runtimeWorkflow.replace("get.trivy.dev:443", "*.trivy.dev:443"),
      runtimeWorkflow.replace("get.trivy.dev:443", "get.trivy.dev:80"),
      runtimeWorkflow.replace("egress-policy: block", "egress-policy: audit"),
    ]) {
      assert.notEqual(changed, runtimeWorkflow)
      assert.throws(() =>
        validateWorkflowRuntimeSecurity(
          changed,
          runtimePolicy.allowedEndpoints,
          runtimePolicy.profile,
          runtimePolicy.securityJobCount
        )
      )
    }
  })

  it("rejects missing scan controls and drifted self-verification", () => {
    const detectorWith =
      "        uses: gensecaihq/Shai-Hulud-2.0-Detector@2755f94762bf5012bc7be82c93e172eabbcd0802 # v2.2.0\n        with:"
    for (const changed of [
      workflow.replace("fail-on-high: true\n", ""),
      workflow.replace("fail-on-high: true", "fail-on-high: false"),
      workflow.replace(
        detectorWith,
        detectorWith.replace(
          "\n        with:",
          "\n        continue-on-error: true\n        with:"
        )
      ),
      workflow.replace(
        detectorWith,
        detectorWith.replace(
          "\n        with:",
          "\n        if: false\n        with:"
        )
      ),
      workflow.replace(
        "fail-on-high: true\n",
        'fail-on-high: true\n          "fail-on-high": false\n'
      ),
    ])
      assert.throws(() => validateWorkflowRuntimeSecurity(changed, endpoints))
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

  it("fails filesystem scans on every HIGH/CRITICAL finding", () => {
    for (const name of ["root", "backend", "storefront"]) {
      const source = readFileSync(
        new URL(`../.github/workflows/${name}.yml`, import.meta.url),
        "utf8"
      )
      const isRoot = name === "root"
      assert.doesNotThrow(() => validateTrivyFilesystemGate(source, isRoot))
      for (const changed of [
        source.replace("ignore-unfixed: false", "ignore-unfixed: true"),
        source.replace("exit-code: 1", "exit-code: 0"),
        source.replace(
          "- name: Trivy FS scan (repo)",
          "- name: Trivy FS scan (repo)\n        continue-on-error: true"
        ),
      ]) {
        assert.notEqual(changed, source)
        assert.throws(() => validateTrivyFilesystemGate(changed, isRoot))
      }
    }
  })
})
