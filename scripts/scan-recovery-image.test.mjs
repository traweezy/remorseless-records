import assert from "node:assert/strict"
import test from "node:test"
import { verifyRecoveryImageReport } from "./scan-recovery-image.mjs"
const imageId = `sha256:${"a".repeat(64)}`
const revision = "b".repeat(40)
const fixture = () => ({
  SchemaVersion: 2,
  ArtifactType: "container_image",
  Metadata: {
    ImageID: imageId,
    OS: { Family: "debian" },
    ImageConfig: {
      architecture: "amd64",
      os: "linux",
      config: {
        User: "65532:65532",
        Labels: {
          "org.opencontainers.image.revision": revision,
          "com.remorseless.postgresql.version": "16.15",
        },
      },
    },
  },
  Results: [
    { Class: "os-pkgs", Packages: [{}] },
    { Type: "node-pkg", Packages: [{}] },
  ],
})
test("recovery image scan binds revision, runtime user, inventory and all blocking severities", () => {
  assert.equal(verifyRecoveryImageReport(fixture(), imageId, revision).HIGH, 0)
  for (const severity of ["UNKNOWN", "HIGH", "CRITICAL", "unexpected"]) {
    const report = fixture()
    report.Results[0].Vulnerabilities = [{ Severity: severity }]
    assert.throws(() => verifyRecoveryImageReport(report, imageId, revision))
  }
  for (const mutate of [
    (r) => {
      r.Metadata.ImageID = "wrong"
    },
    (r) => {
      r.Metadata.ImageConfig.config.User = "0"
    },
    (r) => {
      r.Results.pop()
    },
    (r) => {
      r.Metadata.ImageConfig.config.Labels[
        "org.opencontainers.image.revision"
      ] = "wrong"
    },
  ]) {
    const report = fixture()
    mutate(report)
    assert.throws(() => verifyRecoveryImageReport(report, imageId, revision))
  }
})
