import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { syncBuiltinESMExports } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  cleanupEvidenceCache,
  checkedEvidenceDirectory,
  createEvidenceDirectory,
  decodeEvidence,
  evidenceDigest,
  hashEvidenceFile,
  readEvidenceFile,
  resolveRuntimeScanner,
  runRuntimeEvidenceCommand,
  sha256,
  writeEvidenceFile,
} from "./lib/runtime-image-evidence.mjs"
import { finalizeRuntimeImagePublication } from "./finalize-runtime-image-publication.mjs"
import {
  parseRuntimeScanArguments,
  scanRuntimeImage,
} from "./scan-runtime-image.mjs"
import {
  runtimeEvidencePolicy as policy,
  runtimeFindingPolicy,
  summarizeRuntimeVulnerabilities,
  validateCurrentRuntimeImageRecord,
  validatePublishedManifest,
  validateRuntimeImageRecord,
  validateRuntimeImageSbom,
  verifyRuntimeImageArtifacts,
} from "./verify-runtime-image-artifacts.mjs"
import { buildRuntimeImageRecord } from "./write-runtime-image-record.mjs"

const revision = "a".repeat(40)
const imageId = `sha256:${"b".repeat(64)}`
const identity = { service: "backend", revision, imageId }
const startedAt = "2026-09-14T12:00:00.125Z"
const completedAt = "2026-09-14T12:00:05.125Z"
const metadata = {
  Version: 2,
  NextUpdate: "2026-09-15T00:00:00Z",
  UpdatedAt: "2026-09-14T00:00:00Z",
  DownloadedAt: "2026-09-14T11:59:00Z",
}
const encode = (value) => Buffer.from(`${JSON.stringify(value)}\n`)
const binary = { bytes: 1024, sha256: policy.trivy.binarySha256 }
const fixture = () => {
  const report = {
    SchemaVersion: 2,
    CreatedAt: "2026-09-14T12:00:01Z",
    ArtifactName: imageId,
    ArtifactType: "container_image",
    Metadata: {
      ImageID: imageId,
      OS: { Family: "debian" },
      ImageConfig: {
        architecture: "amd64",
        os: "linux",
        config: {
          Labels: {
            "org.opencontainers.image.revision": revision,
            "org.opencontainers.image.source": policy.repository,
          },
        },
      },
    },
    Results: [
      {
        Class: "os-pkgs",
        Type: "debian",
        Packages: [
          {
            Name: "example",
            Version: "1",
            Identifier: { PURL: "pkg:deb/debian/example@1-1?arch=amd64" },
          },
        ],
        Vulnerabilities: [],
      },
      {
        Class: "lang-pkgs",
        Type: "node-pkg",
        Packages: [
          {
            Name: "@example/package",
            Version: "2",
            Identifier: { PURL: "pkg:npm/%40example/package@2" },
          },
        ],
      },
    ],
  }
  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    serialNumber: "urn:uuid:11111111-2222-3333-4444-555555555555",
    metadata: {
      timestamp: "2026-09-14T12:00:00Z",
      component: {
        type: "container",
        name: imageId,
        properties: [
          { name: "aquasecurity:trivy:ImageID", value: imageId },
          {
            name: "aquasecurity:trivy:Labels:org.opencontainers.image.revision",
            value: revision,
          },
          {
            name: "aquasecurity:trivy:Labels:org.opencontainers.image.source",
            value: policy.repository,
          },
        ],
      },
    },
    components: [
      {
        type: "library",
        name: "example",
        version: "1-1",
        purl: "pkg:deb/debian/example@1-1?arch=amd64",
      },
      {
        type: "library",
        group: "@example",
        name: "package",
        version: "2",
        purl: "pkg:npm/%40example/package@2",
      },
    ],
  }
  const dbSource = encode(metadata)
  const snapshot = {
    data: { bytes: 2, sha256: sha256("db") },
    metadata: { bytes: dbSource.length, sha256: sha256(dbSource) },
  }
  const { inventory: _inventory, ...summary } = summarizeRuntimeVulnerabilities(
    report,
    identity
  )
  const record = buildRuntimeImageRecord({
    ...identity,
    scan: {
      scanner: { version: "0.70.0", binary },
      database: {
        repository: `${policy.trivy.databaseRepository}:2`,
        version: 2,
        updatedAt: metadata.UpdatedAt,
        nextUpdate: metadata.NextUpdate,
        downloadedAt: metadata.DownloadedAt,
        before: snapshot,
        after: structuredClone(snapshot),
      },
      startedAt,
      completedAt,
      policy: runtimeFindingPolicy,
      ...summary,
      accepted: true,
    },
    reports: {
      vulnerabilities: evidenceDigest("backend.vuln.json", encode(report)),
      sbom: evidenceDigest("backend.cdx.json", encode(sbom)),
      databaseMetadata: evidenceDigest("backend.db.json", dbSource),
    },
  })
  return { record, report, sbom, dbSource }
}
const addFinding = (candidate, severity, fixedVersion) => {
  candidate.report.Results[0].Vulnerabilities.push({
    VulnerabilityID: "CVE-example",
    PkgName: "example",
    InstalledVersion: "1",
    Severity: severity,
    ...(fixedVersion ? { FixedVersion: fixedVersion } : {}),
  })
}
const privateRoot = async (t) => {
  const directory = await fs.mkdtemp(join(tmpdir(), "rr-evidence-test-"))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  return directory
}
const writeFixture = async (directory, candidate = fixture()) => {
  for (const [name, source] of [
    ["backend.image.json", encode(candidate.record)],
    ["backend.vuln.json", encode(candidate.report)],
    ["backend.cdx.json", encode(candidate.sbom)],
    ["backend.db.json", candidate.dbSource],
  ])
    await writeEvidenceFile(directory, name, source)
  return join(directory, "backend.image.json")
}

