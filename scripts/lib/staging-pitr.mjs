import assert from "node:assert/strict"
import { BACKUP_TARGETS } from "./staging-backups.mjs"
import { STAGING } from "./staging-release.mjs"

const target = BACKUP_TARGETS[0]
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u
const wal = /^[A-F0-9]{24}$/u
const maximumArchiveAgeSeconds = 300
const maximumBaseBackupAgeSeconds = 26 * 60 * 60

export const PITR_SCOPE_QUERY = `query StagingPitrScope {
  serviceInstance(environmentId:"${STAGING.environmentId}",serviceId:"${target.serviceId}") {
    id serviceId environmentId source { image repo } startCommand
    activeDeployments { id projectId environmentId serviceId status }
  }
  volumeInstance(id:"${target.instanceId}") {
    id environmentId serviceId volumeId mountPath state deletedAt isPendingDeletion
    environment { id projectId name }
  }
}`

export const verifyPitrScope = (response) => {
  assert.ok(!response.errors?.length)
  const { serviceInstance: service, volumeInstance: volume } =
    response.data ?? response
  assert.match(service.id, uuid)
  assert.equal(service.serviceId, target.serviceId)
  assert.equal(service.environmentId, STAGING.environmentId)
  assert.equal(volume.id, target.instanceId)
  assert.equal(volume.serviceId, target.serviceId)
  assert.equal(volume.volumeId, target.volumeId)
  assert.equal(volume.environmentId, STAGING.environmentId)
  assert.equal(volume.environment.id, STAGING.environmentId)
  assert.equal(volume.environment.projectId, STAGING.projectId)
  assert.equal(volume.environment.name, "staging")
  assert.equal(volume.mountPath, target.mount)
  assert.equal(volume.state, "READY")
  assert.equal(volume.deletedAt, null)
  assert.equal(volume.isPendingDeletion, false)
  assert.equal(service.activeDeployments.length, 1)
  const deployment = service.activeDeployments[0]
  assert.match(deployment.id, uuid)
  assert.equal(deployment.projectId, STAGING.projectId)
  assert.equal(deployment.environmentId, STAGING.environmentId)
  assert.equal(deployment.serviceId, target.serviceId)
  assert.equal(deployment.status, "SUCCESS")
  assert.equal(typeof service.source.image, "string")
  assert.equal(service.source.repo, null)
  assert.ok(service.startCommand === null || service.startCommand === "")
  return {
    serviceInstanceId: service.id,
    deploymentId: deployment.id,
    image: service.source.image,
    volumeId: target.volumeId,
  }
}

const age = (value, now) => {
  if (typeof value !== "string") return null
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|\+00:00)$/u.test(value)
  )
    return null
  const parsed = Date.parse(value)
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 19) !== value.slice(0, 19) ||
    parsed > now.getTime() + 60_000
  )
    return null
  return Math.max(0, Math.floor((now.getTime() - parsed) / 1_000))
}

export const evaluateStagingPitr = (
  status,
  before,
  after,
  now = new Date()
) => {
  assert.ok(Number.isFinite(now.getTime()))
  const scope = verifyPitrScope(before)
  assert.deepEqual(verifyPitrScope(after), scope)
  for (const resource of [status.service, status.root]) {
    assert.equal(resource.id, target.serviceId)
    assert.equal(resource.name, "Postgres")
  }
  assert.equal(status.environment.id, STAGING.environmentId)
  assert.equal(status.environment.name, "staging")
  assert.equal(status.isHaCluster, false)
  assert.ok(
    status.members === undefined ||
      (Array.isArray(status.members) && status.members.length === 0)
  )
  assert.equal(typeof status.enabled, "boolean")
  assert.equal(typeof status.bucketWired, "boolean")
  assert.ok(status.blockers === undefined || Array.isArray(status.blockers))
  const reasons = []
  if (!status.enabled) reasons.push("pitr_disabled")
  if (!status.bucketWired) reasons.push("archive_bucket_unwired")
  if (status.blockers?.length) reasons.push("provider_configuration_blocked")
  // Bind major 16 and immutable image bytes. Image vulnerability acceptance
  // is separate; a registry name or configured flag cannot establish it.
  if (
    !/^ghcr\.io\/railwayapp-templates\/postgres-ssl:16@sha256:[a-f0-9]{64}$/u.test(
      scope.image
    )
  )
    reasons.push("source_image_not_reviewed_major_digest")
  const live = status.live
  const latestBackupAgeSeconds = age(live?.latestBackupAt, now)
  const latestArchiveAgeSeconds = age(live?.archiverLastArchivedAt, now)
  const approximateRestoreAgeSeconds = age(live?.maxRestoreTime, now)
  if (live?.available !== true) reasons.push("live_probe_unavailable")
  if (
    live?.backupCoverageError ||
    live?.archiverError ||
    live?.unavailableReason
  )
    reasons.push("live_probe_incomplete")
  if (live?.archiverHealthy !== true) reasons.push("archiver_not_healthy")
  if (!Number.isSafeInteger(live?.backupSetCount) || live.backupSetCount < 1)
    reasons.push("base_backup_missing")
  if (
    latestBackupAgeSeconds === null ||
    latestBackupAgeSeconds > maximumBaseBackupAgeSeconds
  )
    reasons.push("base_backup_stale_or_unknown")
  if (
    latestArchiveAgeSeconds === null ||
    latestArchiveAgeSeconds > maximumArchiveAgeSeconds
  )
    reasons.push("archive_stale_or_unknown")
  if (
    approximateRestoreAgeSeconds === null ||
    approximateRestoreAgeSeconds > maximumArchiveAgeSeconds
  )
    reasons.push("restore_ceiling_stale_or_unknown")
  if (
    typeof live?.walMin !== "string" ||
    !wal.test(live.walMin) ||
    typeof live?.walMax !== "string" ||
    !wal.test(live.walMax) ||
    live.walMin > live.walMax
  )
    reasons.push("wal_coverage_unverified")
  return {
    readOnly: true,
    passed: reasons.length === 0,
    observedAt: now.toISOString(),
    projectId: STAGING.projectId,
    environmentId: STAGING.environmentId,
    serviceId: target.serviceId,
    deploymentId: scope.deploymentId,
    volumeId: scope.volumeId,
    enabled: status.enabled,
    bucketWired: status.bucketWired,
    latestBackupAgeSeconds,
    latestArchiveAgeSeconds,
    approximateRestoreAgeSeconds,
    reasons,
    // CLI maxRestoreTime is a best-effort probe of commit timestamps, not a
    // proof that every required WAL segment is retained or restorable.
    restoreVerified: false,
    offsiteVerified: false,
    imageSecurityVerified: false,
  }
}
