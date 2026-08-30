import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const backendRequire = createRequire(
  join(repositoryRoot, "backend", "package.json")
)

const packageRoot = (packageName) =>
  dirname(dirname(backendRequire.resolve(packageName)))
const readRepositoryFile = (relativePath) =>
  readFile(join(repositoryRoot, relativePath), "utf8")
const readPackageFile = (root, relativePath) =>
  readFile(join(root, relativePath), "utf8")

const coreFlowsRoot = packageRoot("@medusajs/core-flows")
const notificationRoot = packageRoot("@medusajs/notification")
const paymentRoot = packageRoot("@medusajs/payment")
const resendRoot = packageRoot("resend")

const [
  coreFlowsPackageSource,
  notificationPackageSource,
  paymentPackageSource,
  resendPackageSource,
  completeCartSource,
  compensatePaymentSource,
  notificationModelSource,
  notificationServiceSource,
  paymentServiceSource,
  resendClientSource,
  reconciliationSource,
  lifecycleJobSource,
  lifecycleProcessorSource,
  taxEvidenceJobSource,
  taxEvidenceReconciliationSource,
  stripeEvidenceClientSource,
  resendSource,
  orderNotificationSource,
  refundNotificationSource,
] = await Promise.all([
  readPackageFile(coreFlowsRoot, "package.json"),
  readPackageFile(notificationRoot, "package.json"),
  readPackageFile(paymentRoot, "package.json"),
  readPackageFile(resendRoot, "package.json"),
  readPackageFile(coreFlowsRoot, "dist/cart/workflows/complete-cart.js"),
  readPackageFile(
    coreFlowsRoot,
    "dist/cart/steps/compensate-payment-if-needed.js"
  ),
  readPackageFile(notificationRoot, "dist/models/notification.js"),
  readPackageFile(
    notificationRoot,
    "dist/services/notification-module-service.js"
  ),
  readPackageFile(paymentRoot, "dist/services/payment-module.js"),
  readPackageFile(resendRoot, "dist/index.cjs"),
  readRepositoryFile("backend/src/lib/checkout/reconciliation.ts"),
  readRepositoryFile("backend/src/jobs/reconcile-stripe-lifecycle-events.ts"),
  readRepositoryFile(
    "backend/src/lib/payment-lifecycle/process-stripe-event.ts"
  ),
  readRepositoryFile("backend/src/jobs/reconcile-tax-evidence.ts"),
  readRepositoryFile("backend/src/lib/tax-control/evidence-reconciliation.ts"),
  readRepositoryFile("backend/src/lib/tax-control/stripe-evidence-client.ts"),
  readRepositoryFile(
    "backend/src/modules/email-notifications/services/resend.ts"
  ),
  readRepositoryFile("backend/src/subscribers/order-placed.ts"),
  readRepositoryFile("backend/src/lib/refund-operations/notification.ts"),
])

assert.equal(JSON.parse(coreFlowsPackageSource).version, "2.18.0")
assert.equal(JSON.parse(notificationPackageSource).version, "2.18.0")
assert.equal(JSON.parse(paymentPackageSource).version, "2.18.0")
assert.equal(JSON.parse(resendPackageSource).version, "6.18.0")

const assertOrdered = (source, markers) => {
  let priorIndex = -1
  for (const marker of markers) {
    const index = source.indexOf(marker)
    assert.notEqual(index, -1, `Missing recovery marker: ${marker}`)
    assert.ok(index > priorIndex, `Recovery marker is out of order: ${marker}`)
    priorIndex = index
  }
}

