import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
  link,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"
import {
  INTEGRATION_IMAGES,
  exportImageIds,
  parseImageIdentity,
  parseImageScanArguments,
  parseScannerIdentity,
  scanDisposableIntegrationImages,
  validateImageReport,
  validateImageSbom,
} from "./scan-disposable-integration-images.mjs"

const ids = [`sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`]
const clock = Date.parse("2026-09-07T00:00:00Z")
const scanner = () => ({
  Version: "0.70.0",
  VulnerabilityDB: {
    Version: 2,
    UpdatedAt: "2026-09-06T19:00:00Z",
    DownloadedAt: "2026-09-06T20:00:00Z",
    NextUpdate: "2026-09-07T19:00:00Z",
  },
})
const report = (id = ids[0]) => ({
  SchemaVersion: 2,
  ArtifactType: "container_image",
  ArtifactName: id,
  Metadata: { ImageID: id, OS: { Family: "alpine", Name: "3.24.1" } },
  Results: [
    {
      Class: "os-pkgs",
      Type: "alpine",
      Packages: [{ Name: "musl", Version: "1.2.5-r23" }],
      Vulnerabilities: [],
    },
  ],
})
const sbom = (id = ids[0]) => ({
  bomFormat: "CycloneDX",
  specVersion: "1.7",
  metadata: {
    component: {
      type: "container",
      name: id,
      properties: [{ name: "aquasecurity:trivy:ImageID", value: id }],
    },
  },
  components: [
    { type: "operating-system", name: "alpine", version: "3.24.1" },
    { type: "library", name: "musl", version: "1.2.5-r23" },
  ],
})
const identity = { id: ids[0], platform: "linux/amd64" }
const gosuPackages = [
  { Name: "github.com/tianon/gosu" },
  { Name: "stdlib", Version: "v1.27.1" },
  { Name: "github.com/moby/sys/user", Version: "v0.1.0" },
  { Name: "golang.org/x/sys", Version: "v0.44.0" },
]
const addGosu = (value) => {
  if (value.Results)
    value.Results.push({
      Class: "lang-pkgs",
      Type: "gobinary",
      Target: "usr/local/bin/gosu",
      Packages: structuredClone(gosuPackages),
    })
  else
    value.components.push(
      { type: "application", name: "usr/local/bin/gosu" },
      ...gosuPackages.map(({ Name, Version }) => ({
        type: "library",
        name: Name,
        ...(Version ? { version: Version } : {}),
      }))
    )
  return value
}
const makeFixture = async (t, changes = {}) => {
  const directory = await mkdtemp(join(tmpdir(), "rr-image-scan-test-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const envFile = join(directory, "github-env")
  await writeFile(envFile, "EXISTING=kept\n", { mode: 0o600 })
  const calls = []
  const environment = {
    HOME: directory,
    PATH: process.env.PATH,
    GITHUB_ENV: envFile,
    TRIVY_IGNORE_UNFIXED: "true",
    TRIVY_SEVERITY: "LOW",
    STRIPE_API_KEY: "private-canary",
    DOCKER_HOST: "tcp://remote.invalid:2375",
  }
  const run = async (command, args, options) => {
    calls.push({ command, args, options })
    if (changes.run) await changes.run(command, args, options)
    if (command === "docker" && args[0] === "context")
      return JSON.stringify(changes.host ?? "unix:///var/run/docker.sock")
    if (command === "docker")
      return JSON.stringify({
        id: ids[
          INTEGRATION_IMAGES.findIndex((image) => image.tag === args.at(-1))
        ],
        os: "linux",
        architecture: "amd64",
      })
    if (args.includes("--download-db-only")) return ""
    if (args.includes("--version"))
      return JSON.stringify(changes.scanner?.(calls) ?? scanner())
    const id = args.at(-1)
    const value = args.includes("cyclonedx") ? sbom(id) : report(id)
    if (id === ids[0]) addGosu(value)
    changes.report?.(value, id, args)
    return JSON.stringify(value)
  }
  return {
    directory,
    output: join(directory, "artifacts", "scan"),
    envFile,
    calls,
    environment,
    run,
    execute: async (offline = true) =>
      scanDisposableIntegrationImages(
        { output: join(directory, "artifacts", "scan"), offline },
        { environment, run, now: () => clock }
      ),
  }
}

test("parses a new output directory, one pnpm separator and offline option", () => {
  const parsed = parseImageScanArguments([
    "--",
    "--output",
    "/tmp/example",
    "--offline",
  ])
  assert.deepEqual(parsed, { output: "/tmp/example", offline: true })
  assert.ok(Object.isFrozen(parsed))
  assert.deepEqual(parseImageScanArguments(["--help"]), { help: true })
})
for (const args of [
  [],
  ["--offline"],
  ["--output"],
  ["--output", "--offline"],
  ["--output", "/"],
  ["--output", "bad\npath"],
  ["--output", "x", "--output", "y"],
  ["--output", "x", "--offline", "--offline"],
  ["--", "--", "--help"],
  ["--help", "--offline"],
  ["--url", "redis://private.invalid"],
]) {
  test(`rejects unsupported arguments ${JSON.stringify(args)}`, () =>
    assert.throws(() => parseImageScanArguments(args)))
}
test("requires an exact AMD64 local image ID", () => {
  assert.deepEqual(
    parseImageIdentity(
      JSON.stringify({ id: ids[0], os: "linux", architecture: "amd64" })
    ),
    identity
  )
  for (const value of [
    null,
    {},
    { id: "sha256:bad", os: "linux", architecture: "amd64" },
    { id: ids[0], os: "windows", architecture: "amd64" },
    { id: ids[0], os: "linux", architecture: "arm64" },
  ])
    assert.throws(() => parseImageIdentity(JSON.stringify(value)))
  assert.throws(() => parseImageIdentity("invalid JSON"))
  assert.throws(() => parseImageIdentity(" ".repeat(32 * 1024 * 1024 + 1)))
})
test("requires reviewed scanner and bounded current DB metadata", () => {
  const result = parseScannerIdentity(JSON.stringify(scanner()), clock, false)
  assert.equal(result.database.ageMs, 5 * 60 * 60 * 1000)
  assert.ok(Object.isFrozen(result.database))
  for (const mutate of [
    (value) => {
      value.Version = "9.9.9"
    },
    (value) => {
      value.VulnerabilityDB = null
    },
    (value) => {
      value.VulnerabilityDB.Version = 3
    },
    (value) => {
      value.VulnerabilityDB.UpdatedAt = "invalid"
    },
    (value) => {
      value.VulnerabilityDB.DownloadedAt = "2026-09-08T00:00:00Z"
    },
    (value) => {
      value.VulnerabilityDB.NextUpdate = value.VulnerabilityDB.UpdatedAt
    },
  ]) {
    const value = scanner()
    mutate(value)
    assert.throws(() =>
      parseScannerIdentity(JSON.stringify(value), clock, false)
    )
  }
  assert.throws(() =>
    parseScannerIdentity(
      JSON.stringify(scanner()),
      clock + 7 * 86_400_000,
      false
    )
  )
  assert.equal(
    parseScannerIdentity(
      JSON.stringify(scanner()),
      clock + 7 * 86_400_000,
      true
    ).offline,
    true
  )
})
test("keeps explicit LOW/MEDIUM counts and immutable package coverage", () => {
  const value = report()
  value.Results[0].Vulnerabilities = ["LOW", "MEDIUM"].map((Severity) => ({
    VulnerabilityID: "CVE-fixture",
    PkgName: "musl",
    Severity,
  }))
  const result = validateImageReport(value, identity)
  assert.equal(result.clean, true)
  assert.equal(result.counts.MEDIUM, 1)
  assert.ok(Object.isFrozen(result.counts))
  assert.equal(value.Results[0].Packages.length, 1)
  assert.throws(() => {
    result.coverage[0].packages = 0
  })
})
for (const severity of ["HIGH", "CRITICAL", "UNKNOWN"]) {
  test(`does not accept ${severity} even without a fixed version`, () => {
    const value = report()
    value.Results[0].Vulnerabilities = [
      { VulnerabilityID: "CVE-fixture", PkgName: "musl", Severity: severity },
    ]
    assert.equal(validateImageReport(value, identity).clean, false)
  })
}
for (const [label, mutate] of [
  [
    "wrong schema",
    (v) => {
      v.SchemaVersion = 1
    },
  ],
  [
    "wrong artifact type",
    (v) => {
      v.ArtifactType = "filesystem"
    },
  ],
  [
    "wrong artifact name",
    (v) => {
      v.ArtifactName = "mutable:tag"
    },
  ],
  [
    "wrong image ID",
    (v) => {
      v.Metadata.ImageID = ids[1]
    },
  ],
  [
    "missing OS",
    (v) => {
      delete v.Metadata.OS
    },
  ],
  [
    "EOL OS",
    (v) => {
      v.Metadata.OS.EOSL = true
    },
  ],
  [
    "wrong OS",
    (v) => {
      v.Metadata.OS.Family = "unknown"
    },
  ],
  [
    "missing results",
    (v) => {
      v.Results = []
    },
  ],
  [
    "missing inventory",
    (v) => {
      delete v.Results[0].Packages
    },
  ],
  [
    "empty inventory",
    (v) => {
      v.Results[0].Packages = []
    },
  ],
  [
    "missing version",
    (v) => {
      delete v.Results[0].Packages[0].Version
    },
  ],
  [
    "invalid class",
    (v) => {
      v.Results[0].Class = "config"
    },
  ],
  [
    "no OS packages",
    (v) => {
      v.Results[0].Class = "lang-pkgs"
    },
  ],
  [
    "suppressed finding",
    (v) => {
      v.Results[0].ExperimentalModifiedFindings = [{}]
    },
  ],
  [
    "malformed vulnerabilities",
    (v) => {
      v.Results[0].Vulnerabilities = {}
    },
  ],
  [
    "null vulnerabilities",
    (v) => {
      v.Results[0].Vulnerabilities = null
    },
  ],
  [
    "unrecognized severity",
    (v) => {
      v.Results[0].Vulnerabilities = [
        { VulnerabilityID: "CVE-test", PkgName: "musl", Severity: "moderate" },
      ]
    },
  ],
])
  test(`rejects report ${label}`, () => {
    const value = report()
    mutate(value)
    assert.throws(() => validateImageReport(value, identity))
  })

test("binds CycloneDX image identity and every detected package", () => {
  const summary = validateImageReport(report(), identity)
  assert.deepEqual(validateImageSbom(sbom(), identity, summary), {
    specVersion: "1.7",
    components: 2,
    libraryComponents: 1,
    applications: 0,
  })
  for (const mutate of [
    (v) => {
      v.bomFormat = "SPDX"
    },
    (v) => {
      v.specVersion = "invalid"
    },
    (v) => {
      v.metadata.component.name = ids[1]
    },
    (v) => {
      v.metadata.component.properties = []
    },
    (v) => {
      v.metadata.component.properties.push(v.metadata.component.properties[0])
    },
    (v) => {
      v.components = []
    },
    (v) => {
      v.components[1].version = "old"
    },
    (v) => {
      v.components[0].name = "debian"
    },
  ]) {
    const value = sbom()
    mutate(value)
    assert.throws(() => validateImageSbom(value, identity, summary))
  }
})
test("preserves the detected gosu application alongside every Go and OS package", () => {
  const pgIdentity = { ...identity, service: "postgres" }
  const value = addGosu(sbom())
  const summary = validateImageReport(addGosu(report()), pgIdentity)
  assert.deepEqual(summary.unversionedPackages, ["github.com/tianon/gosu"])
  assert.equal(validateImageSbom(value, pgIdentity, summary).applications, 1)
  value.components.push({ type: "application", name: "usr/local/bin/gosu" })
  assert.throws(() => validateImageSbom(value, identity, summary))
  value.components.pop()
  value.components.at(-1).name = "unknown"
  assert.throws(() => validateImageSbom(value, identity, summary))
})
test("does not silently lose the PostgreSQL gosu Go-package scanner coverage", () => {
  const pgIdentity = { ...identity, service: "postgres" }
  assert.throws(() => validateImageReport(report(), pgIdentity))
  const value = addGosu(report())
  value.Results[1].Packages.pop()
  assert.throws(() => validateImageReport(value, pgIdentity))
  delete value.Results[1].Packages[1].Version
  assert.throws(() => validateImageReport(value, identity))
  const summary = validateImageReport(addGosu(report()), pgIdentity)
  const withoutApplication = addGosu(sbom())
  withoutApplication.components = withoutApplication.components.filter(
    (item) => item.type !== "application"
  )
  assert.throws(() =>
    validateImageSbom(withoutApplication, pgIdentity, summary)
  )
})

test("scans both fixed IDs unsuppressed and exports both only after all evidence is bound", async (t) => {
  const fixture = await makeFixture(t)
  const result = await fixture.execute()
  assert.ok(Object.isFrozen(result.images))
  assert.equal(result.images.length, 2)
  assert.equal(
    await readFile(fixture.envFile, "utf8"),
    `EXISTING=kept\nRR_INTEGRATION_POSTGRES_IMAGE_ID=${ids[0]}\nRR_INTEGRATION_REDIS_IMAGE_ID=${ids[1]}\n`
  )
  const scans = fixture.calls.filter(
    (call) => call.command === "trivy" && call.args[0] === "image"
  )
  assert.equal(scans.length, 4)
  assert.deepEqual(
    scans.map(({ args }) => args.at(-1)),
    [ids[0], ids[0], ids[1], ids[1]]
  )
  for (const { args, options } of scans) {
    for (const required of [
      "--skip-db-update",
      "--offline-scan",
      "--ignore-unfixed=false",
      "--list-all-pkgs",
      "--skip-vex-repo-update",
      "UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL",
    ])
      assert.ok(args.includes(required))
    assert.equal(args[args.indexOf("--image-src") + 1], "docker")
    assert.equal(args[args.indexOf("--config") + 1], "/dev/null")
    assert.equal(args[args.indexOf("--ignorefile") + 1], "/dev/null")
    assert.deepEqual(Object.keys(options.environment).sort(), [
      "DOCKER_HOST",
      "HOME",
      "LANG",
      "PATH",
    ])
    assert.equal(options.environment.DOCKER_HOST, "unix:///var/run/docker.sock")
  }
  assert.equal((await stat(fixture.output)).mode & 0o777, 0o700)
  for (const name of await readdir(fixture.output))
    assert.equal((await stat(join(fixture.output, name))).mode & 0o777, 0o600)
  const record = JSON.parse(
    await readFile(join(fixture.output, "postgres.image.json"), "utf8")
  )
  assert.equal(record.imageId, ids[0])
  assert.equal(record.published, false)
  assert.equal(record.compiledServerCoverage, "not-established")
  for (const evidence of record.reports) {
    const content = await readFile(join(fixture.output, evidence.file))
    assert.equal(evidence.bytes, content.length)
    assert.equal(
      evidence.sha256,
      createHash("sha256").update(content).digest("hex")
    )
  }
})
test("online mode refreshes one fresh cache and removes it after all scans", async (t) => {
  const fixture = await makeFixture(t)
  delete fixture.environment.GITHUB_ENV
  const result = await fixture.execute(false)
  assert.equal(result.scanner.offline, false)
  const updates = fixture.calls.filter(({ args }) =>
    args.includes("--download-db-only")
  )
  assert.equal(updates.length, 1)
  const cache = updates[0].args[updates[0].args.indexOf("--cache-dir") + 1]
  await assert.rejects(stat(cache), { code: "ENOENT" })
  assert.equal(await readFile(fixture.envFile, "utf8"), "EXISTING=kept\n")
})
for (const kind of [
  "first high",
  "second high",
  "unknown",
  "wrong identity",
  "wrong SBOM",
  "command failure",
  "remote daemon",
  "DB drift",
]) {
  test(`never partially exports IDs on ${kind}`, async (t) => {
    const fixture = await makeFixture(t, {
      host: kind === "remote daemon" ? "tcp://remote.invalid:2375" : undefined,
      run: async (command, args) => {
        if (
          kind === "command failure" &&
          command === "trivy" &&
          args.at(-1) === ids[1]
        )
          throw new Error("private-canary")
      },
      scanner: (calls) => {
        const value = scanner()
        if (
          kind === "DB drift" &&
          calls.filter(({ args }) => args.includes("--version")).length > 1
        )
          value.VulnerabilityDB.DownloadedAt = "2026-09-06T21:00:00Z"
        return value
      },
      report: (value, id, args) => {
        if (args.includes("cyclonedx")) {
          if (kind === "wrong SBOM" && id === ids[1])
            value.metadata.component.name = ids[0]
          return
        }
        if (
          (kind === "first high" && id === ids[0]) ||
          (kind === "second high" && id === ids[1]) ||
          kind === "unknown"
        )
          value.Results[0].Vulnerabilities = [
            {
              VulnerabilityID: "CVE-test",
              PkgName: "musl",
              Severity: kind === "unknown" ? "UNKNOWN" : "HIGH",
            },
          ]
        if (kind === "wrong identity")
          value.Metadata.ImageID = ids[0] === id ? ids[1] : ids[0]
      },
    })
    const phase = {
      "first high": "validate_policy",
      "second high": "validate_policy",
      unknown: "validate_policy",
      "wrong identity": "scan_postgres",
      "wrong SBOM": "validate_sbom_redis",
      "command failure": "scan_redis",
      "remote daemon": "resolve_images",
      "DB drift": "validate_db",
    }[kind]
    await assert.rejects(fixture.execute(), {
      message: "Disposable image evidence rejected.",
      phase,
    })
    assert.equal(await readFile(fixture.envFile, "utf8"), "EXISTING=kept\n")
  })
}
test("rejects reused output, symlink parents and symlink leaves", async (t) => {
  const fixture = await makeFixture(t)
  await mkdir(fixture.output, { recursive: true })
  await assert.rejects(fixture.execute())
  await rm(fixture.output, { recursive: true })
  await symlink(fixture.directory, fixture.output)
  await assert.rejects(fixture.execute())
  await rm(fixture.output)
  await rm(join(fixture.directory, "artifacts"), { recursive: true })
  await symlink(fixture.directory, join(fixture.directory, "artifacts"))
  await assert.rejects(fixture.execute())
  assert.equal(fixture.calls.length, 0)
})
test("rejects cancellation and invalid environment without exporting", async (t) => {
  const fixture = await makeFixture(t)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    scanDisposableIntegrationImages(
      { output: fixture.output, offline: true },
      { ...fixture, now: () => clock, signal: controller.signal }
    )
  )
  await assert.rejects(
    scanDisposableIntegrationImages(
      { output: fixture.output, offline: true },
      { environment: {} }
    )
  )
  assert.equal(await readFile(fixture.envFile, "utf8"), "EXISTING=kept\n")
})
test("environment export rejects unsafe files and duplicate keys, preserving contents", async (t) => {
  const fixture = await makeFixture(t)
  const images = INTEGRATION_IMAGES.map((item, index) => ({
    service: item.service,
    id: ids[index],
  }))
  const alias = join(fixture.directory, "alias")
  await symlink(fixture.envFile, alias)
  await assert.rejects(exportImageIds(alias, images))
  await rm(alias)
  await link(fixture.envFile, alias)
  await assert.rejects(exportImageIds(alias, images))
  await rm(alias)
  await assert.rejects(exportImageIds(fixture.directory, images))
  await assert.rejects(exportImageIds(fixture.envFile, images.slice(1)))
  await writeFile(fixture.envFile, `RR_INTEGRATION_REDIS_IMAGE_ID=${ids[1]}\n`)
  await assert.rejects(exportImageIds(fixture.envFile, images))
  assert.equal(
    await readFile(fixture.envFile, "utf8"),
    `RR_INTEGRATION_REDIS_IMAGE_ID=${ids[1]}\n`
  )
  await writeFile(fixture.envFile, "EXISTING=kept")
  await exportImageIds(fixture.envFile, images)
  assert.match(await readFile(fixture.envFile, "utf8"), /^EXISTING=kept\nRR_/u)
})
for (const fault of ["short write", "sync failure"]) {
  test(`rolls back both environment exports after ${fault}`, async (t) => {
    const fixture = await makeFixture(t)
    const handle = await open(fixture.envFile, "r+")
    const prototype = Object.getPrototypeOf(handle)
    await handle.close()
    if (fault === "short write") {
      const write = prototype.write
      t.mock.method(prototype, "write", async function (content) {
        return write.call(this, content.slice(0, 30))
      })
    } else
      t.mock.method(prototype, "sync", async () => {
        throw new Error("private-canary")
      })
    const images = INTEGRATION_IMAGES.map((item, index) => ({
      service: item.service,
      id: ids[index],
    }))
    await assert.rejects(exportImageIds(fixture.envFile, images), {
      message: "Disposable image evidence rejected.",
    })
    assert.equal(await readFile(fixture.envFile, "utf8"), "EXISTING=kept\n")
  })
}
test("rejects malformed execution dependencies without installing signal handlers", async () => {
  const before = process.listenerCount("SIGTERM")
  for (const environment of [null, {}, { HOME: "/tmp", PATH: "x\ny" }]) {
    await assert.rejects(
      scanDisposableIntegrationImages(
        { output: "/tmp/unused", offline: true },
        { environment }
      ),
      { phase: "initialize" }
    )
  }
  await assert.rejects(
    scanDisposableIntegrationImages(
      { output: "/tmp/unused", offline: true },
      { signal: "invalid" }
    ),
    { phase: "initialize" }
  )
  assert.equal(process.listenerCount("SIGTERM"), before)
})
test("CLI help is credential-free and invalid arguments emit only a fixed failure", () => {
  const path = new URL(
    "./scan-disposable-integration-images.mjs",
    import.meta.url
  )
  const help = spawnSync(process.execPath, [path.pathname, "--", "--help"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /--offline/u)
  const invalid = spawnSync(
    process.execPath,
    [path.pathname, "--secret", "private-canary"],
    { encoding: "utf8", env: {} }
  )
  assert.equal(invalid.status, 1)
  assert.equal(invalid.stdout, "")
  assert.equal(
    invalid.stderr,
    '{"event":"integration.images.failed","phase":"arguments"}\n'
  )
})
