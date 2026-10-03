import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { recoveryHash } from "./lib/recovery-vault.mjs"
import {
  resolveRuntimeScanner,
  runRuntimeEvidenceCommand,
} from "./lib/runtime-image-evidence.mjs"
import {
  runtimeEvidencePolicy as policy,
  validateRuntimeDatabase,
} from "./verify-runtime-image-artifacts.mjs"

export const verifyRecoveryImageReport = (
  report,
  imageId,
  revision,
  kind = "recovery"
) => {
  assert.ok(["recovery", "redis"].includes(kind))
  assert.equal(report.SchemaVersion, 2)
  assert.equal(report.ArtifactType, "container_image")
  assert.equal(report.Metadata.ImageID, imageId)
  assert.equal(
    report.Metadata.OS.Family,
    kind === "redis" ? "alpine" : "debian"
  )
  const config = report.Metadata.ImageConfig
  assert.equal(config.architecture, "amd64")
  assert.equal(config.os, "linux")
  assert.equal(
    config.config.User,
    kind === "redis" ? "1000:1000" : "65532:65532"
  )
  assert.equal(
    config.config.Labels["org.opencontainers.image.revision"],
    revision
  )
  assert.equal(
    config.config.Labels[
      kind === "redis"
        ? "com.remorseless.redis.version"
        : "com.remorseless.postgresql.version"
    ],
    kind === "redis" ? "8.10.2" : "16.15"
  )
  assert.ok(
    report.Results.some((r) => r.Class === "os-pkgs" && r.Packages.length > 0)
  )
  if (kind === "recovery")
    assert.ok(
      report.Results.some((r) => r.Type === "node-pkg" && r.Packages.length > 0)
    )
  else {
    assert.deepEqual(config.config.Entrypoint, [
      "/usr/local/bin/remorseless-redis",
    ])
    assert.equal(config.config.WorkingDir, "/bitnami/redis/data")
  }
  const counts = { UNKNOWN: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 }
  for (const result of report.Results)
    for (const finding of result.Vulnerabilities ?? []) {
      assert.ok(Object.hasOwn(counts, finding.Severity))
      counts[finding.Severity]++
    }
  for (const severity of ["UNKNOWN", "HIGH", "CRITICAL"])
    assert.equal(counts[severity], 0)
  return counts
}

export const scanRecoveryImage = async (
  imageId,
  revision,
  output,
  kind = "recovery"
) => {
  assert.ok(["recovery", "redis"].includes(kind))
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/u)
  assert.match(revision, /^[a-f0-9]{40}$/u)
  const cache = await mkdtemp(join(tmpdir(), "rr-recovery-scan-"))
  const signal = AbortSignal.timeout(12 * 60_000)
  const environment = { PATH: process.env.PATH, HOME: process.env.HOME }
  const execute = (command, args) =>
    runRuntimeEvidenceCommand(command, args, { environment, signal })
  try {
    const host =
      process.env.DOCKER_HOST ??
      (
        await execute("docker", [
          "context",
          "inspect",
          "default",
          "--format",
          "{{.Endpoints.docker.Host}}",
        ])
      )
        .toString()
        .trim()
    assert.match(host, /^unix:\/\/\/[^\s]+$/u)
    environment.DOCKER_HOST = host
    const scanner = await resolveRuntimeScanner(environment.PATH)
    assert.equal(scanner.sha256, policy.trivy.binarySha256)
    const base = ["--config", "/dev/null", "--cache-dir", cache, "--quiet"]
    const args = [
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
      `${policy.trivy.databaseRepository}:2`,
    ]
    await execute(scanner.path, [...args, "--download-db-only"])
    const sample = async () =>
      Object.fromEntries(
        await Promise.all(
          [
            ["data", "trivy.db"],
            ["metadata", "metadata.json"],
          ].map(async ([name, file]) => {
            const bytes = await readFile(join(cache, "db", file))
            return [name, { bytes: bytes.length, sha256: recoveryHash(bytes) }]
          })
        )
      )
    const metadata = JSON.parse(await readFile(join(cache, "db/metadata.json")))
    const database = {
      repository: `${policy.trivy.databaseRepository}:2`,
      version: metadata.Version,
      updatedAt: metadata.UpdatedAt,
      nextUpdate: metadata.NextUpdate,
      downloadedAt: metadata.DownloadedAt,
      before: await sample(),
    }
    database.after = database.before
    const startedAt = new Date().toISOString()
    validateRuntimeDatabase(database, startedAt, startedAt)
    const bytes = await execute(scanner.path, [
      ...args,
      "--skip-db-update",
      "--format",
      "json",
      imageId,
    ])
    const counts = verifyRecoveryImageReport(
      JSON.parse(bytes),
      imageId,
      revision,
      kind
    )
    database.after = await sample()
    assert.deepEqual(await resolveRuntimeScanner(environment.PATH), scanner)
    const completedAt = new Date().toISOString()
    validateRuntimeDatabase(database, startedAt, completedAt)
    await writeFile(join(output, `${kind}.vuln.json`), bytes, {
      flag: "wx",
      mode: 0o600,
    })
    const report = {
      imageId,
      revision,
      counts,
      scanner,
      database,
      startedAt,
      completedAt,
      passed: true,
    }
    await writeFile(
      join(output, `${kind}.image.json`),
      JSON.stringify(report),
      { flag: "wx", mode: 0o600 }
    )
    return { passed: true, imageId, revision, counts }
  } finally {
    await rm(cache, { recursive: true, force: true })
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    assert.ok([5, 6].includes(process.argv.length))
    console.log(
      JSON.stringify(await scanRecoveryImage(...process.argv.slice(2)))
    )
  } catch {
    console.error("Recovery image verification failed")
    process.exitCode = 1
  }
}
