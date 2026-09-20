const digestPattern = /^[a-f0-9]{64}$/u

export type ScheduledBullJobIdentity = {
  bull_job_id_sha256: string | null
  bull_job_identity_verified: boolean
}

// Raw BullMQ IDs remain inside the worker and never enter workflow storage.
export const scheduledBullJobIdentity = (
  value: unknown
): ScheduledBullJobIdentity => {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    return {
      bull_job_id_sha256: null,
      bull_job_identity_verified: false,
    }
  }
  return {
    bull_job_id_sha256: value,
    bull_job_identity_verified: true,
  }
}
