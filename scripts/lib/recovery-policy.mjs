import assert from "node:assert/strict"
import { BACKUP_TARGETS } from "./staging-backups.mjs"
import { STAGING } from "./staging-release.mjs"

export const RECOVERY_TARGET = Object.freeze({
  bucketId: "e48fdf14-924d-4edd-a80a-d05ba17847fc",
  bucketName: "RecoveryArchives",
  serviceId: "913ddfd6-2b39-4188-bd73-6787bc80a313",
  serviceName: "RecoveryBackups",
  mediaServiceId: "a3fe4b80-8be8-4092-977a-54fe9dcca522",
})
export const RECOVERY_SOURCE_SYSTEM_ID = "7527124368992473123"
export const scheduledSourceIdentity = Object.freeze({
  projectId: STAGING.projectId,
  environmentId: STAGING.environmentId,
  serviceId: BACKUP_TARGETS[0].serviceId,
  volumeId: BACKUP_TARGETS[0].volumeId,
  volumeInstanceId: BACKUP_TARGETS[0].instanceId,
  volumeMountPath: BACKUP_TARGETS[0].mount,
})

export const validateScheduledSourceScope = (scope) => {
  assert.deepEqual(
    Object.keys(scope).sort(),
    [
      "archiveSha256",
      "capturedAt",
      "connectionTransport",
      "manifestSha256",
      "mappedEndpointFingerprint",
      "originalEndpointFingerprint",
      "producer",
      "restoreReceiptSha256",
      "schemaVersion",
      "source",
      "sourceMajor",
      "sourceSystemId",
    ].sort()
  )
  assert.equal(scope.schemaVersion, 2)
  assert.deepEqual(scope.source, scheduledSourceIdentity)
  assert.equal(scope.sourceSystemId, RECOVERY_SOURCE_SYSTEM_ID)
  assert.equal(scope.sourceMajor, 16)
  assert.equal(scope.connectionTransport, "railway_private")
  assert.deepEqual(
    Object.keys(scope.producer).sort(),
    [
      "deploymentId",
      "environmentId",
      "projectId",
      "revision",
      "serviceId",
    ].sort()
  )
  assert.equal(scope.producer.projectId, STAGING.projectId)
  assert.equal(scope.producer.environmentId, STAGING.environmentId)
  assert.equal(scope.producer.serviceId, RECOVERY_TARGET.serviceId)
  assert.match(
    scope.producer.deploymentId,
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u
  )
  assert.match(scope.producer.revision, /^[a-f0-9]{40}$/u)
  assert.equal(
    scope.originalEndpointFingerprint,
    scope.mappedEndpointFingerprint
  )
  for (const key of [
    "archiveSha256",
    "manifestSha256",
    "restoreReceiptSha256",
    "originalEndpointFingerprint",
    "mappedEndpointFingerprint",
  ])
    assert.match(scope[key], /^[a-f0-9]{64}$/u)
  assert.equal(new Date(scope.capturedAt).toISOString(), scope.capturedAt)
}