test("verifies exact clean report, SBOM, scanner and DB bytes", async (t) => {
  const { record, sbom } = fixture()
  validateRuntimeImageRecord(record)
  validateRuntimeImageSbom(sbom, record, [
    "pkg:deb/debian/example@1-1?arch=amd64",
  ])
  const directory = await privateRoot(t)
  assert.deepEqual(
    await verifyRuntimeImageArtifacts(await writeFixture(directory)),
    record
  )
})
test("requires current scan and DB evidence only at the publication boundary", async (t) => {
  const root = await privateRoot(t)
  const directory = join(root, "evidence")
  await createEvidenceDirectory(directory)
  const path = await writeFixture(directory)
  const completion = Date.parse(completedAt)
  const current = {
    requireCurrent: true,
    now: () => completion + 30 * 60 * 1000,
  }
  assert.deepEqual(
    await verifyRuntimeImageArtifacts(path, current),
    fixture().record
  )
  for (const now of [completion - 1, completion + 30 * 60 * 1000 + 1]) {
    await assert.rejects(
      verifyRuntimeImageArtifacts(path, {
        requireCurrent: true,
        now: () => now,
      })
    )
    assert.deepEqual(await verifyRuntimeImageArtifacts(path), fixture().record)
  }
  const expired = fixture().record
  expired.scan.database.nextUpdate = new Date(completion + 1000).toISOString()
  assert.throws(() =>
    validateCurrentRuntimeImageRecord(expired, completion + 1000)
  )
  const aged = fixture().record
  aged.scan.database.updatedAt = new Date(
    completion - 48 * 60 * 60 * 1000 + 1000
  ).toISOString()
  assert.throws(() =>
    validateCurrentRuntimeImageRecord(aged, completion + 2000)
  )
})
const recordMutations = [
  [
    "legacy record",
    (r) => {
      r.schemaVersion = 1
    },
  ],
  [
    "unknown field",
    (r) => {
      r.extra = true
    },
  ],
  [
    "short digest",
    (r) => {
      r.digest = "sha256:short"
    },
  ],
  [
    "other image",
    (r) => {
      r.imageId = `sha256:${"c".repeat(64)}`
    },
  ],
  [
    "branch revision",
    (r) => {
      r.revision = "staging"
    },
  ],
  [
    "unknown service",
    (r) => {
      r.service = "worker"
    },
  ],
  [
    "wrong scanner",
    (r) => {
      r.scan.scanner.version = "0.69.0"
    },
  ],
  [
    "binary drift",
    (r) => {
      r.scan.scanner.binary.sha256 = "c".repeat(64)
    },
  ],
  [
    "DB byte drift",
    (r) => {
      r.scan.database.after.data.sha256 = "c".repeat(64)
    },
  ],
  [
    "DB metadata drift",
    (r) => {
      r.scan.database.after.metadata.bytes++
    },
  ],
  [
    "alternate DB",
    (r) => {
      r.scan.database.repository = "example.com/db:2"
    },
  ],
  [
    "stale DB",
    (r) => {
      r.scan.database.updatedAt = "2026-09-11T00:00:00Z"
    },
  ],
  [
    "expired DB",
    (r) => {
      r.scan.database.nextUpdate = startedAt
    },
  ],
  [
    "future download",
    (r) => {
      r.scan.database.downloadedAt = completedAt
    },
  ],
  [
    "reversed interval",
    (r) => {
      r.scan.startedAt = "2026-09-14T12:01:00Z"
    },
  ],
  [
    "long interval",
    (r) => {
      r.scan.completedAt = "2026-09-14T12:11:00Z"
    },
  ],
  [
    "invalid timestamp",
    (r) => {
      r.scan.startedAt = "invalid"
    },
  ],
  [
    "DB too big",
    (r) => {
      r.scan.database.before.data.bytes = 5 * 1024 ** 3
    },
  ],
  [
    "finding relaxation",
    (r) => {
      r.scan.policy.severities = ["CRITICAL"]
    },
  ],
  [
    "fixed high",
    (r) => {
      r.scan.counts.HIGH = 1
      r.scan.fixedHighCritical = 1
      r.scan.accepted = false
    },
  ],
  [
    "forged acceptance",
    (r) => {
      r.scan.counts.HIGH = 1
      r.scan.fixedHighCritical = 1
    },
  ],
  [
    "negative findings",
    (r) => {
      r.scan.counts.HIGH = -1
    },
  ],
  [
    "empty coverage",
    (r) => {
      r.scan.coverage = []
    },
  ],
  [
    "missing OS",
    (r) => {
      r.scan.coverage[0].type = "alpine"
    },
  ],
  [
    "missing library",
    (r) => {
      r.scan.coverage[1].type = "other"
    },
  ],
  [
    "traversal",
    (r) => {
      r.reports.sbom.file = "../outside.json"
    },
  ],
  [
    "wrong metadata hash",
    (r) => {
      r.reports.databaseMetadata.sha256 = "c".repeat(64)
    },
  ],
  [
    "unbound publication",
    (r) => {
      r.publication = {}
    },
  ],
]
for (const [name, mutate] of recordMutations)
  test(`rejects ${name}`, () => {
    const record = structuredClone(fixture().record)
    mutate(record)
    assert.throws(() => validateRuntimeImageRecord(record))
  })
