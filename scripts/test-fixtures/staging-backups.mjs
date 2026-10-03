import { BACKUP_TARGETS } from "../lib/staging-backups.mjs"
import { STAGING } from "../lib/staging-release.mjs"

export const backupFixture = (now = new Date()) => {
  const day = 86_400_000
  return Object.fromEntries(
    BACKUP_TARGETS.flatMap((target, index) => [
      [
        target.alias,
        {
          id: target.instanceId,
          environmentId: STAGING.environmentId,
          serviceId: target.serviceId,
          volumeId: target.volumeId,
          mountPath: target.mount,
          state: "READY",
          deletedAt: null,
          isPendingDeletion: false,
          sizeMB: 50_000,
          currentSizeMB: 1_000,
          environment: {
            id: STAGING.environmentId,
            projectId: STAGING.projectId,
            name: "staging",
          },
          service: { id: target.serviceId, name: target.name },
          privateValue: "private-backup-canary",
        },
      ],
      [
        `${target.alias}Schedules`,
        [
          {
            id: target.scheduleId,
            kind: "DAILY",
            cron: target.cron,
            retentionSeconds: 518_400,
            createdAt: new Date(now.getTime() - 10 * day).toISOString(),
          },
        ],
      ],
      [
        `${target.alias}Backups`,
        [0, 1].map((offset) => {
          const created = now.getTime() - 6 * 3_600_000 - offset * day
          return {
            id: `${String(index * 10 + offset).padStart(8, "0")}-2222-4333-8444-555555555555`,
            createdAt: new Date(created).toISOString(),
            expiresAt: new Date(created + 6 * day).toISOString(),
            scheduleId: target.scheduleId,
            referencedMB: 1_000,
            usedMB: 10,
            volumeInstanceSizeMB: 50_000,
            name: "private-backup-canary",
          }
        }),
      ],
    ])
  )
}
