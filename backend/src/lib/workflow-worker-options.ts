export const WORKFLOW_JOB_WORKER_OPTIONS = {
  // The staging failures were delayed for up to 245 seconds before the
  // scheduled handler started. Keep a bounded recovery window above that
  // observation while renewing frequently during healthy operation.
  lockDuration: 5 * 60 * 1_000,
  lockRenewTime: 30 * 1_000,
} as const

export const CHECKOUT_RECONCILIATION_LOCK_TTL_SECONDS =
  WORKFLOW_JOB_WORKER_OPTIONS.lockDuration / 1_000
