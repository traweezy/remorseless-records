import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"
import {
  BACKUPS_QUERY,
  evaluateStagingBackups,
} from "./lib/staging-backups.mjs"
import { STAGING } from "./lib/staging-release.mjs"
import { runStagingBackupAudit } from "./staging-backup-audit.mjs"
import { backupFixture } from "./test-fixtures/staging-backups.mjs"

const now = new Date("2026-10-03T00:40:00.000Z")
test("backup evidence binds exact staging volumes and emits only allowlisted metadata", () => {
  const report = evaluateStagingBackups({ data: backupFixture(now) }, now)
  assert.equal(report.passed, true)
  assert.equal(report.services.length, 3)
  assert.equal(report.services[0].unexpiredScheduled, 2)
  assert.equal(report.services[0].maximumGapSeconds, 86_400)
  assert.equal(report.services[0].newest.ageSeconds, 21_600)
  assert.equal(report.services[0].knownExclusiveMB, 20)
  assert.equal(report.restoreVerified, false)
  assert.equal(report.offsiteVerified, false)
  assert.equal(report.pitrVerified, false)
  assert.equal(JSON.stringify(report).includes("private-backup-canary"), false)
  assert.equal(
    /mutation|variableCollection|secret/iu.test(BACKUPS_QUERY),
    false
  )
})

test("scope, malformed records and incomplete inventories fail closed", () => {
  for (const mutate of [
    (f) => {
      f.postgres.id = f.redis.id
    },
    (f) => {
      f.postgres.environmentId = f.postgres.id
    },
    (f) => {
      f.postgres.serviceId = f.redis.serviceId
    },
    (f) => {
      f.postgres.volumeId = f.redis.volumeId
    },
    (f) => {
      f.postgres.mountPath = "/wrong"
    },
    (f) => {
      f.postgres.environment.projectId = f.postgres.id
    },
    (f) => {
      f.postgres.service.name = "Other"
    },
    (f) => {
      f.postgres.isPendingDeletion = "false"
    },
    (f) => {
      f.postgres.sizeMB = 0
    },
    (f) => {
      f.postgres.currentSizeMB = -1
    },
    (f) => {
      f.postgresSchedules = {}
    },
    (f) => {
      f.postgresSchedules[0].createdAt = "invalid"
    },
    (f) => {
      f.postgresSchedules[0].createdAt = "2027-01-01T00:00:00Z"
    },
    (f) => {
      f.postgresBackups = null
    },
    (f) => {
      f.postgresBackups = Array(100).fill(f.postgresBackups[0])
    },
    (f) => {
      f.postgresBackups.push(f.postgresBackups[0])
    },
    (f) => {
      f.postgresBackups[0].id = "invalid"
    },
    (f) => {
      f.postgresBackups[0].scheduleId = "invalid"
    },
    (f) => {
      f.postgresBackups[0].createdAt = null
    },
    (f) => {
      f.postgresBackups[0].createdAt = "2026-02-30T00:00:00Z"
    },
    (f) => {
      f.postgresBackups.forEach((record) => {
        record.usedMB = Number.MAX_SAFE_INTEGER
      })
    },
    (f) => {
      f.postgresBackups[0].createdAt = "9999-99-99T99:99:99Z"
    },
    (f) => {
      f.postgresBackups[0].createdAt = "2027-01-01T00:00:00Z"
    },
    (f) => {
      f.postgresBackups[0].expiresAt = "2025-01-01T00:00:00Z"
    },
    (f) => {
      f.postgresBackups[0].usedMB = "0"
    },
    (f) => {
      f.postgresBackups[0].referencedMB = -1
    },
    (f) => {
      f.postgresBackups[0].volumeInstanceSizeMB = 1.5
    },
  ]) {
    const fixture = backupFixture(now)
    mutate(fixture)
    assert.throws(() => evaluateStagingBackups(fixture, now))
  }
  assert.throws(() =>
    evaluateStagingBackups({ errors: [{ message: "private" }] }, now)
  )
  assert.throws(() =>
    evaluateStagingBackups(backupFixture(now), new Date(Number.NaN))
  )
})

