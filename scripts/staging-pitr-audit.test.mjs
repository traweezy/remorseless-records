import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { BACKUP_TARGETS } from "./lib/staging-backups.mjs"
import { evaluateStagingPitr, PITR_SCOPE_QUERY } from "./lib/staging-pitr.mjs"
import { STAGING } from "./lib/staging-release.mjs"
import { runStagingPitrAudit } from "./staging-pitr-audit.mjs"
import { backupFixture } from "./test-fixtures/staging-backups.mjs"

const now = new Date("2026-10-03T16:00:00Z")
const target = BACKUP_TARGETS[0]
const fixture = () => ({
  scope: {
    serviceInstance: {
      id: "11111111-2222-4333-8444-555555555555",
      environmentId: STAGING.environmentId,
      serviceId: target.serviceId,
      source: {
        image: `ghcr.io/railwayapp-templates/postgres-ssl:16@sha256:${"a".repeat(64)}`,
        repo: null,
      },
      startCommand: null,
      activeDeployments: [
        {
          id: "22222222-2222-4333-8444-555555555555",
          projectId: STAGING.projectId,
          environmentId: STAGING.environmentId,
          serviceId: target.serviceId,
          status: "SUCCESS",
        },
      ],
    },
    volumeInstance: backupFixture(now).postgres,
  },
  status: {
    service: { id: target.serviceId, name: "Postgres" },
    root: { id: target.serviceId, name: "Postgres" },
    environment: { id: STAGING.environmentId, name: "staging" },
    isHaCluster: false,
    enabled: true,
    bucketWired: true,
    live: {
      available: true,
      backupSetCount: 4,
      latestBackupAt: "2026-10-03T04:00:00+00:00",
      archiverHealthy: true,
      archiverLastArchivedAt: "2026-10-03T15:59:00Z",
      maxRestoreTime: "2026-10-03T15:59:00.123456Z",
      walMin: "000000010000000000000001",
      walMax: "000000010000000000000009",
      private: "private-canary",
    },
  },
})
const evaluate = (f) =>
  evaluateStagingPitr(f.status, f.scope, structuredClone(f.scope), now)

test("PITR audit binds current staging scope and makes limited freshness claims", () => {
  const report = evaluate(fixture())
  assert.equal(report.passed, true)
  assert.equal(report.latestBackupAgeSeconds, 43_200)
  assert.equal(report.latestArchiveAgeSeconds, 60)
  assert.equal(report.restoreVerified, false)
  assert.equal(report.offsiteVerified, false)
  assert.equal(report.imageSecurityVerified, false)
  assert.ok(!JSON.stringify(report).includes("private-canary"))
})

test("wrong source, changed deployment, malformed identity and custom startup fail closed", () => {
  for (const mutate of [
    (f) => {
      f.scope.volumeInstance.environment.projectId = "wrong"
    },
    (f) => {
      f.scope.volumeInstance.volumeId = "wrong"
    },
    (f) => {
      f.scope.volumeInstance.state = "RESTORING"
    },
    (f) => {
      f.scope.volumeInstance.isPendingDeletion = true
    },
    (f) => {
      f.scope.serviceInstance.startCommand = "private-canary"
    },
    (f) => {
      f.scope.serviceInstance.activeDeployments[0].status = "DEPLOYING"
    },
    (f) => {
      f.scope.serviceInstance.activeDeployments.push(
        f.scope.serviceInstance.activeDeployments[0]
      )
    },
    (f) => {
      f.status.environment.id = "wrong"
    },
    (f) => {
      f.status.root.id = "wrong"
    },
    (f) => {
      f.status.isHaCluster = true
    },
    (f) => {
      f.status.members = [{}]
    },
    (f) => {
      f.status.enabled = "true"
    },
    (f) => {
      f.scope.errors = [{ message: "private-canary" }]
    },
  ]) {
    const f = fixture()
    mutate(f)
    assert.throws(() => evaluate(f))
  }
  const f = fixture()
  const after = structuredClone(f.scope)
  after.serviceInstance.activeDeployments[0].id =
    "33333333-2222-4333-8444-555555555555"
  assert.throws(() => evaluateStagingPitr(f.status, f.scope, after, now))
  assert.throws(() =>
    evaluateStagingPitr(f.status, f.scope, f.scope, new Date(Number.NaN))
  )
})

