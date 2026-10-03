import assert from "node:assert/strict"
import test from "node:test"
import fs from "node:fs/promises"
import { syncBuiltinESMExports } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bracesBackport } from "./lib/braces-backport.mjs"
import {
  readPackageManifest,
  assertBackportWindow,
  countBracesExceptions,
  validateBracesProof,
} from "./lib/braces-backport-proof.mjs"
import {
  assessAuditFindings,
  assessFilesystemFindings,
} from "./verify-dependency-findings.mjs"
import { collectBracesImageProof } from "./lib/braces-image-proof.mjs"

const start = "2026-10-03T02:00:00.000Z"
const end = "2026-10-03T02:00:05.000Z"
const path = `app/node_modules/.pnpm/braces@3.0.3_patch_hash=${bracesBackport.patchSha256}/node_modules/braces/package.json`
const proof = () => ({
  advisory: bracesBackport.advisory,
  version: "3.0.3",
  patchSha256: bracesBackport.patchSha256,
  expiresAt: bracesBackport.expiresAt,
  startedAt: start,
  completedAt: end,
  packages: [
    {
      path,
      files: { ...bracesBackport.files },
      regression: "bounded-nesting-v1",
    },
  ],
})
const finding = () => ({
  VulnerabilityID: bracesBackport.advisory,
  PkgName: "braces",
  InstalledVersion: "3.0.3",
  Severity: "HIGH",
  PkgPath: path,
  PkgIdentifier: { PURL: "pkg:npm/braces@3.0.3" },
})
const report = (image = false) => ({
  SchemaVersion: 2,
  ArtifactType: image ? "container_image" : "filesystem",
  Results: [
    {
      Class: "lang-pkgs",
      Type: image ? "node-pkg" : "pnpm",
      Target: "pnpm-lock.yaml",
      Vulnerabilities: [finding()],
    },
  ],
})
const audit = () => ({
  metadata: {
    totalDependencies: 100,
    vulnerabilities: { info: 0, low: 0, moderate: 2, high: 1, critical: 0 },
  },
  advisories: {
    1: {
      github_advisory_id: bracesBackport.ghsa,
      module_name: "braces",
      severity: "high",
      findings: [{ version: "3.0.3", paths: ["backend>braces"] }],
    },
  },
})

test("the exact backport preserves raw High counts and requires proof", () => {
  const accepted = assessFilesystemFindings(report(), proof(), start, end)
  assert.equal(accepted.accepted, true)
  assert.equal(accepted.counts.HIGH, 1)
  assert.equal(accepted.verifiedBackportHigh, 1)
  assert.equal(
    assessFilesystemFindings(report(), null, start, end).accepted,
    false
  )
  assert.equal(assessAuditFindings(audit(), proof(), start, end).accepted, true)
  assert.equal(assessAuditFindings(audit(), null, start, end).accepted, false)
})
test("other vulnerabilities and High secrets still block", () => {
  for (const field of ["Vulnerabilities", "Secrets", "Misconfigurations"]) {
    const candidate = report()
    candidate.Results[0][field] ??= []
    candidate.Results[0][field].push({
      ...finding(),
      VulnerabilityID: "CVE-other",
    })
    assert.equal(
      assessFilesystemFindings(candidate, proof(), start, end).accepted,
      false
    )
  }
  for (const change of [
    { PkgName: "other" },
    { InstalledVersion: "3.0.2" },
    { FixedVersion: "3.0.4" },
    { Severity: "CRITICAL" },
    { Severity: "UNKNOWN" },
  ]) {
    const candidate = report()
    Object.assign(candidate.Results[0].Vulnerabilities[0], change)
    assert.equal(
      assessFilesystemFindings(candidate, proof(), start, end).accepted,
      false
    )
  }
  const candidate = report()
  candidate.Results[0].ModifiedFindings = [finding()]
  assert.throws(() => assessFilesystemFindings(candidate, proof(), start, end))
})
test("proof rejects drift, expiry, replay, omitted files and duplicate paths", () => {
  for (const mutate of [
    (p) => {
      p.patchSha256 = "0".repeat(64)
    },
    (p) => {
      p.packages[0].files["lib/parse.js"] = "0".repeat(64)
    },
    (p) => {
      delete p.packages[0].files["index.js"]
    },
    (p) => {
      p.packages[0].regression = "skipped"
    },
    (p) => {
      p.packages.push(p.packages[0])
    },
    (p) => {
      p.packages = []
    },
    (p) => {
      p.packages[0].path = "../outside/package.json"
    },
    (p) => {
      p.startedAt = "2026-10-02T00:00:00.000Z"
    },
    (p) => {
      p.completedAt = "2026-10-04T00:00:00.000Z"
    },
    (p) => {
      p.expiresAt = "2030-01-01T00:00:00.000Z"
    },
  ]) {
    const candidate = proof()
    mutate(candidate)
    assert.throws(() => validateBracesProof(candidate, start, end))
  }
  assert.throws(() =>
    assertBackportWindow(Date.parse(bracesBackport.approvedAt) - 1)
  )
  assert.throws(() =>
    assertBackportWindow(Date.parse(bracesBackport.expiresAt))
  )
  assert.doesNotThrow(() =>
    assertBackportWindow(Date.parse(bracesBackport.expiresAt) - 1)
  )
})
test("runtime findings must identify a verified image package path and purl", () => {
  assert.equal(
    countBracesExceptions(report(true), proof(), start, end, true),
    1
  )
  for (const mutate of [
    (r) => {
      r.Results[0].Vulnerabilities[0].PkgPath = "app/other/package.json"
    },
    (r) => {
      r.Results[0].Vulnerabilities[0].PkgIdentifier.PURL = "pkg:npm/other@3.0.3"
    },
  ]) {
    const candidate = report(true)
    mutate(candidate)
    assert.throws(() =>
      countBracesExceptions(candidate, proof(), start, end, true)
    )
  }
})
test("npm audit rejects altered identity, additional advisories and malformed evidence", () => {
  for (const mutate of [
    (r) => {
      r.advisories[1].module_name = "other"
    },
    (r) => {
      r.advisories[1].github_advisory_id = "GHSA-other"
    },
  ]) {
    const candidate = audit()
    mutate(candidate)
    assert.equal(
      assessAuditFindings(candidate, proof(), start, end).accepted,
      false
    )
  }
  for (const mutate of [
    (r) => {
      r.advisories[1].findings[0].version = "3.0.2"
    },
    (r) => {
      r.advisories[1].findings = []
    },
    (r) => {
      r.advisories = {}
    },
    (r) => {
      r.error = "unavailable"
    },
  ]) {
    const candidate = audit()
    mutate(candidate)
    assert.throws(() => assessAuditFindings(candidate, proof(), start, end))
  }
  const candidate = audit()
  candidate.advisories[2] = { severity: "moderate" }
  assert.equal(
    assessAuditFindings(candidate, proof(), start, end).accepted,
    false
  )
})
test("image verification uses immutable isolated containers and removes them after failure", async () => {
  const imageId = `sha256:${"a".repeat(64)}`
  for (const fails of [false, true]) {
    const calls = []
    const execute = async (_command, args) => {
      calls.push(args)
      if (args[2] === "create") return "b".repeat(64)
      if (args[2] === "start") {
        if (fails) throw new Error("bounded failure")
        return JSON.stringify(proof())
      }
      if (args[2] === "inspect") return "exited 0"
      return ""
    }
    if (fails)
      await assert.rejects(
        collectBracesImageProof(execute, "unix:///var/run/docker.sock", imageId)
      )
    else
      assert.deepEqual(
        await collectBracesImageProof(
          execute,
          "unix:///var/run/docker.sock",
          imageId
        ),
        proof()
      )
    const create = calls[0]
    for (const flag of [
      "--read-only",
      "--cap-drop",
      "--network",
      "none",
      "NODE_OPTIONS=",
      "NODE_PATH=",
      imageId,
    ])
      assert.ok(create.includes(flag))
    assert.equal(calls.at(-1)[2], "rm")
    assert.equal(calls.at(-1).at(-1), "b".repeat(64))
  }
})