for (const [name, mutate] of [
  [
    "report subject",
    (f) => {
      f.report.ArtifactName = "tag"
    },
  ],
  [
    "report image config",
    (f) => {
      f.report.Metadata.ImageConfig.architecture = "arm64"
    },
  ],
  [
    "hidden findings",
    (f) => {
      f.report.Results[0].ModifiedFindings = [{}]
    },
  ],
  [
    "unknown severity",
    (f) => {
      addFinding(f, "HIGH")
      f.report.Results[0].Vulnerabilities[0].Severity = "other"
    },
  ],
  [
    "missing packages",
    (f) => {
      f.report.Results[0].Packages = []
    },
  ],
  [
    "SBOM omitted package",
    (f) => {
      f.sbom.components = [f.sbom.components[1]]
    },
  ],
  [
    "duplicate SBOM identity",
    (f) => {
      f.sbom.metadata.component.properties.push(
        f.sbom.metadata.component.properties[0]
      )
    },
  ],
  [
    "old SBOM",
    (f) => {
      f.sbom.metadata.timestamp = "2026-09-14T11:59:59Z"
    },
  ],
])
  test(`rejects ${name} even with refreshed file hashes`, async (t) => {
    const candidate = fixture()
    mutate(candidate)
    candidate.record.reports.vulnerabilities = evidenceDigest(
      "backend.vuln.json",
      encode(candidate.report)
    )
    candidate.record.reports.sbom = evidenceDigest(
      "backend.cdx.json",
      encode(candidate.sbom)
    )
    await assert.rejects(
      verifyRuntimeImageArtifacts(
        await writeFixture(await privateRoot(t), candidate)
      )
    )
  })
test("rejects tampered report bytes and invalid UTF-8", async (t) => {
  const directory = await privateRoot(t)
  const path = await writeFixture(directory)
  await fs.appendFile(join(directory, "backend.vuln.json"), " ")
  await assert.rejects(verifyRuntimeImageArtifacts(path))
  assert.throws(() => decodeEvidence(Buffer.from([0x22, 0xff, 0x22])))
})

