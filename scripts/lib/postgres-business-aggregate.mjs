import assert from "node:assert/strict"

// The live runner binds this query to the exact Railway source; isolated tests
// also exercise its schema and bounded execution on restored data.
export const businessAggregateSql = `
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5000ms';
SET LOCAL lock_timeout = '1000ms';
SET LOCAL idle_in_transaction_session_timeout = '6000ms';
SET LOCAL search_path = pg_catalog;
SELECT pg_catalog.json_build_object(
  'schemaVersion', 1,
  'physicalRelationCounts', pg_catalog.json_build_object(
    'carts', (SELECT count(*) FROM public.cart),
    'paymentCollections', (SELECT count(*) FROM public.payment_collection),
    'paymentSessions', (SELECT count(*) FROM public.payment_session),
    'payments', (SELECT count(*) FROM public.payment),
    'orders', (SELECT count(*) FROM public."order"),
    'orderCarts', (SELECT count(*) FROM public.order_cart),
    'captures', (SELECT count(*) FROM public.capture),
    'refunds', (SELECT count(*) FROM public.refund),
    'orderTransactions', (SELECT count(*) FROM public.order_transaction)
  ),
  'taxQuoteEvidence', (SELECT pg_catalog.json_build_object(
    'prepared', count(*) FILTER (WHERE status = 'prepared'),
    'succeeded', count(*) FILTER (WHERE status = 'succeeded'),
    'canceled', count(*) FILTER (WHERE status = 'canceled'),
    'failed', count(*) FILTER (WHERE status = 'failed'),
    'associationFailed', count(*) FILTER (WHERE status = 'association_failed'),
    'disputed', count(*) FILTER (WHERE status = 'disputed'),
    'partiallyRefunded', count(*) FILTER (WHERE status = 'partially_refunded'),
    'refunded', count(*) FILTER (WHERE status = 'refunded'),
    'unknown', count(*) FILTER (WHERE status IS NULL OR status NOT IN (
      'prepared', 'succeeded', 'canceled', 'failed',
      'association_failed', 'disputed', 'partially_refunded', 'refunded'
    )),
    'collect', count(*) FILTER (WHERE deleted_at IS NULL AND collection_mode = 'collect'),
    'disabled', count(*) FILTER (WHERE deleted_at IS NULL AND collection_mode = 'disabled'),
    'unknownCollectionMode', count(*) FILTER (WHERE collection_mode IS NULL OR collection_mode NOT IN (
      'collect', 'disabled'
    ))
  ) FROM public.tax_quote_evidences WHERE deleted_at IS NULL),
  'stripeLifecycleEvents', (SELECT pg_catalog.json_build_object(
    'activeTotal', count(*),
    'received', count(*) FILTER (WHERE status = 'received' AND NOT livemode),
    'processing', count(*) FILTER (WHERE status = 'processing' AND NOT livemode),
    'processed', count(*) FILTER (WHERE status = 'processed' AND NOT livemode),
    'ignored', count(*) FILTER (WHERE status = 'ignored' AND NOT livemode),
    'failed', count(*) FILTER (WHERE status = 'failed' AND NOT livemode),
    'unknown', count(*) FILTER (WHERE (status IS NULL OR status NOT IN (
      'received', 'processing', 'processed', 'ignored', 'failed'
    )) AND NOT livemode),
    'livemode', count(*) FILTER (WHERE livemode)
  ) FROM public.stripe_lifecycle_events WHERE deleted_at IS NULL)
);
COMMIT;
`

const relationKeys = [
  "carts",
  "paymentCollections",
  "paymentSessions",
  "payments",
  "orders",
  "orderCarts",
  "captures",
  "refunds",
  "orderTransactions",
]
const taxKeys = [
  "prepared",
  "succeeded",
  "canceled",
  "failed",
  "associationFailed",
  "disputed",
  "partiallyRefunded",
  "refunded",
  "unknown",
  "collect",
  "disabled",
  "unknownCollectionMode",
]
const eventKeys = [
  "activeTotal",
  "received",
  "processing",
  "processed",
  "ignored",
  "failed",
  "unknown",
  "livemode",
]

const exactCounts = (value, keys) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value))
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort())
  for (const key of keys) {
    assert.ok(Number.isSafeInteger(value[key]) && value[key] >= 0)
  }
}

// psql must be invoked with --no-psqlrc --quiet --tuples-only --no-align and
// ON_ERROR_STOP=1. Reject command tags, SQL errors, and any extra output.
export const parseBusinessAggregateOutput = (raw) => {
  try {
    return parseAggregate(raw)
  } catch {
    throw new Error("Invalid PostgreSQL business aggregate.")
  }
}

const parseAggregate = (raw) => {
  assert.equal(typeof raw, "string")
  assert.ok(Buffer.byteLength(raw, "utf8") <= 8192)
  assert.ok(raw.length > 0 && !raw.includes("\n"))
  const value = JSON.parse(raw)
  assert.ok(value && typeof value === "object" && !Array.isArray(value))
  assert.deepEqual(Object.keys(value).sort(), [
    "physicalRelationCounts",
    "schemaVersion",
    "stripeLifecycleEvents",
    "taxQuoteEvidence",
  ])
  assert.equal(value.schemaVersion, 1)
  exactCounts(value.physicalRelationCounts, relationKeys)
  exactCounts(value.taxQuoteEvidence, taxKeys)
  exactCounts(value.stripeLifecycleEvents, eventKeys)
  const taxStatusTotal = taxKeys
    .slice(0, 9)
    .reduce((total, key) => total + value.taxQuoteEvidence[key], 0)
  const taxModeTotal = taxKeys
    .slice(9)
    .reduce((total, key) => total + value.taxQuoteEvidence[key], 0)
  assert.ok(Number.isSafeInteger(taxStatusTotal))
  assert.ok(Number.isSafeInteger(taxModeTotal))
  assert.equal(taxStatusTotal, taxModeTotal)
  const eventPartitionTotal = eventKeys
    .slice(1)
    .reduce((total, key) => total + value.stripeLifecycleEvents[key], 0)
  assert.ok(Number.isSafeInteger(eventPartitionTotal))
  assert.equal(eventPartitionTotal, value.stripeLifecycleEvents.activeTotal)
  return {
    schemaVersion: 1,
    source: "postgres_snapshot_only",
    businessReconciled: false,
    physicalRelationCounts: value.physicalRelationCounts,
    taxQuoteEvidence: value.taxQuoteEvidence,
    stripeLifecycleEvents: value.stripeLifecycleEvents,
  }
}
