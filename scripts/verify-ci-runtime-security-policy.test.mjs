import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"

import {
  validateCiRuntimeManifest,
  validateTrufflehogGate,
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

  it("keeps reviewed runtime registry and installer endpoints exact", () => {
    const runtimePolicy = manifest.workflows.find(
      ({ path }) => path === ".github/workflows/runtime-images.yml"
    )
    assert.ok(
      runtimePolicy.allowedEndpoints.some(
        (endpoint) => endpoint === "get.trivy.dev:443"
      )
    )
    assert.ok(
      runtimePolicy.allowedEndpoints.some(
        (endpoint) => endpoint === "gcr.io:443"
      )
    )
    for (const changed of [
      runtimeWorkflow.replace("            get.trivy.dev:443\n", ""),
      runtimeWorkflow.replace("get.trivy.dev:443", "*.trivy.dev:443"),
      runtimeWorkflow.replace("get.trivy.dev:443", "get.trivy.dev:80"),
      runtimeWorkflow.replace("            gcr.io:443\n", ""),
      runtimeWorkflow.replace("gcr.io:443", "*.gcr.io:443"),
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

    const movingScanner = structuredClone(manifest)
    movingScanner.trufflehogScanner.version = "latest"
    assert.throws(() => validateCiRuntimeManifest(movingScanner))

    const unreviewedScanner = structuredClone(manifest)
    unreviewedScanner.trufflehogScanner.digest = `sha256:${"a".repeat(64)}`
    assert.throws(() => validateCiRuntimeManifest(unreviewedScanner))

    const unreviewedAction = structuredClone(manifest)
    unreviewedAction.trufflehogAction.commit = "a".repeat(40)
    assert.throws(() => validateCiRuntimeManifest(unreviewedAction))
  })

  it("pins every secret scanner and rejects skipped or weakened scans", () => {
    const scannerVersion = `version: ${manifest.trufflehogScanner.version}@${manifest.trufflehogScanner.digest}`
    const actionUse = `uses: ${manifest.trufflehogAction.repository}@${manifest.trufflehogAction.commit} # ${manifest.trufflehogAction.version}`
    for (const name of ["root", "backend", "storefront"]) {
      const source = readFileSync(
        new URL(`../.github/workflows/${name}.yml`, import.meta.url),
        "utf8"
      )
      assert.doesNotThrow(() => validateTrufflehogGate(source))
      const changes = [
        ["moving version", source.replace(scannerVersion, "version: latest")],
        [
          "tag without digest",
          source.replace(scannerVersion, "version: 3.97.9"),
        ],
        [
          "missing version",
          source.replace(`          ${scannerVersion}\n`, ""),
        ],
        [
          "different image digest",
          source.replace(
            manifest.trufflehogScanner.digest,
            `sha256:${"a".repeat(64)}`
          ),
        ],
        [
          "different registry",
          source.replace(
            manifest.trufflehogScanner.image,
            "example.com/scanner"
          ),
        ],
        [
          "unreviewed action",
          source.replace(manifest.trufflehogAction.commit, "a".repeat(40)),
        ],
        [
          "step skip condition",
          source.replace(actionUse, `if: false\n        ${actionUse}`),
        ],
        [
          "step failure suppression",
          source.replace(
            actionUse,
            `continue-on-error: true\n        ${actionUse}`
          ),
        ],
        [
          "job skip condition",
          source.replace("  secrets:\n", "  secrets:\n    if: false\n"),
        ],
        [
          "quoted job skip condition",
          source.replace("  secrets:\n", '  secrets:\n    "if": false\n'),
        ],
        [
          "job failure suppression",
          source.replace(
            "  secrets:\n",
            "  secrets:\n    continue-on-error: true\n"
          ),
        ],
        [
          "history truncation",
          source.replace(/(^  secrets:\n[\s\S]*?fetch-depth:) 0/mu, "$1 1"),
        ],
        [
          "scan exclusion",
          source.replace(
            "extra_args: --only-verified",
            "extra_args: --only-verified --exclude-detectors=Resend"
          ),
        ],
        [
          "disabled verification",
          source.replace(
            "extra_args: --only-verified",
            "extra_args: --no-verification"
          ),
        ],
        [
          "base range override",
          source.replace(
            "extra_args: --only-verified",
            "base: HEAD~1\n          extra_args: --only-verified"
          ),
        ],
        [
          "duplicate version key",
          source.replace(
            scannerVersion,
            `${scannerVersion}\n          version: latest`
          ),
        ],
      ]
      for (const [reason, changed] of changes) {
        assert.notEqual(changed, source, `${name}: exercise ${reason}`)
        assert.throws(
          () => validateTrufflehogGate(changed),
          `${name}: reject ${reason}`
        )
      }
    }
  })

  it("requires raw filesystem reports and an unskipped byte-bound acceptance gate", () => {
    for (const name of ["root", "backend", "storefront"]) {
      const source = readFileSync(
        new URL(`../.github/workflows/${name}.yml`, import.meta.url),
        "utf8"
      )
      const isRoot = name === "root"
      assert.doesNotThrow(() => validateTrivyFilesystemGate(source, isRoot))
      for (const changed of [
        source.replace("ignore-unfixed: false", "ignore-unfixed: true"),
        source.replace(
          "        run: node scripts/verify-dependency-findings.mjs filesystem",
          "        continue-on-error: true\n        run: node scripts/verify-dependency-findings.mjs filesystem"
        ),
        source.replace("exit-code: 0", "exit-code: 1"),
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