test("manifest inventory accepts package hard links and rejects links, empty and oversized files", async (t) => {
  const directory = await fs.mkdtemp(join(tmpdir(), "rr-manifest-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const path = join(directory, "package.json")
  const data = '{"name":"braces","version":"3.0.3"}'
  await fs.writeFile(path, data)
  await fs.link(path, join(directory, "hardlink.json"))
  assert.deepEqual(await readPackageManifest(path), JSON.parse(data))
  await fs.symlink(path, join(directory, "linked.json"))
  await assert.rejects(readPackageManifest(join(directory, "linked.json")))
  await fs.writeFile(path, "")
  await assert.rejects(readPackageManifest(path))
  await fs.writeFile(path, Buffer.alloc(2097153))
  await assert.rejects(readPackageManifest(path))
})
for (const mutation of ["replace", "grow", "rewrite", "parent"]) {
  test(`manifest inventory rejects ${mutation} during descriptor reading`, async (t) => {
    const directory = await fs.mkdtemp(join(tmpdir(), "rr-manifest-race-"))
    t.after(() => fs.rm(directory, { recursive: true, force: true }))
    const parent = join(directory, "packages")
    await fs.mkdir(parent)
    const path = join(parent, "package.json")
    const data = '{"name":"braces","version":"3.0.3"}'
    await fs.writeFile(path, data)
    const realOpen = fs.open
    let changed = false
    fs.open = async (...args) => {
      const handle = await realOpen(...args)
      if (String(args[0]).endsWith("/package.json")) {
        const read = handle.read.bind(handle)
        handle.read = async (...readArgs) => {
          if (!changed) {
            changed = true
            if (mutation === "replace") {
              await fs.rename(path, join(parent, "old.json"))
              await fs.writeFile(path, data)
            } else if (mutation === "grow") await fs.appendFile(path, " ")
            else if (mutation === "rewrite")
              await fs.writeFile(path, data.replace("3.0.3", "3.0.2"))
            else {
              await fs.rename(parent, join(directory, "original"))
              await fs.mkdir(parent)
              await fs.writeFile(path, data)
            }
          }
          return read(...readArgs)
        }
      }
      return handle
    }
    syncBuiltinESMExports()
    try {
      await assert.rejects(readPackageManifest(path))
      assert.equal(changed, true)
    } finally {
      fs.open = realOpen
      syncBuiltinESMExports()
    }
  })
}