test("configured flags cannot hide stale, failed, missing or ambiguous live evidence", () => {
  for (const [mutate, reason] of [
    [
      (f) => {
        f.status.enabled = false
      },
      "pitr_disabled",
    ],
    [
      (f) => {
        f.status.bucketWired = false
      },
      "archive_bucket_unwired",
    ],
    [
      (f) => {
        f.status.blockers = ["private-canary"]
      },
      "provider_configuration_blocked",
    ],
    [
      (f) => {
        f.scope.serviceInstance.source.image =
          "ghcr.io/railwayapp-templates/postgres-ssl:latest"
      },
      "source_image_not_reviewed_major_digest",
    ],
    [
      (f) => {
        delete f.status.live
      },
      "live_probe_unavailable",
    ],
    [
      (f) => {
        f.status.live.archiverError = "private-canary"
      },
      "live_probe_incomplete",
    ],
    [
      (f) => {
        f.status.live.backupCoverageError = "private-canary"
      },
      "live_probe_incomplete",
    ],
    [
      (f) => {
        f.status.live.unavailableReason = "private-canary"
      },
      "live_probe_incomplete",
    ],
    [
      (f) => {
        f.status.live.archiverHealthy = null
      },
      "archiver_not_healthy",
    ],
    [
      (f) => {
        f.status.live.backupSetCount = 0
      },
      "base_backup_missing",
    ],
    [
      (f) => {
        f.status.live.backupSetCount = "4"
      },
      "base_backup_missing",
    ],
    [
      (f) => {
        f.status.live.latestBackupAt = "2026-10-01T00:00:00Z"
      },
      "base_backup_stale_or_unknown",
    ],
    [
      (f) => {
        f.status.live.archiverLastArchivedAt = "2026-10-03T15:54:59Z"
      },
      "archive_stale_or_unknown",
    ],
    [
      (f) => {
        f.status.live.maxRestoreTime = "2026-10-03T16:02:00Z"
      },
      "restore_ceiling_stale_or_unknown",
    ],
    [
      (f) => {
        f.status.live.maxRestoreTime = "2026-02-30T12:00:00Z"
      },
      "restore_ceiling_stale_or_unknown",
    ],
    [
      (f) => {
        f.status.live.maxRestoreTime = "private-canary"
      },
      "restore_ceiling_stale_or_unknown",
    ],
    [
      (f) => {
        f.status.live.walMin = "000000010000000000000010"
      },
      "wal_coverage_unverified",
    ],
    [
      (f) => {
        f.status.live.walMax = "private-canary"
      },
      "wal_coverage_unverified",
    ],
  ]) {
    const f = fixture()
    mutate(f)
    const report = evaluate(f)
    assert.equal(report.passed, false, reason)
    assert.ok(report.reasons.includes(reason), reason)
    assert.ok(!JSON.stringify(report).includes("private-canary"))
  }
})

test("bounded verified CLI reads surround the probe; invalid scope prevents SSH", async () => {
  const f = fixture()
  f.status.live.latestBackupAt = new Date().toISOString()
  f.status.live.archiverLastArchivedAt = new Date().toISOString()
  f.status.live.maxRestoreTime = new Date().toISOString()
  const calls = []
  const capture = async (_command, args) => {
    calls.push(args)
    if (args[0] === "--version") return "railway 5.45.0\n"
    if (args[0] === "status")
      return JSON.stringify({ id: STAGING.projectId, name: "store" })
    if (args[0] === "environment")
      return JSON.stringify({
        environments: [
          { id: STAGING.environmentId, name: "staging", isLinked: true },
        ],
      })
    if (args[0] === "api") {
      assert.deepEqual(args, ["api", PITR_SCOPE_QUERY, "--compact"])
      return JSON.stringify({ data: f.scope })
    }
    assert.deepEqual(args, [
      "postgres",
      "pitr",
      "status",
      "--project",
      STAGING.projectId,
      "--environment",
      STAGING.environmentId,
      "--service",
      target.serviceId,
      "--json",
    ])
    return JSON.stringify(f.status)
  }
  assert.equal((await runStagingPitrAudit([], capture)).passed, true)
  assert.equal(calls.length, 6)
  calls.length = 0
  f.scope.volumeInstance.volumeId = "wrong"
  await assert.rejects(runStagingPitrAudit([], capture))
  assert.ok(!calls.some(([verb]) => verb === "postgres"))
  assert.ok((await runStagingPitrAudit(["--", "--help"], capture)).help)
  await assert.rejects(
    runStagingPitrAudit(["--service", "private-canary"], capture)
  )
})

test("CLI help and failure output are credential-safe", () => {
  const script = new URL("./staging-pitr-audit.mjs", import.meta.url).pathname
  assert.equal(spawnSync(process.execPath, [script, "--help"]).status, 0)
  const result = spawnSync(process.execPath, [script, "private-canary"], {
    encoding: "utf8",
  })
  assert.equal(result.status, 1)
  assert.equal(result.stdout, "")
  assert.ok(!result.stderr.includes("private-canary"))
  assert.equal(
    JSON.parse(result.stderr).error,
    "staging_pitr_evidence_unverified"
  )
})
