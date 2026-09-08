import { createHash } from "node:crypto"
import { constants } from "node:fs"
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, parse, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { normalizeScriptArguments } from "./lib/cli-arguments.mjs"
import {
  createRecoveryScope,
  runRecoveryCommand,
} from "./lib/recovery-process.mjs"

export const INTEGRATION_IMAGES = Object.freeze([
  Object.freeze({
    service: "postgres",
    tag: "remorseless-records-integration-postgres:18.6-hardened",
    variable: "RR_INTEGRATION_POSTGRES_IMAGE_ID",
  }),
  Object.freeze({
    service: "redis",
    tag: "remorseless-records-integration-redis:8.10.1-hardened",
    variable: "RR_INTEGRATION_REDIS_IMAGE_ID",
  }),
])
const idPattern = /^sha256:[a-f0-9]{64}$/u
const limit = 32 * 1024 * 1024
const phases = Object.freeze([
  "arguments",
  "initialize",
  "resolve_images",
  "download_db",
  "validate_db",
  "scan_postgres",
  "scan_redis",
  "validate_sbom_postgres",
  "validate_sbom_redis",
  "validate_policy",
  "cleanup",
  "export",
])
const failure = () => new Error("Disposable image evidence rejected.")
const requireValue = (condition) => {
  if (!condition) throw failure()
}
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
const scalar = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 512 &&
  !/[\u0000-\u001f\u007f]/u.test(value)
