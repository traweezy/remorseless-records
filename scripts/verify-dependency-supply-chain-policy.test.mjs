import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  readTopLevelScalar,
  readYamlList,
  validatePolicyManifest,
  validateWorkspacePolicy,
} from "./verify-dependency-supply-chain-policy.mjs"

const hardenedWorkspace = `minimumReleaseAge: 10080
minimumReleaseAgeStrict: true
minimumReleaseAgeIgnoreMissingTime: false
trustLockfile: false
blockExoticSubdeps: true

minimumReleaseAgeExclude:
  - "secure-cli@1.2.3"

auditConfig:
  ignoreGhsas:
    - GHSA-aaaa-bbbb-cccc
`

describe("dependency supply-chain policy", () => {
  it("reads top-level scalars and nested lists without widening YAML scope", () => {
    assert.equal(
      readTopLevelScalar(hardenedWorkspace, "minimumReleaseAge"),
      10_080
    )
    assert.deepEqual(
      readYamlList(hardenedWorkspace, "minimumReleaseAgeExclude"),
      ["secure-cli@1.2.3"]
    )
    assert.deepEqual(readYamlList(hardenedWorkspace, "ignoreGhsas"), [
      "GHSA-aaaa-bbbb-cccc",
    ])
  })

  it("accepts the strict one-week workspace contract", () => {
    assert.doesNotThrow(() =>
      validateWorkspacePolicy(
        hardenedWorkspace,
        ["secure-cli@1.2.3"],
        "fixture"
      )
    )
  })

  it("rejects weakened or broadened workspace policy", () => {
    assert.throws(() =>
      validateWorkspacePolicy(
        hardenedWorkspace.replace("10080", "1440"),
        ["secure-cli@1.2.3"],
        "fixture"
      )
    )
    assert.throws(() =>
      validateWorkspacePolicy(
        hardenedWorkspace.replace(
          "trustLockfile: false",
          "trustLockfile: true"
        ),
        ["secure-cli@1.2.3"],
        "fixture"
      )
    )
    assert.throws(() =>
      validateWorkspacePolicy(hardenedWorkspace, ["secure-cli@*"], "fixture")
    )
    assert.throws(() =>
      validateWorkspacePolicy(
        hardenedWorkspace.replace(
          'minimumReleaseAgeExclude:\n  - "secure-cli@1.2.3"',
          'minimumReleaseAgeExclude: ["secure-cli@1.2.3"]'
        ),
        ["secure-cli@1.2.3"],
        "fixture"
      )
    )
    assert.throws(() =>
      validateWorkspacePolicy(
        `${hardenedWorkspace}\nminimumReleaseAge: 10080\n`,
        ["secure-cli@1.2.3"],
        "fixture"
      )
    )
  })

  it("rejects non-exact or incomplete exception manifests", () => {
    const policy = {
      coolingWindowMinutes: 10_080,
      coolingWindowExceptions: [
        {
          selector: "secure-cli@^1.2.3",
          publishedAt: "2026-08-27T01:09:44.541Z",
          reason:
            "A sufficiently detailed reason that explains the exact security exception and its operational impact.",
          evidence: ["package.json"],
        },
      ],
      auditIgnores: [
        ...[
          "GHSA-337j-9hxr-rhxg",
          "GHSA-4mjr-xmp4-gh2g",
          "GHSA-jjmj-jmhj-qwj2",
          "GHSA-wrjc-x8rr-h8h6",
          "GHSA-x5fp-wj9c-mxmx",
        ].map((id) => ({
          id,
          affectedPackages: ["react-router-dom@6.30.4"],
          reason:
            "A sufficiently detailed reason that explains the exact patched advisory and the behavioral evidence retained for it.",
          evidence: ["scripts/verify-react-router-security.mjs"],
        })),
      ],
    }

    assert.throws(() => validatePolicyManifest(policy))
    policy.coolingWindowExceptions[0].selector = "secure-cli@1.2.3"
    policy.auditIgnores[0].evidence = []
    assert.throws(() => validatePolicyManifest(policy))
  })
})