const manifest = () => ({
  schemaVersion: 2,
  mediaType: "application/vnd.oci.image.manifest.v1+json",
  config: {
    mediaType: "application/vnd.oci.image.config.v1+json",
    digest: imageId,
    size: 123,
  },
  layers: [
    {
      mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
      digest: `sha256:${"d".repeat(64)}`,
      size: 456,
    },
  ],
})
test("binds independently observed registry descriptor and exact raw manifest to scanned image config", async (t) => {
  const directory = await privateRoot(t)
  const path = await writeFixture(directory)
  const raw = encode(manifest())
  const descriptor = {
    mediaType: manifest().mediaType,
    size: raw.length,
    digest: `sha256:${sha256(raw)}`,
  }
  const calls = []
  const published = await finalizeRuntimeImagePublication(path, {
    run: async (command, args, options) => {
      calls.push([command, args])
      assert.deepEqual(Object.keys(options.environment).sort(), [
        "HOME",
        "LANG",
        "PATH",
      ])
      return args.includes("--raw") ? raw : encode(descriptor)
    },
  })
  assert.equal(published.digest, descriptor.digest)
  assert.equal(calls[1][1].at(-1), `${published.subject}@${descriptor.digest}`)
  assert.deepEqual(
    await verifyRuntimeImageArtifacts(
      join(directory, "backend.published.image.json")
    ),
    published
  )
  assert.deepEqual(
    await readEvidenceFile(join(directory, "backend.manifest.json")),
    raw
  )
  assert.deepEqual(await verifyRuntimeImageArtifacts(path), fixture().record)
})
for (const [name, mutate] of [
  [
    "config drift",
    (m) => {
      m.config.digest = `sha256:${"e".repeat(64)}`
    },
  ],
  [
    "image index",
    (m) => {
      m.mediaType = "application/vnd.oci.image.index.v1+json"
      m.manifests = []
    },
  ],
  [
    "foreign layer",
    (m) => {
      m.layers[0].urls = ["https://example.com/layer"]
    },
  ],
  [
    "missing layers",
    (m) => {
      m.layers = []
    },
  ],
])
  test(`rejects published ${name}`, () => {
    const value = manifest()
    mutate(value)
    assert.throws(() =>
      validatePublishedManifest(encode(value), fixture().record)
    )
  })
test("rejects descriptor hash/size mismatch before writing publication evidence", async (t) => {
  for (const mismatch of ["digest", "size"]) {
    const directory = join(await privateRoot(t), "evidence")
    await createEvidenceDirectory(directory)
    const path = await writeFixture(directory)
    const raw = encode(manifest())
    const descriptor = {
      mediaType: manifest().mediaType,
      size: raw.length,
      digest: `sha256:${sha256(raw)}`,
      [mismatch]: mismatch === "size" ? 1 : `sha256:${"e".repeat(64)}`,
    }
    await assert.rejects(
      finalizeRuntimeImagePublication(path, {
        run: async (_command, args) =>
          args.includes("--raw") ? raw : encode(descriptor),
      })
    )
    await assert.rejects(
      fs.lstat(join(directory, "backend.published.image.json")),
      { code: "ENOENT" }
    )
  }
})