const decode = (source) => {
  requireValue(typeof source === "string" && Buffer.byteLength(source) <= limit)
  try {
    return JSON.parse(source)
  } catch {
    throw failure()
  }
}
const hash = (source) => createHash("sha256").update(source).digest("hex")
const freeze = (value) => {
  if (object(value) || Array.isArray(value)) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

export const parseImageScanArguments = (args) => {
  const values = normalizeScriptArguments(args)
  if (values.length === 1 && values[0] === "--help")
    return Object.freeze({ help: true })
  const result = { offline: false }
  for (let index = 0; index < values.length; index++) {
    if (values[index] === "--offline" && !result.offline) result.offline = true
    else if (values[index] === "--output" && !result.output) {
      const value = values[++index]
      requireValue(scalar(value) && !value.startsWith("--"))
      result.output = resolve(value)
    } else throw failure()
  }
  requireValue(
    Boolean(result.output) && result.output !== parse(result.output).root
  )
  return Object.freeze(result)
}

export const parseImageIdentity = (source) => {
  const value = decode(source)
  requireValue(
    object(value) &&
      idPattern.test(value.id) &&
      value.os === "linux" &&
      value.architecture === "amd64"
  )
  return freeze({ id: value.id, platform: "linux/amd64" })
}

export const parseScannerIdentity = (source, now, offline) => {
  const value = decode(source)
  requireValue(object(value) && ["0.70.0", "0.74.0"].includes(value.Version))
  const db = value.VulnerabilityDB
  requireValue(object(db) && db.Version === 2)
  const timestamps = [db.UpdatedAt, db.NextUpdate, db.DownloadedAt]
  requireValue(
    timestamps.every(
      (item) =>
        typeof item === "string" &&
        /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/u.test(item) &&
        Number.isFinite(Date.parse(item))
    )
  )
  const updated = Date.parse(db.UpdatedAt)
  requireValue(
    Number.isSafeInteger(now) &&
      updated <= now &&
      Date.parse(db.DownloadedAt) <= now &&
      Date.parse(db.NextUpdate) > updated
  )
  // A default CI run must use a current database, not silently reuse a stale one.
  requireValue(
    offline ||
      (now < Date.parse(db.NextUpdate) && now - updated <= 48 * 60 * 60 * 1000)
  )
  return freeze({
    version: value.Version,
    database: {
      version: 2,
      updatedAt: db.UpdatedAt,
      nextUpdate: db.NextUpdate,
      downloadedAt: db.DownloadedAt,
      ageMs: now - updated,
    },
    offline,
  })
}

export const validateImageReport = (report, identity) => {
  requireValue(
    object(report) &&
      report.SchemaVersion === 2 &&
      report.ArtifactType === "container_image" &&
      report.ArtifactName === identity.id
  )
  requireValue(report.Metadata?.ImageID === identity.id)
  const os = report.Metadata.OS
  requireValue(
    object(os) && os.Family === "alpine" && scalar(os.Name) && os.EOSL !== true
  )
  requireValue(
    Array.isArray(report.Results) &&
      report.Results.length > 0 &&
      report.Results.length <= 100
  )
  const counts = { UNKNOWN: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 }
  const inventory = new Set()
  const unversionedPackages = new Set()
  const coverage = []
  let osPackages = 0
  for (const result of report.Results) {
    requireValue(
      object(result) &&
        ["os-pkgs", "lang-pkgs"].includes(result.Class) &&
        scalar(result.Type)
    )
    requireValue(
      Array.isArray(result.Packages) &&
        result.Packages.length > 0 &&
        result.Packages.length <= 5000
    )
    for (const pkg of result.Packages) {
      requireValue(object(pkg) && scalar(pkg.Name))
      // Rebuilding the pinned gosu source produces a (devel) main module. Keep
      // it visible as unversioned; this is not version-based CVE coverage.
      const unversionedGosu =
        pkg.Name === "github.com/tianon/gosu" &&
        pkg.Version === undefined &&
        result.Class === "lang-pkgs" &&
        result.Type === "gobinary" &&
        result.Target === "usr/local/bin/gosu"
      requireValue(scalar(pkg.Version) || unversionedGosu)
      if (unversionedGosu) unversionedPackages.add(pkg.Name)
      inventory.add(`${pkg.Name}\u0000${pkg.Version ?? ""}`)
    }
    if (result.Class === "os-pkgs") osPackages += result.Packages.length
    for (const key of ["ExperimentalModifiedFindings", "ModifiedFindings"])
      requireValue(
        result[key] === undefined ||
          (Array.isArray(result[key]) && result[key].length === 0)
      )
    const findings =
      result.Vulnerabilities === undefined ? [] : result.Vulnerabilities
    requireValue(Array.isArray(findings) && findings.length <= 20_000)
    for (const item of findings) {
      requireValue(
        object(item) &&
          scalar(item.VulnerabilityID) &&
          scalar(item.PkgName) &&
          Object.hasOwn(counts, item.Severity)
      )
      counts[item.Severity]++
    }
    coverage.push({
      class: result.Class,
      type: result.Type,
      packages: result.Packages.length,
    })
  }
  requireValue(osPackages > 0)
  if (identity.service === "postgres") {
    const gosu = report.Results.filter(
      (result) =>
        result.Class === "lang-pkgs" &&
        result.Type === "gobinary" &&
        result.Target === "usr/local/bin/gosu"
    )
    requireValue(
      gosu.length === 1 &&
        [
          "github.com/tianon/gosu",
          "stdlib",
          "github.com/moby/sys/user",
          "golang.org/x/sys",
        ].every((name) => gosu[0].Packages.some((pkg) => pkg.Name === name))
    )
  }
  return freeze({
    clean: counts.HIGH === 0 && counts.CRITICAL === 0 && counts.UNKNOWN === 0,
    os: { family: os.Family, version: os.Name },
    counts,
    coverage,
    unversionedPackages: [...unversionedPackages].sort(),
    inventory: [...inventory].sort(),
  })
}

export const validateImageSbom = (sbom, identity, report) => {
  requireValue(
    object(sbom) &&
      sbom.bomFormat === "CycloneDX" &&
      /^1\.[4-9]$/u.test(sbom.specVersion)
  )
  requireValue(
    sbom.metadata?.component?.type === "container" &&
      sbom.metadata.component.name === identity.id
  )
  const properties = sbom.metadata.component.properties
  requireValue(Array.isArray(properties))
  const ids = properties.filter(
    (item) => item.name === "aquasecurity:trivy:ImageID"
  )
  requireValue(ids.length === 1 && ids[0].value === identity.id)
  requireValue(
    Array.isArray(sbom.components) &&
      sbom.components.length > 0 &&
      sbom.components.length <= 10_000
  )
  const inventory = new Set()
  let operatingSystems = 0
  let applications = 0
  for (const component of sbom.components) {
    requireValue(object(component) && scalar(component.name))
    if (component.type === "library") {
      requireValue(
        scalar(component.version) ||
          (component.version === undefined &&
            report.unversionedPackages.includes(component.name))
      )
      inventory.add(`${component.name}\u0000${component.version ?? ""}`)
    } else if (component.type === "application") {
      requireValue(component.name === "usr/local/bin/gosu")
      applications++
      requireValue(applications === 1)
    } else {
      requireValue(
        component.type === "operating-system" &&
          component.name === report.os.family &&
          component.version === report.os.version
      )
      operatingSystems++
    }
  }
  requireValue(
    operatingSystems === 1 &&
      report.inventory.every((item) => inventory.has(item))
  )
  if (identity.service === "postgres") requireValue(applications === 1)
  return freeze({
    specVersion: sbom.specVersion,
    components: sbom.components.length,
    libraryComponents: inventory.size,
    applications,
  })
}

const checkedDirectory = async (path) => {
  const info = await lstat(path)
  requireValue(
    info.isDirectory() &&
      !info.isSymbolicLink() &&
      (await realpath(path)) === path
  )
}
const newOutputDirectory = async (output) => {
  const parent = dirname(output)
  const missing = []
  let current = parent
  for (;;) {
    try {
      await checkedDirectory(current)
      break
    } catch (error) {
      if (error.code !== "ENOENT") throw failure()
      missing.push(current)
      current = dirname(current)
    }
  }
  for (const path of missing.reverse()) {
    await mkdir(path, { mode: 0o700 })
    await checkedDirectory(path)
  }
  // No existing evidence directory is reused, even when apparently empty.
  await mkdir(output, { mode: 0o700 })
  await checkedDirectory(output)
  requireValue(((await lstat(output)).mode & 0o077) === 0)
}
const writeEvidence = async (directory, name, source) => {
  await checkedDirectory(directory)
  await writeFile(join(directory, name), source, { flag: "wx", mode: 0o600 })
  return { file: name, bytes: Buffer.byteLength(source), sha256: hash(source) }
}

export const exportImageIds = async (path, images) => {
  requireValue(scalar(path) && resolve(path) === path)
  await checkedDirectory(dirname(path))
  requireValue(
    images.length === 2 &&
      images.every(
        (item, index) =>
          item.service === INTEGRATION_IMAGES[index].service &&
          idPattern.test(item.id)
      )
  )
  const file = await open(
    path,
    constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW
  )
  try {
    const info = await file.stat()
    requireValue(info.isFile() && info.nlink === 1 && info.size <= 1024 * 1024)
    const existing = await file.readFile("utf8")
    requireValue(
      !/^RR_INTEGRATION_(?:POSTGRES|REDIS)_IMAGE_ID(?:=|<<)/mu.test(existing)
    )
    const content = `${existing && !existing.endsWith("\n") ? "\n" : ""}${images.map((item, index) => `${INTEGRATION_IMAGES[index].variable}=${item.id}\n`).join("")}`
    try {
      const result = await file.write(content)
      requireValue(result.bytesWritten === Buffer.byteLength(content))
      await file.sync()
    } catch {
      await file.truncate(info.size)
      throw failure()
    }
  } finally {
    await file.close()
  }
}

export const scanDisposableIntegrationImages = async (
  options,
  {
    environment = process.env,
    run = runRecoveryCommand,
    now = Date.now,
    signal,
  } = {}
) => {
  let scope
  let activeSignal
  let childEnvironment
  const execute = (command, args) =>
    run(command, args, {
      environment: childEnvironment,
      signal: activeSignal,
      maxOutputBytes: limit,
    })
  let temporaryCache
  let phase = "initialize"
  try {
    requireValue(
      object(options) &&
        typeof options.offline === "boolean" &&
        scalar(options.output) &&
        resolve(options.output) === options.output
    )
    requireValue(
      object(environment) &&
        scalar(environment.HOME) &&
        resolve(environment.HOME) === environment.HOME &&
        typeof environment.PATH === "string" &&
        environment.PATH.length > 0 &&
        environment.PATH.length <= 32_768 &&
        !/[\u0000-\u001f\u007f]/u.test(environment.PATH)
    )
    requireValue(signal === undefined || signal instanceof AbortSignal)
    scope = createRecoveryScope(15 * 60 * 1000)
    activeSignal = signal
      ? AbortSignal.any([signal, scope.signal])
      : scope.signal
    childEnvironment = {
      HOME: environment.HOME,
      PATH: environment.PATH,
      LANG: "C",
    }
    activeSignal.throwIfAborted()
    await newOutputDirectory(options.output)
    phase = "resolve_images"
    const host = decode(
      await execute("docker", [
        "context",
        "inspect",
        "--format",
        "{{json .Endpoints.docker.Host}}",
      ])
    )
    requireValue(
      typeof host === "string" &&
        /^unix:\/\/\/[^\s\u0000-\u001f\u007f]+$/u.test(host)
    )
    childEnvironment.DOCKER_HOST = host
    const images = []
    for (const fixture of INTEGRATION_IMAGES) {
      const identity = parseImageIdentity(
        await execute("docker", [
          "image",
          "inspect",
          "--format",
          '{"id":{{json .Id}},"os":{{json .Os}},"architecture":{{json .Architecture}}}',
          fixture.tag,
        ])
      )
      images.push({ ...fixture, ...identity })
    }
    requireValue(images[0].id !== images[1].id)
    const cache = options.offline
      ? join(environment.HOME, ".cache", "trivy")
      : (temporaryCache = await mkdtemp(join(tmpdir(), "rr-fixture-trivy-")))
    const base = ["--config", "/dev/null", "--cache-dir", cache, "--quiet"]
    const common = [
      "image",
      ...base,
      "--image-src",
      "docker",
      "--docker-host",
      host,
      "--platform",
      "linux/amd64",
      "--scanners",
      "vuln",
      "--pkg-types",
      "os,library",
      "--severity",
      "UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL",
      "--list-all-pkgs",
      "--ignorefile",
      "/dev/null",
      "--ignore-unfixed=false",
      "--skip-java-db-update",
      "--skip-check-update",
      "--skip-vex-repo-update",
      "--skip-version-check",
      "--disable-telemetry",
      "--offline-scan",
      "--timeout",
      "5m",
      "--db-repository",
      "ghcr.io/aquasecurity/trivy-db:2",
    ]
    phase = "download_db"
    if (!options.offline)
      await execute("trivy", [...common, "--download-db-only"])
    phase = "validate_db"
    const scanner = parseScannerIdentity(
      await execute("trivy", [...base, "--version", "--format", "json"]),
      now(),
      options.offline
    )
    const records = []
    for (const image of images) {
      phase = `scan_${image.service}`
      activeSignal.throwIfAborted()
      const reportSource = await execute("trivy", [
        ...common,
        "--skip-db-update",
        "--format",
        "json",
        image.id,
      ])
      const reportFile = await writeEvidence(
        options.output,
        `${image.service}.vuln.json`,
        reportSource
      )
      const report = validateImageReport(decode(reportSource), image)
      phase = `validate_sbom_${image.service}`
      const sbomSource = await execute("trivy", [
        ...common,
        "--skip-db-update",
        "--format",
        "cyclonedx",
        image.id,
      ])
      const sbomFile = await writeEvidence(
        options.output,
        `${image.service}.cdx.json`,
        sbomSource
      )
      const sbom = validateImageSbom(decode(sbomSource), image, report)
      const { inventory: _inventory, ...summary } = report
      const record = freeze({
        schemaVersion: 1,
        service: image.service,
        localTag: image.tag,
        imageId: image.id,
        platform: image.platform,
        published: false,
        scanner,
        ...summary,
        sbom,
        reports: [reportFile, sbomFile],
        compiledServerCoverage: "not-established",
      })
      await writeEvidence(
        options.output,
        `${image.service}.image.json`,
        `${JSON.stringify(record, null, 2)}\n`
      )
      records.push(record)
    }
    phase = "validate_db"
    const after = parseScannerIdentity(
      await execute("trivy", [...base, "--version", "--format", "json"]),
      now(),
      options.offline
    )
    requireValue(
      after.version === scanner.version &&
        ["version", "updatedAt", "nextUpdate", "downloadedAt"].every(
          (key) => after.database[key] === scanner.database[key]
        )
    )
    phase = "validate_policy"
    requireValue(records.every((record) => record.clean))
    phase = "cleanup"
    if (temporaryCache) {
      await rm(temporaryCache, { recursive: true, force: true })
      temporaryCache = undefined
    }
    activeSignal.throwIfAborted()
    phase = "export"
    if (environment.GITHUB_ENV !== undefined)
      await exportImageIds(environment.GITHUB_ENV, images)
    return freeze({
      event: "integration.images.verified",
      images: images.map(({ service, id }) => ({ service, id })),
      scanner,
    })
  } catch {
    throw Object.assign(failure(), { phase })
  } finally {
    scope?.close()
    if (temporaryCache) {
      try {
        await rm(temporaryCache, { recursive: true, force: true })
      } catch {
        throw Object.assign(failure(), { phase: "cleanup" })
      }
    }
  }
}

const main = async () => {
  try {
    const options = parseImageScanArguments(process.argv.slice(2))
    if (options.help) {
      process.stdout.write(
        "Usage: node scripts/scan-disposable-integration-images.mjs --output <new-directory> [--offline]\nScans two fixed local Linux/amd64 fixture images; no image pulls or publication.\nDefault: fresh reviewed GHCR vulnerability DB. --offline: existing cached DB, age recorded.\nHIGH/CRITICAL/UNKNOWN findings fail. Private evidence is retained; GITHUB_ENV receives both IDs only after acceptance.\n"
      )
      return
    }
    process.stdout.write(
      `${JSON.stringify(await scanDisposableIntegrationImages(options))}\n`
    )
  } catch (error) {
    const phase = phases.includes(error?.phase) ? error.phase : "arguments"
    process.stderr.write(
      `${JSON.stringify({ event: "integration.images.failed", phase })}\n`
    )
    process.exitCode = 1
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main()