assert.match(completeCartSource, /acquireLockStep\)\(\{\s*key: input\.id,/u)
assert.match(completeCartSource, /entity: "order_cart"/u)
assert.match(completeCartSource, /filters: \{ cart_id: input\.id \}/u)
assert.match(completeCartSource, /return !orderId\b/u)
assert.match(completeCartSource, /releaseLockStep\)\(\{\s*key: input\.id,/u)
assertOrdered(completeCartSource, [
  'entity: "order_cart"',
  'when)("create-order"',
  "(0, authorize_payment_session_1.authorizePaymentSessionStep)(",
  "(0, release_lock_1.releaseLockStep)(",
])

assert.match(
  paymentServiceSource,
  /if \(session\.payment && session\.authorized_at\)/u
)
assert.match(paymentServiceSource, /idempotency_key: session\.id/u)
assert.match(paymentServiceSource, /idempotency_key: refund\.id/u)
assert.match(paymentServiceSource, /SET LOCAL lock_timeout = '3s'/u)
assert.ok(
  paymentServiceSource.match(/\.forUpdate\(\)\.select\("id"\)/gu)?.length >= 2,
  "Payment capture and refund must retain row-lock serialization."
)

assertOrdered(compensatePaymentSource, [
  'entity: "order_cart"',
  "if (orderCartLink?.order_id)",
  "refundPaymentAndRecreatePaymentSessionWorkflow",
])

assert.match(
  notificationModelSource,
  /idempotency_key: utils_1\.model\.text\(\)\.unique\(\)\.nullable\(\)/u
)
assertOrdered(notificationServiceSource, [
  "const idempotencyKeys = data",
  "idempotency_key: idempotencyKeys",
  "utils_1.NotificationStatus.FAILURE",
  ".send(provider, entry.data)",
])

const resendEmailsSource = resendClientSource.slice(
  resendClientSource.indexOf("//#region src/emails/emails.ts")
)
assertOrdered(resendEmailsSource, [
  "async send(payload, options = {})",
  "this.create(payload, options)",
  'this.resend.post("/emails", parseEmailToApiOptions(body), options)',
])
const resendPostSource = resendClientSource.slice(
  resendClientSource.indexOf("async post(path, entity, options = {})")
)
assertOrdered(resendPostSource, [
  'headers.set("Idempotency-Key", options.idempotencyKey)',
  "const requestOptions = {",
  "...options",
  "return this.fetchRequest(path, requestOptions)",
])

assert.match(reconciliationSource, /CHECKOUT_RECONCILIATION_METADATA_KEY/u)
assert.match(reconciliationSource, /state: "review_required"/u)
assert.match(reconciliationSource, /heldForReview/u)
assertOrdered(reconciliationSource, [
  "if (await hasOrder(query, cartId))",
  "if (cartHasReconciliationAttempt(fresh))",
  "await updateCartMetadata",
  "await completeCart(cartId)",
])

const forbiddenScheduledProviderMutation =
  /\.(?:charges|paymentIntents|refunds)\.(?:cancel|capture|confirm|create|refund|update)\s*\(|\.emails\.send\s*\(/u
for (const source of [
  lifecycleJobSource,
  lifecycleProcessorSource,
  taxEvidenceJobSource,
  taxEvidenceReconciliationSource,
  stripeEvidenceClientSource,
]) {
  assert.doesNotMatch(source, forbiddenScheduledProviderMutation)
}
const lifecycleProcessorBody = lifecycleProcessorSource.slice(
  lifecycleProcessorSource.indexOf("export const processStripeLifecycleEvent")
)
assertOrdered(lifecycleProcessorBody, [
  'lifecycleEvent.status === "processed"',
  "const reader = createStripeEvidenceReader",
  "const current = await reader.readLifecycleObject",
  "assertCurrentObjectMatches",
  "await reader.readIntent",
  "reconcileTaxQuoteEvidence",
])
assert.match(stripeEvidenceClientSource, /const MAX_NETWORK_RETRIES = 0\b/u)
assert.match(
  stripeEvidenceClientSource,
  /maxNetworkRetries: MAX_NETWORK_RETRIES/u
)
assert.match(lifecycleJobSource, /stripeLifecycleEventIsDue/u)
assert.match(lifecycleJobSource, /PROCESSING_STALE_MS/u)

assert.match(resendSource, /IDEMPOTENCY_REQUIRED_TEMPLATES/u)
assert.match(resendSource, /idempotencyKey: providerIdempotencyKey/u)
assert.match(resendSource, /AbortSignal\.timeout/u)
assert.match(resendSource, /if \(result\.error\)/u)
assert.match(orderNotificationSource, /emailIdempotencyFields/u)
assert.match(refundNotificationSource, /emailIdempotencyFields/u)

console.log(
  "Checkout recovery boundary verified: Medusa cart/payment guards, durable scheduled-attempt holds, and provider-level email idempotency are intact."
)
