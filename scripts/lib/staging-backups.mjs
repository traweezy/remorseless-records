import assert from "node:assert/strict"
import { STAGING } from "./staging-release.mjs"

export const BACKUP_TARGETS = [
  {
    alias: "postgres",
    name: "Postgres",
    serviceId: "965d3ebe-2c6c-4987-b46b-ec059f9eb5ad",
    instanceId: "b0f2f2a1-8fe2-43ca-a992-bc83bcf2442d",
    volumeId: "1f219ae4-1659-4d3f-972f-8a8020441293",
    scheduleId: "e70863a5-6a43-42f0-8937-3290300786e1",
    mount: "/var/lib/postgresql/data",
    cron: "34 19 * * *",
  },
  {
    alias: "redis",
    name: "Redis",
    serviceId: "674c9ad0-25a7-4ae2-9efe-6f15f3de20b3",
    instanceId: "1f83ec52-ded6-4c3b-a0cc-8622c3bdf5b6",
    volumeId: "1b69088f-0a38-4ecb-bddf-d43715b97d52",
    scheduleId: "5e900ad8-3be2-4261-a483-4074c01cbc7c",
    mount: "/bitnami",
    cron: "40 1 * * *",
  },
  {
    alias: "bucket",
    name: "Bucket",
    serviceId: "a3fe4b80-8be8-4092-977a-54fe9dcca522",
    instanceId: "1dc3f38c-79f7-4327-b679-8d242f7362fd",
    volumeId: "4a17bb4a-8a59-4512-8d70-2806b5790853",
    scheduleId: "e17fec78-7494-43cc-b36f-8a35a64ccf2d",
    mount: "/data",
    cron: "1 10 * * *",
  },
]

const retentionSeconds = 518_400
const maximumIntervalMs = 26 * 60 * 60 * 1_000
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u
const timestamp = (value) => {
  assert.equal(typeof value, "string")
  assert.match(value, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/u)
  const parsed = Date.parse(value)
  assert.ok(Number.isFinite(parsed))
  assert.equal(new Date(parsed).toISOString().slice(0, 19), value.slice(0, 19))
  return parsed
}
const size = (value) => {
  assert.ok(value === null || (Number.isSafeInteger(value) && value >= 0))
  return value
}

export const BACKUPS_QUERY = `query StagingBackupEvidence {
  ${BACKUP_TARGETS.map(
    (target) => `
    ${target.alias}:volumeInstance(id:"${target.instanceId}") {
      id environmentId serviceId volumeId mountPath state deletedAt isPendingDeletion
      sizeMB currentSizeMB environment { id projectId name } service { id name }
    }
    ${target.alias}Schedules:volumeInstanceBackupScheduleList(volumeInstanceId:"${target.instanceId}") {
      id kind cron retentionSeconds createdAt
    }
    ${target.alias}Backups:volumeInstanceBackupList(volumeInstanceId:"${target.instanceId}") {
      id createdAt expiresAt scheduleId referencedMB usedMB volumeInstanceSizeMB
    }
  `
  ).join("\n")}
}`

