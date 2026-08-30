import {
  CHECKOUT_RECONCILIATION_LOCK_TTL_SECONDS,
  WORKFLOW_JOB_WORKER_OPTIONS,
} from "./workflow-worker-options"

describe("workflow worker options", () => {
  it("keeps scheduled-job locks above the measured staging delay", () => {
    expect(WORKFLOW_JOB_WORKER_OPTIONS).toEqual({
      lockDuration: 300_000,
      lockRenewTime: 30_000,
    })
    expect(CHECKOUT_RECONCILIATION_LOCK_TTL_SECONDS).toBe(300)
    expect(WORKFLOW_JOB_WORKER_OPTIONS.lockDuration).toBeGreaterThan(245_000)
    expect(WORKFLOW_JOB_WORKER_OPTIONS.lockRenewTime).toBeLessThan(
      WORKFLOW_JOB_WORKER_OPTIONS.lockDuration / 2
    )
  })
})
