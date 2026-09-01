import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))

const requirements = [
  {
    id: "checkout.exact_amount",
    file: "storefront/src/features/checkout/server/payment.test.ts",
    marker: "uses the official provider's cent rounding for taxable totals",
  },
  {
    id: "checkout.tax_disabled",
    file: "storefront/src/features/checkout/server/payment.test.ts",
    marker: "reuses and completes an explicit disabled-tax payment",
  },
  {
    id: "checkout.success",
    file: "storefront/src/app/api/checkout/complete/route.test.ts",
    marker:
      "revalidates the revision, shipping, tax, and payment before completion",
  },
  {
    id: "checkout.authentication",
    file: "storefront/src/features/checkout/components/payment-section.test.tsx",
    marker:
      "keeps a definite authentication failure retryable without completing",
  },
  {
    id: "checkout.declines",
    file: "storefront/src/features/checkout/lib/checkout-copy.test.ts",
    marker: "uses a safe generic decline message for unknown decline codes",
  },
  {
    id: "checkout.browser_close",
    file: "storefront/src/features/checkout/components/checkout-recovery.test.tsx",
    marker:
      "restores a confirmed order after the browser leaves before receipt navigation",
  },
  {
    id: "checkout.response_loss_server",
    file: "storefront/src/app/api/checkout/complete/route.test.ts",
    marker: "recovers a lost response after Medusa authoritatively completes",
  },
  {
    id: "checkout.response_loss_browser",
    file: "storefront/src/features/checkout/components/payment-section.test.tsx",
    marker:
      "reconciles instead of inviting a retry after confirmation is uncertain",
  },
  {
    id: "checkout.ambiguous_stripe_result",
    file: "storefront/src/features/checkout/components/payment-section.test.tsx",
    marker: "enters recovery when Stripe returns an ambiguous %s",
  },
  {
    id: "checkout.duplicate_submit",
    file: "storefront/src/features/checkout/components/payment-section.test.tsx",
    marker: "synchronously blocks duplicate paid-order submissions",
  },
  {
    id: "checkout.concurrent_tabs",
    file: "scripts/verify-checkout-recovery-boundary.mjs",
    marker: "acquireLockStep",
  },
  {
    id: "checkout.recovery_finalizing",
    file: "storefront/src/features/checkout/components/checkout-recovery.test.tsx",
    marker:
      "waits through a finalizing state and never invites another payment",
  },
  {
    id: "checkout.return_sanitization",
    file: "storefront/src/app/checkout/return/route.test.ts",
    marker: "strips all provider parameters before rendering recovery UI",
  },
  {
    id: "checkout.receipt_grant",
    file: "storefront/src/app/api/checkout/status/route.test.ts",
    marker:
      "turns authoritative backend completion into a signed receipt grant",
  },
  {
    id: "checkout.scheduler_browser_close",
    file: "backend/src/lib/checkout/reconciliation.test.ts",
    marker:
      "recovers one authorized cart after the browser closes before completion",
  },
  {
    id: "refund.no_refund",
    file: "backend/src/lib/refund-operations/projection.test.ts",
    marker: "omits payments without refund or dispute signals",
  },
  {
    id: "refund.stripe_tax",
    file: "backend/src/lib/refund-operations/projection.test.ts",
    marker: "marks a reconciled Stripe Tax refund as verified",
  },
  {
    id: "refund.taxrate_io",
    file: "backend/src/lib/refund-operations/projection.test.ts",
    marker: "does not require a Stripe Tax reversal for TaxRate.io",
  },
  {
    id: "refund.tax_disabled",
    file: "backend/src/lib/refund-operations/projection.test.ts",
    marker: "verifies a matched refund when tax collection was disabled",
  },
  {
    id: "refund.full_and_repeated_partial",
    file: "backend/src/lib/refund-operations/projection.test.ts",
    marker: "verifies full and repeated partial refunds from exact ledgers",
  },
  {
    id: "refund.in_flight",
    file: "backend/src/lib/refund-operations/projection.test.ts",
    marker:
      "keeps a %s provider refund in processing without suggesting a retry",
  },
  {
    id: "refund.failed_and_canceled",
    file: "backend/src/lib/refund-operations/projection.test.ts",
    marker: "requires action for a %s provider refund",
  },
  {
    id: "refund.direct_stripe",
    file: "backend/src/lib/refund-operations/projection.test.ts",
    marker: "guards against a refund made directly in Stripe",
  },
  {
    id: "refund.medusa_ahead",
    file: "backend/src/lib/refund-operations/projection.test.ts",
    marker: "does not suggest a retry while Medusa is ahead of Stripe",
  },
  {
    id: "refund.dispute",
    file: "backend/src/lib/refund-operations/projection.test.ts",
    marker: "makes a dispute the highest-priority action",
  },
  {
    id: "refund.missing_reversal",
    file: "backend/src/lib/refund-operations/projection.test.ts",
    marker: "keeps a missing Stripe Tax reversal in processing",
  },
  {
    id: "refund.compensation_without_order",
    file: "backend/src/lib/refund-operations/projection.test.ts",
    marker: "surfaces checkout compensation refunds that have no order",
  },
  {
    id: "refund.notification_per_partial",
    file: "backend/src/lib/refund-operations/notification.test.ts",
    marker: "builds one idempotent message for every partial refund",
  },
  {
    id: "refund.invalid_notification_amount",
    file: "backend/src/lib/refund-operations/notification.test.ts",
    marker: "drops malformed amounts instead of sending a misleading email",
  },
  {
    id: "refund.duplicate_notification_id",
    file: "backend/src/lib/refund-operations/notification.test.ts",
    marker: "rejects duplicate refund IDs before building a partial batch",
  },
  {
    id: "refund.invalid_signature",
    file: "backend/src/api/webhooks/stripe/lifecycle/route.test.ts",
    marker: "rejects invalid signatures before resolving application services",
  },
  {
    id: "refund.duplicate_receipt",
    file: "backend/src/modules/payment-lifecycle/service.test.ts",
    marker: "returns an exact persisted replay without writing",
  },
  {
    id: "refund.queue_failure",
    file: "backend/src/api/webhooks/stripe/lifecycle/route.test.ts",
    marker: "records a retryable failure when the async queue is unavailable",
  },
  {
    id: "refund.stale_processing",
    file: "backend/src/jobs/reconcile-stripe-lifecycle-events.test.ts",
    marker: "stale processing receipt",
  },
  {
    id: "refund.missing_payment_intent",
    file: "backend/src/lib/payment-lifecycle/process-stripe-event.test.ts",
    marker: "records non-PaymentIntent refunds as ignored without retrying",
  },
  {
    id: "refund.reversal_per_refund",
    file: "backend/src/lib/tax-control/evidence-reconciliation.test.ts",
    marker:
      "keeps a second partial refund pending until its own reversal appears",
  },
]