// These are Railway's currently listed metadata records, not evidence that a
// snapshot can restore or that expired snapshots have been physically removed.
export const evaluateStagingBackups = (response, now = new Date()) => {
  assert.ok(!response.errors)
  const data = response.data ?? response
  const nowMs = now.getTime()
  assert.ok(Number.isFinite(nowMs))
  const services = BACKUP_TARGETS.map((target) => {
    const volume = data[target.alias]
    assert.equal(volume.id, target.instanceId)
    assert.equal(volume.environmentId, STAGING.environmentId)
    assert.equal(volume.serviceId, target.serviceId)
    assert.equal(volume.volumeId, target.volumeId)
    assert.equal(volume.mountPath, target.mount)
    assert.deepEqual(volume.environment, {
      id: STAGING.environmentId,
      projectId: STAGING.projectId,
      name: "staging",
    })
    assert.deepEqual(volume.service, {
      id: target.serviceId,
      name: target.name,
    })
    assert.equal(typeof volume.isPendingDeletion, "boolean")
    assert.ok(Number.isSafeInteger(volume.sizeMB) && volume.sizeMB > 0)
    assert.ok(
      Number.isFinite(volume.currentSizeMB) && volume.currentSizeMB >= 0
    )
    const reasons = []
    if (
      volume.state !== "READY" ||
      volume.deletedAt !== null ||
      volume.isPendingDeletion
    )
      reasons.push("volume_not_ready")
    if (volume.currentSizeMB >= volume.sizeMB * 0.9)
      reasons.push("volume_headroom_low")
    const schedules = data[`${target.alias}Schedules`]
    assert.ok(Array.isArray(schedules) && schedules.length < 100)
    if (
      schedules.length !== 1 ||
      schedules[0].id !== target.scheduleId ||
      schedules[0].kind !== "DAILY" ||
      schedules[0].cron !== target.cron ||
      schedules[0].retentionSeconds !== retentionSeconds
    )
      reasons.push("schedule_policy_changed")
    if (schedules.length === 1)
      assert.ok(timestamp(schedules[0].createdAt) <= nowMs)
    const records = data[`${target.alias}Backups`]
    // The provider returns an unpaginated list. Refuse an unexpectedly large
    // result instead of silently accepting a truncated or partial inventory.
    assert.ok(Array.isArray(records) && records.length < 100)
    const seen = new Set()
    const parsed = records.map((record) => {
      assert.match(record.id, uuid)
      assert.ok(!seen.has(record.id))
      seen.add(record.id)
      assert.ok(
        record.scheduleId === null ||
          (typeof record.scheduleId === "string" &&
            uuid.test(record.scheduleId))
      )
      const created = timestamp(record.createdAt)
      assert.ok(created <= nowMs + 60_000)
      const expires =
        record.expiresAt === null ? null : timestamp(record.expiresAt)
      assert.ok(expires === null || expires > created)
      size(record.referencedMB)
      size(record.usedMB)
      size(record.volumeInstanceSizeMB)
      return { record, created, expires }
    })
    const scheduled = parsed
      .filter(({ record }) => record.scheduleId === target.scheduleId)
      .sort((left, right) => left.created - right.created)
    const eligible = scheduled.filter(
      ({ expires }) => expires !== null && expires > nowMs
    )
    const newest = eligible.at(-1)
    if (!newest || nowMs - newest.created > maximumIntervalMs)
      reasons.push("scheduled_backup_stale_or_missing")
    if (eligible.length < 2) reasons.push("scheduled_history_insufficient")
    if (
      scheduled.some(
        ({ created, expires }) =>
          expires === null ||
          Math.abs(expires - created - retentionSeconds * 1_000) > 120_000
      )
    )
      reasons.push("backup_retention_mismatch")
    const gaps = eligible
      .slice(1)
      .map((item, index) => item.created - eligible[index].created)
    const maximumGapMs = Math.max(0, ...gaps)
    if (maximumGapMs > maximumIntervalMs) reasons.push("scheduled_backup_gap")
    if (
      parsed.some(
        ({ expires }) =>
          expires !== null && nowMs - expires > 48 * 60 * 60 * 1_000
      )
    )
      reasons.push("expired_records_persist")
    const knownExclusive = parsed.filter(({ record }) => record.usedMB !== null)
    const knownExclusiveMB = knownExclusive.reduce(
      (total, { record }) => total + record.usedMB,
      0
    )
    assert.ok(Number.isSafeInteger(knownExclusiveMB))
    return {
      service: target.name,
      volumeInstanceId: target.instanceId,
      scheduleId: target.scheduleId,
      retentionSeconds,
      listed: records.length,
      scheduledListed: scheduled.length,
      unexpiredScheduled: eligible.length,
      expiredListed: parsed.filter(
        ({ expires }) => expires !== null && expires <= nowMs
      ).length,
      maximumGapSeconds: Math.round(maximumGapMs / 1_000),
      knownExclusiveMB,
      unknownExclusiveSizes: parsed.length - knownExclusive.length,
      newest: newest
        ? {
            id: newest.record.id,
            createdAt: newest.record.createdAt,
            expiresAt: newest.record.expiresAt,
            ageSeconds: Math.max(
              0,
              Math.round((nowMs - newest.created) / 1_000)
            ),
            referencedMB: newest.record.referencedMB,
            exclusiveMB: newest.record.usedMB,
          }
        : null,
      reasons,
      passed: reasons.length === 0,
    }
  })
  return {
    schemaVersion: 1,
    readOnly: true,
    checkedAt: now.toISOString(),
    passed: services.every((service) => service.passed),
    projectId: STAGING.projectId,
    environmentId: STAGING.environmentId,
    maximumIntervalSeconds: maximumIntervalMs / 1_000,
    services,
    restoreVerified: false,
    offsiteVerified: false,
    pitrVerified: false,
  }
}