const fakeSession = async (t, change = {}) => {
  const root = await privateRoot(t)
  const options = { ...identity, output: join(root, "evidence") }
  const candidate = fixture()
  const databaseMetadata = change.databaseMetadata ?? metadata
  change.candidate?.(candidate)
  let cache
  let downloaded = false
  let inspectCount = 0
  let scannerCount = 0
  const calls = []
  const scanner = { path: "/reviewed/trivy", ...binary }
  const run = async (command, args, controls) => {
    calls.push({ command, args, environment: controls.environment })
    controls.signal.throwIfAborted()
    assert.equal(controls.environment.TRIVY_SKIP_DB_UPDATE, undefined)
    assert.equal(controls.environment.APP_SECRET, undefined)
    assert.equal(controls.environment.DOCKER_CONTEXT, undefined)
    if (command === "docker") {
      if (args.includes("context")) return encode("unix:///var/run/docker.sock")
      inspectCount++
      return encode({
        id:
          inspectCount > 1 && change.imageDrift
            ? `sha256:${"e".repeat(64)}`
            : imageId,
        os: "linux",
        architecture: "amd64",
        user: change.imageUser ?? "1000:1000",
        revision,
        source: policy.repository,
      })
    }
    cache = args[args.indexOf("--cache-dir") + 1]
    if (args.includes("--version"))
      return encode({
        Version: "0.70.0",
        ...(downloaded ? { VulnerabilityDB: databaseMetadata } : {}),
      })
    if (args.includes("--download-db-only")) {
      if (change.downloadFailure) throw new Error("download failed")
      await fs.mkdir(join(cache, "db"), { mode: 0o755 })
      await fs.writeFile(join(cache, "db", "trivy.db"), "db", { mode: 0o644 })
      await fs.writeFile(
        join(cache, "db", "metadata.json"),
        encode(databaseMetadata),
        { mode: 0o644 }
      )
      downloaded = true
      return Buffer.alloc(0)
    }
    assert.ok(
      args.includes("--skip-db-update") &&
        args.includes("--ignore-unfixed=false") &&
        args.includes("--list-all-pkgs") &&
        args.includes("--offline-scan")
    )
    assert.equal(args.at(-1), imageId)
    if (args.includes("cyclonedx")) {
      if (change.sbomFailure) throw new Error("sbom failed")
      if (change.dbDrift) {
        await fs.chmod(join(cache, "db", "trivy.db"), 0o600)
        await fs.writeFile(join(cache, "db", "trivy.db"), "xx")
      }
      return encode(candidate.sbom)
    }
    if (change.scanFailure) throw new Error("scan failed")
    return encode(candidate.report)
  }
  let clock = 0
  const dependencies = {
    run,
    now: () => Date.parse(clock++ ? completedAt : startedAt),
    environment: {
      HOME: root,
      PATH: "/reviewed",
      DOCKER_HOST: "unix:///var/run/docker.sock",
      TRIVY_SKIP_DB_UPDATE: "true",
      APP_SECRET: "synthetic",
      DOCKER_CONTEXT: "unrelated",
    },
    resolveScanner: async () => ({
      ...scanner,
      sha256:
        scannerCount++ && change.scannerDrift ? "e".repeat(64) : scanner.sha256,
    }),
    ...change.dependencies,
  }
  return { options, dependencies, calls, cache: () => cache }
}
test("collects one fresh immutable DB session and cleans its private cache", async (t) => {
  const setup = await fakeSession(t)
  const result = await scanRuntimeImage(setup.options, setup.dependencies)
  assert.equal(result.fixedHighCritical, 0)
  assert.equal(result.counts.HIGH, 0)
  assert.equal(
    setup.calls.filter((call) => call.args.includes("--download-db-only"))
      .length,
    1
  )
  assert.equal(
    setup.calls.filter((call) => call.args.includes("--skip-db-update")).length,
    2
  )
  assert.deepEqual(
    await verifyRuntimeImageArtifacts(
      join(setup.options.output, "backend.image.json")
    ),
    fixture().record
  )
  await assert.rejects(fs.lstat(setup.cache()), { code: "ENOENT" })
})
test("rejects a runtime image that changes its non-root identity", async (t) => {
  const setup = await fakeSession(t, { imageUser: "node" })
  await assert.rejects(scanRuntimeImage(setup.options, setup.dependencies), {
    phase: "image_identity",
  })
})
test("reports bounded expired DB details and still rejects the scan", async (t) => {
  const expired = {
    ...metadata,
    NextUpdate: "2026-09-14T07:03:12Z",
  }
  const setup = await fakeSession(t, { databaseMetadata: expired })
  await assert.rejects(scanRuntimeImage(setup.options, setup.dependencies), {
    phase: "freeze_database",
    reasonCode: "database_expired",
  })
  assert.deepEqual(
    decodeEvidence(
      await readEvidenceFile(join(setup.options.output, "failure.json"))
    ),
    {
      event: "runtime.image.failed",
      phase: "freeze_database",
      reasonCode: "database_expired",
      database: {
        repository: "ghcr.io/aquasecurity/trivy-db:2",
        updatedAt: metadata.UpdatedAt.replace("Z", ".000Z"),
        nextUpdate: "2026-09-14T07:03:12.000Z",
      },
    }
  )
  assert.equal(
    setup.calls.some((call) => call.args.includes("--skip-db-update")),
    false
  )
  await assert.rejects(fs.lstat(setup.cache()), { code: "ENOENT" })
})
for (const change of [
  "imageDrift",
  "scannerDrift",
  "dbDrift",
  "downloadFailure",
  "scanFailure",
  "sbomFailure",
])
  test(`fails closed and cleans cache after ${change}`, async (t) => {
    const setup = await fakeSession(t, { [change]: true })
    await assert.rejects(scanRuntimeImage(setup.options, setup.dependencies))
    assert.equal(
      decodeEvidence(
        await readEvidenceFile(join(setup.options.output, "failure.json"))
      ).event,
      "runtime.image.failed"
    )
    await assert.rejects(fs.lstat(setup.cache()), { code: "ENOENT" })
  })