const requirementIds = requirements.map(({ id }) => id)
assert.equal(new Set(requirementIds).size, requirementIds.length)

const sources = new Map()
await Promise.all(
  [...new Set(requirements.map(({ file }) => file))].map(async (file) => {
    sources.set(file, await readFile(join(repositoryRoot, file), "utf8"))
  })
)

for (const { file, id, marker } of requirements) {
  assert.ok(
    sources.get(file)?.includes(marker),
    `${id} is missing its executable evidence marker in ${file}: ${marker}`
  )
}

const [checkoutRunbook, refundRunbook, hardeningPlan, packageSource] =
  await Promise.all([
    readFile(join(repositoryRoot, "docs/CHECKOUT_OPERATIONS.md"), "utf8"),
    readFile(join(repositoryRoot, "docs/REFUND_OPERATIONS.md"), "utf8"),
    readFile(join(repositoryRoot, "docs/PRODUCTION_HARDENING_PLAN.md"), "utf8"),
    readFile(join(repositoryRoot, "package.json"), "utf8"),
  ])
for (const marker of [
  "## Staging payment matrix",
  "## Customer-journey recovery matrix",
  "## July 25, 2026 staging evidence",
]) {
  assert.ok(
    checkoutRunbook.includes(marker),
    `Checkout runbook lost: ${marker}`
  )
}
for (const marker of [
  "## Edge-case policy matrix",
  "## Required test matrix",
  "Tax not collected",
]) {
  assert.ok(refundRunbook.includes(marker), `Refund runbook lost: ${marker}`)
}
for (const marker of [
  "Staging Stripe checkout response-loss acceptance passed",
  "Staging Stripe lifecycle event acceptance passed",
]) {
  assert.ok(
    hardeningPlan.includes(marker),
    `Hardening evidence lost: ${marker}`
  )
}

const packageManifest = JSON.parse(packageSource)
assert.equal(
  packageManifest.scripts?.["qa:commerce-reliability"],
  "node scripts/verify-commerce-reliability-matrix.mjs"
)
assert.match(
  packageManifest.scripts?.["qa:lint"] ?? "",
  /pnpm run qa:commerce-reliability/u
)

console.log(
  `Commerce reliability matrix verified: ${requirements.length} checkout/refund requirements retain executable evidence.`
)