test("observed degradation never gains release readiness", () => {
  for (const [mutate, reason] of [
    [
      (f) => {
        f.postgres.state = "DELETING"
      },
      "volume_not_ready",
    ],
    [
      (f) => {
        f.postgres.deletedAt = now.toISOString()
      },
      "volume_not_ready",
    ],
    [
      (f) => {
        f.postgres.isPendingDeletion = true
      },
      "volume_not_ready",
    ],
    [
      (f) => {
        f.postgres.currentSizeMB = 45_000
      },
      "volume_headroom_low",
    ],
    [
      (f) => {
        f.postgresSchedules = []
      },
      "schedule_policy_changed",
    ],
    [
      (f) => {
        f.postgresSchedules.push(f.postgresSchedules[0])
      },
      "schedule_policy_changed",
    ],
    [
      (f) => {
        f.postgresSchedules[0].id = f.redisSchedules[0].id
      },
      "schedule_policy_changed",
    ],
    [
      (f) => {
        f.postgresSchedules[0].kind = "WEEKLY"
      },
      "schedule_policy_changed",
    ],
    [
      (f) => {
        f.postgresSchedules[0].cron = "0 0 * * *"
      },
      "schedule_policy_changed",
    ],
    [
      (f) => {
        f.postgresSchedules[0].retentionSeconds = 100
      },
      "schedule_policy_changed",
    ],
    [
      (f) => {
        f.postgresBackups = []
      },
      "scheduled_backup_stale_or_missing",
    ],
    [
      (f) => {
        f.postgresBackups.shift()
      },
      "scheduled_backup_stale_or_missing",
    ],
    [
      (f) => {
        f.postgresBackups.pop()
      },
      "scheduled_history_insufficient",
    ],
    [
      (f) => {
        f.postgresBackups[0].expiresAt = null
      },
      "backup_retention_mismatch",
    ],
    [
      (f) => {
        f.postgresBackups[0].expiresAt = new Date(
          now.getTime() + 86_400_000
        ).toISOString()
      },
      "backup_retention_mismatch",
    ],
    [
      (f) => {
        const older = f.postgresBackups[1]
        older.createdAt = new Date(
          Date.parse(older.createdAt) - 86_400_000
        ).toISOString()
        older.expiresAt = new Date(
          Date.parse(older.expiresAt) - 86_400_000
        ).toISOString()
      },
      "scheduled_backup_gap",
    ],
    [
      (f) => {
        f.postgresBackups.push({
          ...f.postgresBackups[0],
          id: "99999999-2222-4333-8444-555555555555",
          scheduleId: null,
          createdAt: "2026-09-01T00:00:00Z",
          expiresAt: "2026-09-07T00:00:00Z",
        })
      },
      "expired_records_persist",
    ],
  ]) {
    const fixture = backupFixture(now)
    mutate(fixture)
    const report = evaluateStagingBackups(fixture, now)
    assert.equal(report.passed, false, reason)
    assert.ok(report.services[0].reasons.includes(reason), reason)
  }
})

test("missing sizes and briefly expired metadata remain explicit rather than fabricated evidence", () => {
  const fixture = backupFixture(now)
  fixture.postgresBackups[0].usedMB = null
  fixture.postgresBackups[0].referencedMB = null
  fixture.postgresBackups.push({
    ...fixture.postgresBackups[1],
    id: "99999999-2222-4333-8444-555555555555",
    scheduleId: null,
    createdAt: "2026-09-20T00:00:00Z",
    expiresAt: "2026-10-03T00:00:00Z",
  })
  const report = evaluateStagingBackups(fixture, now)
  assert.equal(report.passed, true)
  assert.equal(report.services[0].expiredListed, 1)
  assert.equal(report.services[0].unknownExclusiveSizes, 1)
  assert.equal(report.services[0].newest.referencedMB, null)
  assert.equal(report.services[0].newest.exclusiveMB, null)
  fixture.postgresBackups[2].expiresAt = null
  assert.equal(
    evaluateStagingBackups(fixture, now).services[0].expiredListed,
    0
  )
})

test("standalone audit uses verified pinned read-only access and rejects alternate targets", async () => {
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
    assert.deepEqual(args, ["api", BACKUPS_QUERY, "--compact"])
    return JSON.stringify(backupFixture())
  }
  assert.equal((await runStagingBackupAudit([], capture)).passed, true)
  assert.equal(calls.length, 4)
  calls.length = 0
  assert.ok((await runStagingBackupAudit(["--", "--help"], capture)).help)
  assert.equal(calls.length, 0)
  await assert.rejects(
    runStagingBackupAudit(["--environment", "production"], capture)
  )
  await assert.rejects(runStagingBackupAudit([], async () => "railway 9.9.9"))
  await assert.rejects(
    runStagingBackupAudit([], async () => {
      throw new Error("private")
    })
  )
})

test("CLI rejects invalid arguments without printing them", () => {
  const script = new URL("./staging-backup-audit.mjs", import.meta.url).pathname
  const help = spawnSync(process.execPath, [script, "--help"], {
    encoding: "utf8",
  })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /Read-only audit/u)
  const failed = spawnSync(process.execPath, [script, "private-canary"], {
    encoding: "utf8",
  })
  assert.equal(failed.status, 1)
  assert.equal(failed.stdout, "")
  assert.equal(failed.stderr.includes("private-canary"), false)
  assert.equal(
    JSON.parse(failed.stderr).error,
    "staging_backup_evidence_unverified"
  )
})