for (const [severity, fixedVersion] of [
  ["UNKNOWN", undefined],
  ["HIGH", undefined],
  ["HIGH", "2"],
  ["CRITICAL", undefined],
  ["CRITICAL", "2"],
])
  test(`retains rejected ${severity} evidence with fixed version ${fixedVersion ?? "absent"}`, async (t) => {
    const setup = await fakeSession(t, {
      candidate: (f) => addFinding(f, severity, fixedVersion),
    })
    await assert.rejects(scanRuntimeImage(setup.options, setup.dependencies))
    const path = join(setup.options.output, "backend.image.json")
    await assert.rejects(verifyRuntimeImageArtifacts(path))
    const evidence = await verifyRuntimeImageArtifacts(path, {
      requireAccepted: false,
    })
    assert.equal(evidence.scan.accepted, false)
    assert.equal(evidence.scan.counts[severity], 1)
    assert.equal(evidence.scan.fixedHighCritical, fixedVersion ? 1 : 0)
    assert.equal(
      decodeEvidence(
        await readEvidenceFile(join(setup.options.output, "failure.json"))
      ).event,
      "runtime.image.failed"
    )
  })
test("rejects pre-cancelled sessions, remote Docker endpoints, and bad CLI flags", async (t) => {
  const setup = await fakeSession(t)
  await assert.rejects(
    scanRuntimeImage(setup.options, {
      ...setup.dependencies,
      signal: AbortSignal.abort(),
    })
  )
  await assert.rejects(fs.lstat(setup.options.output), { code: "ENOENT" })
  await assert.rejects(
    scanRuntimeImage(setup.options, {
      ...setup.dependencies,
      environment: {
        ...setup.dependencies.environment,
        DOCKER_HOST: "tcp://remote:2375",
      },
    })
  )
  assert.deepEqual(parseRuntimeScanArguments(["--help"]), { help: true })
  const args = [
    "--service",
    "backend",
    "--revision",
    revision,
    "--image-id",
    imageId,
    "--output",
    setup.options.output,
  ]
  assert.deepEqual(parseRuntimeScanArguments(args), setup.options)
  for (const input of [
    [],
    [...args, "--ignored"],
    args.map((value) => (value === "--image-id" ? "--service" : value)),
    args.map((value) => (value === "backend" ? "worker" : value)),
  ])
    assert.throws(() => parseRuntimeScanArguments(input))
})

test("rejects symbolic links, hard links, public modes and oversized evidence", async (t) => {
  const root = await privateRoot(t)
  const directory = join(root, "evidence")
  await createEvidenceDirectory(directory)
  const file = join(directory, "report.json")
  await writeEvidenceFile(directory, "report.json", "{}")
  await assert.rejects(writeEvidenceFile(directory, "report.json", "{}"), {
    code: "EEXIST",
  })
  await assert.rejects(writeEvidenceFile(directory, "../other.json", "{}"))
  await fs.symlink(file, join(directory, "link.json"))
  await assert.rejects(readEvidenceFile(join(directory, "link.json")))
  await fs.link(file, join(directory, "hard.json"))
  await assert.rejects(readEvidenceFile(file))
  await fs.unlink(join(directory, "hard.json"))
  await fs.chmod(file, 0o644)
  await assert.rejects(readEvidenceFile(file))
  await fs.chmod(file, 0o600)
  await assert.rejects(readEvidenceFile(file, 1))
  await assert.rejects(hashEvidenceFile(file, 1))
  await fs.symlink(directory, join(root, "alias"))
  await assert.rejects(readEvidenceFile(join(root, "alias", "report.json")))
  await fs.chmod(directory, 0o755)
  await assert.rejects(readEvidenceFile(file))
})
for (const operation of ["read", "write", "hash"])
  test(`directory replacement cannot redirect ${operation} outside its opened parent`, async (t) => {
    const root = await privateRoot(t)
    const directory = join(root, "evidence")
    const outside = join(root, "outside")
    await createEvidenceDirectory(directory)
    await createEvidenceDirectory(outside)
    await writeEvidenceFile(directory, "report.json", "original")
    await writeEvidenceFile(outside, "report.json", "outside")
    const realOpen = fs.open
    let swapped = false
    fs.open = async (file, ...args) => {
      if (String(file).startsWith("/proc/self/fd/") && !swapped) {
        swapped = true
        await fs.rename(directory, join(root, "renamed"))
        await fs.symlink(outside, directory)
      }
      return realOpen(file, ...args)
    }
    syncBuiltinESMExports()
    try {
      await assert.rejects(
        operation === "read"
          ? readEvidenceFile(join(directory, "report.json"))
          : operation === "hash"
            ? hashEvidenceFile(join(directory, "report.json"), 1024)
            : writeEvidenceFile(directory, "new.json", "owned")
      )
      assert.equal(swapped, true)
      assert.equal(
        await fs.readFile(join(outside, "report.json"), "utf8"),
        "outside"
      )
      await assert.rejects(fs.lstat(join(outside, "new.json")), {
        code: "ENOENT",
      })
    } finally {
      fs.open = realOpen
      syncBuiltinESMExports()
    }
  })
test("detects same-size writes whose mtime was restored", async (t) => {
  const directory = await privateRoot(t)
  const file = join(directory, "report.json")
  await writeEvidenceFile(directory, "report.json", "original")
  const realOpen = fs.open
  fs.open = async (...args) => {
    const handle = await realOpen(...args)
    if (String(args[0]).endsWith("/report.json")) {
      const realStream = handle.createReadStream.bind(handle)
      handle.createReadStream = (...streamArgs) => {
        const stream = realStream(...streamArgs)
        const iterator = stream[Symbol.asyncIterator].bind(stream)
        stream[Symbol.asyncIterator] = async function* () {
          for await (const chunk of { [Symbol.asyncIterator]: iterator }) {
            const replacement = await realOpen(file, "r+")
            try {
              const info = await replacement.stat()
              await replacement.writeFile("replaced")
              await replacement.utimes(info.atime, info.mtime)
            } finally {
              await replacement.close()
            }
            yield chunk
          }
        }
        return stream
      }
    }
    return handle
  }
  syncBuiltinESMExports()
  try {
    await assert.rejects(readEvidenceFile(file))
  } finally {
    fs.open = realOpen
    syncBuiltinESMExports()
  }
})
test("cleanup preserves a replaced cache and its contents", async (t) => {
  const root = await privateRoot(t)
  const cache = join(root, "cache")
  await createEvidenceDirectory(cache)
  const identity = await checkedEvidenceDirectory(cache, true)
  await fs.rename(cache, join(root, "original"))
  await createEvidenceDirectory(cache)
  await writeEvidenceFile(cache, "keep.json", "{}")
  await assert.rejects(cleanupEvidenceCache(cache, identity))
  assert.equal(await fs.readFile(join(cache, "keep.json"), "utf8"), "{}")
})
test("resolves a scanner executable by actual bytes, rejects absent scanner", async (t) => {
  const directory = await privateRoot(t)
  await fs.writeFile(join(directory, "trivy"), "binary", { mode: 0o700 })
  assert.deepEqual(await resolveRuntimeScanner(`relative:${directory}`), {
    path: join(directory, "trivy"),
    bytes: 6,
    sha256: sha256("binary"),
  })
  await assert.rejects(
    resolveRuntimeScanner("relative:/missing-runtime-scanner")
  )
})
test("command runner preserves bytes and reaps failures, overflow and cancellation", async () => {
  const environment = { PATH: process.env.PATH }
  const run = (source, options = {}) =>
    runRuntimeEvidenceCommand(
      process.execPath,
      ["--input-type=module", "-e", source],
      { environment, signal: AbortSignal.timeout(5000), ...options }
    )
  assert.deepEqual(
    await run("process.stdout.write(Buffer.from([0xff, 0x00, 0x0a]))"),
    Buffer.from([0xff, 0, 10])
  )
  await assert.rejects(run("process.exit(1)"))
  await assert.rejects(
    run("process.stdout.write('x'.repeat(1000))", { maxOutputBytes: 20 })
  )
  await assert.rejects(
    run("setInterval(() => {}, 1000)", { signal: AbortSignal.timeout(50) })
  )
  await assert.rejects(run("process.exit(0)", { signal: AbortSignal.abort() }))
  await assert.rejects(
    runRuntimeEvidenceCommand("/missing-runtime-command", [], {
      environment,
      signal: AbortSignal.timeout(5000),
    })
  )
})

test("failure markers invalidate accepted records after late session failure", async (t) => {
  const directory = await privateRoot(t)
  const path = await writeFixture(directory)
  await writeEvidenceFile(
    directory,
    "failure.json",
    encode({ event: "runtime.image.failed", phase: "verify_artifacts" })
  )
  await assert.rejects(verifyRuntimeImageArtifacts(path))
  await assert.rejects(
    finalizeRuntimeImagePublication(path, {
      run: async () => assert.fail("Must reject before registry access."),
    })
  )
})
test("cancellation during publication writes leaves no verifiable published success", async (t) => {
  const directory = await privateRoot(t)
  const path = await writeFixture(directory)
  const raw = encode(manifest())
  const descriptor = {
    mediaType: manifest().mediaType,
    size: raw.length,
    digest: `sha256:${sha256(raw)}`,
  }
  const controller = new AbortController()
  const realOpen = fs.open
  fs.open = async (...args) => {
    const handle = await realOpen(...args)
    if (String(args[0]).endsWith("/backend.published.image.json"))
      controller.abort()
    return handle
  }
  syncBuiltinESMExports()
  try {
    await assert.rejects(
      finalizeRuntimeImagePublication(path, {
        signal: controller.signal,
        run: async (_command, args) =>
          args.includes("--raw") ? raw : encode(descriptor),
      })
    )
    await assert.rejects(
      verifyRuntimeImageArtifacts(
        join(directory, "backend.published.image.json")
      )
    )
    assert.deepEqual(await verifyRuntimeImageArtifacts(path), fixture().record)
  } finally {
    fs.open = realOpen
    syncBuiltinESMExports()
  }
})

test("publication CLI reaps its owned registry child on SIGTERM before rejecting", async (t) => {
  const { spawn } = await import("node:child_process")
  const { once } = await import("node:events")
  const { fileURLToPath } = await import("node:url")
  const directory = await privateRoot(t)
  const path = await writeFixture(directory)
  const childFile = join(directory, "child.pid")
  await fs.writeFile(
    join(directory, "docker"),
    `#!${process.execPath}\nimport { writeFileSync, renameSync } from 'node:fs'; writeFileSync(${JSON.stringify(childFile + ".tmp")}, String(process.pid), {mode:0o600,flag:'wx'}); renameSync(${JSON.stringify(childFile + ".tmp")}, ${JSON.stringify(childFile)}); setInterval(() => {}, 1000);\n`,
    { mode: 0o700 }
  )
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL("./finalize-runtime-image-publication.mjs", import.meta.url)
      ),
      path,
    ],
    { env: { HOME: directory, PATH: directory }, stdio: "ignore" }
  )
  const closed = once(child, "close")
  let registryPid
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      try {
        registryPid = Number(await fs.readFile(childFile, "utf8"))
        break
      } catch (error) {
        if (error.code !== "ENOENT") throw error
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 20))
    }
    assert.ok(Number.isSafeInteger(registryPid) && registryPid > 1)
    child.kill("SIGTERM")
    const timeout = setTimeout(() => child.kill("SIGKILL"), 3000)
    const result = await closed.finally(() => clearTimeout(timeout))
    assert.deepEqual(result, [1, null])
    assert.throws(() => process.kill(registryPid, 0), { code: "ESRCH" })
    assert.equal(
      decodeEvidence(
        await readEvidenceFile(join(directory, "publication-failure.json"))
      ).event,
      "runtime.publication.failed"
    )
    await assert.rejects(
      fs.lstat(join(directory, "backend.published.image.json")),
      { code: "ENOENT" }
    )
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL")
      await closed
    }
    if (registryPid) {
      try {
        process.kill(registryPid, "SIGKILL")
      } catch (error) {
        if (error.code !== "ESRCH") throw error
      }
    }
  }
})

test("cleanup failure invalidates a completed scan and preserves owned cache evidence", async (t) => {
  const setup = await fakeSession(t)
  const realRename = fs.rename
  let quarantine
  fs.rename = async (source, destination) => {
    if (String(destination).includes(".rr-runtime-cleanup-")) {
      quarantine = await fs.realpath(join(destination, ".."))
      throw Object.assign(new Error("Synthetic cleanup denial"), {
        code: "EACCES",
      })
    }
    return realRename(source, destination)
  }
  syncBuiltinESMExports()
  try {
    await assert.rejects(scanRuntimeImage(setup.options, setup.dependencies), {
      phase: "cleanup",
    })
    await assert.rejects(
      verifyRuntimeImageArtifacts(
        join(setup.options.output, "backend.image.json")
      )
    )
    assert.equal(
      decodeEvidence(
        await readEvidenceFile(join(setup.options.output, "failure.json"))
      ).phase,
      "cleanup"
    )
  } finally {
    fs.rename = realRename
    syncBuiltinESMExports()
    await fs.chmod(join(setup.cache(), "db"), 0o700)
    await fs.rm(setup.cache(), { recursive: true })
    if (quarantine) await fs.rmdir(quarantine)
  }
})
