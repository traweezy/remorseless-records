import assert from "node:assert/strict"

// This contract is deliberately narrower than the Medusa ledger. The link
// columns follow the verified staging archive schema and Medusa link modules;
// an unknown schema fails before any relationship query runs.
const requiredColumns = {
  cart: ["id", "deleted_at"],
  order: ["id", "deleted_at"],
  payment_collection: ["id", "currency_code", "deleted_at"],
  payment_session: ["id", "payment_collection_id", "deleted_at"],
  payment: [
    "id",
    "amount",
    "currency_code",
    "provider_id",
    "data",
    "payment_collection_id",
    "payment_session_id",
    "deleted_at",
  ],
  capture: ["id", "amount", "payment_id", "deleted_at"],
  refund: ["id", "amount", "payment_id", "deleted_at"],
  order_cart: ["id", "order_id", "cart_id", "deleted_at"],
  order_payment_collection: [
    "id",
    "order_id",
    "payment_collection_id",
    "deleted_at",
  ],
  cart_payment_collection: [
    "id",
    "cart_id",
    "payment_collection_id",
    "deleted_at",
  ],
  tax_quote_evidences: [
    "id",
    "cart_id",
    "order_id",
    "payment_intent_id",
    "amount_minor",
    "currency_code",
    "status",
    "deleted_at",
  ],
  stripe_lifecycle_events: [
    "id",
    "payment_intent_id",
    "status",
    "livemode",
    "deleted_at",
  ],
}

const required = Object.entries(requiredColumns).flatMap(([table, columns]) =>
  columns.map((column) => `('${table}', '${column}')`)
)

export const businessParitySchemaSql = `
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5000ms';
SET LOCAL lock_timeout = '1000ms';
SET LOCAL search_path = pg_catalog;
WITH required(table_name, column_name) AS (VALUES ${required.join(", ")})
SELECT pg_catalog.json_build_object(
  'schemaVersion', 1,
  'requiredColumns', count(*),
  'presentColumns', count(a.attname)
)
FROM required r
LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
LEFT JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid
  AND c.relname = r.table_name AND c.relkind IN ('r', 'p')
LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
  AND a.attname = r.column_name AND a.attnum > 0 AND NOT a.attisdropped;
COMMIT;
`

const limits = {
  carts: 1000,
  orders: 100,
  paymentCollections: 500,
  paymentSessions: 500,
  payments: 100,
  stripePayments: 100,
  captures: 100,
  refunds: 100,
  orderCartLinks: 100,
  orderPaymentLinks: 100,
  cartPaymentLinks: 500,
  taxEvidence: 100,
  lifecycleEvents: 500,
}

export const businessParitySql = `
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5000ms';
SET LOCAL lock_timeout = '1000ms';
SET LOCAL idle_in_transaction_session_timeout = '6000ms';
SET LOCAL search_path = pg_catalog;
WITH
  carts AS MATERIALIZED (SELECT id FROM public.cart WHERE deleted_at IS NULL LIMIT 1001),
  orders AS MATERIALIZED (SELECT id FROM public."order" WHERE deleted_at IS NULL LIMIT 101),
  collections AS MATERIALIZED (SELECT id, currency_code FROM public.payment_collection WHERE deleted_at IS NULL LIMIT 501),
  sessions AS MATERIALIZED (SELECT id, payment_collection_id FROM public.payment_session WHERE deleted_at IS NULL LIMIT 501),
  payments AS MATERIALIZED (SELECT id, amount, currency_code, provider_id, data, payment_collection_id, payment_session_id FROM public.payment WHERE deleted_at IS NULL LIMIT 101),
  captures AS MATERIALIZED (SELECT id, amount, payment_id FROM public.capture WHERE deleted_at IS NULL LIMIT 101),
  refunds AS MATERIALIZED (SELECT id, amount, payment_id FROM public.refund WHERE deleted_at IS NULL LIMIT 101),
  order_carts AS MATERIALIZED (SELECT id, order_id, cart_id FROM public.order_cart WHERE deleted_at IS NULL LIMIT 101),
  order_collections AS MATERIALIZED (SELECT id, order_id, payment_collection_id FROM public.order_payment_collection WHERE deleted_at IS NULL LIMIT 101),
  cart_collections AS MATERIALIZED (SELECT id, cart_id, payment_collection_id FROM public.cart_payment_collection WHERE deleted_at IS NULL LIMIT 501),
  tax AS MATERIALIZED (SELECT id, cart_id, order_id, payment_intent_id, amount_minor, currency_code, status FROM public.tax_quote_evidences WHERE deleted_at IS NULL LIMIT 101),
  events AS MATERIALIZED (SELECT id, payment_intent_id, status, livemode FROM public.stripe_lifecycle_events WHERE deleted_at IS NULL LIMIT 501),
  stripe_payments AS MATERIALIZED (SELECT p.*, p.data->>'id' AS intent_id FROM payments p WHERE p.provider_id = 'pp_stripe_stripe'),
  scanned AS (SELECT pg_catalog.json_build_object(
    'carts', (SELECT count(*) FROM carts),
    'orders', (SELECT count(*) FROM orders),
    'paymentCollections', (SELECT count(*) FROM collections),
    'paymentSessions', (SELECT count(*) FROM sessions),
    'payments', (SELECT count(*) FROM payments),
    'stripePayments', (SELECT count(*) FROM stripe_payments),
    'captures', (SELECT count(*) FROM captures),
    'refunds', (SELECT count(*) FROM refunds),
    'orderCartLinks', (SELECT count(*) FROM order_carts),
    'orderPaymentLinks', (SELECT count(*) FROM order_collections),
    'cartPaymentLinks', (SELECT count(*) FROM cart_collections),
    'taxEvidence', (SELECT count(*) FROM tax),
    'lifecycleEvents', (SELECT count(*) FROM events)
  ) AS value)
SELECT pg_catalog.json_build_object(
  'schemaVersion', 1,
  'scanned', (SELECT value FROM scanned),
  'mismatches', pg_catalog.json_build_object(
    'orderCartOrphan', (SELECT count(*) FROM order_carts l WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = l.order_id) OR NOT EXISTS (SELECT 1 FROM carts c WHERE c.id = l.cart_id)),
    'orderPaymentOrphan', (SELECT count(*) FROM order_collections l WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = l.order_id) OR NOT EXISTS (SELECT 1 FROM collections c WHERE c.id = l.payment_collection_id)),
    'cartPaymentOrphan', (SELECT count(*) FROM cart_collections l WHERE NOT EXISTS (SELECT 1 FROM carts c WHERE c.id = l.cart_id) OR NOT EXISTS (SELECT 1 FROM collections pc WHERE pc.id = l.payment_collection_id)),
    'paymentRelation', (SELECT count(*) FROM payments p WHERE NOT EXISTS (SELECT 1 FROM collections pc WHERE pc.id = p.payment_collection_id) OR NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = p.payment_session_id AND s.payment_collection_id = p.payment_collection_id)),
    'paymentCurrency', (SELECT count(*) FROM payments p JOIN collections pc ON pc.id = p.payment_collection_id WHERE lower(p.currency_code) <> lower(pc.currency_code)),
    'unsupportedPaymentProvider', (SELECT count(*) FROM payments p WHERE p.provider_id IS DISTINCT FROM 'pp_stripe_stripe'),
    'malformedStripeIntent', (SELECT count(*) FROM stripe_payments p WHERE p.intent_id IS NULL OR p.intent_id !~ '^pi_[A-Za-z0-9]+$'),
    'duplicateStripeIntent', (SELECT coalesce(sum(n - 1), 0) FROM (SELECT count(*) AS n FROM stripe_payments WHERE intent_id ~ '^pi_[A-Za-z0-9]+$' GROUP BY intent_id HAVING count(*) > 1) d),
    'stripePaymentTaxEvidenceMissing', (SELECT count(*) FROM stripe_payments p WHERE p.intent_id ~ '^pi_[A-Za-z0-9]+$' AND NOT EXISTS (SELECT 1 FROM tax t WHERE t.payment_intent_id = p.intent_id)),
    'taxPaymentMissing', (SELECT count(*) FROM tax t WHERE NOT EXISTS (SELECT 1 FROM stripe_payments p WHERE p.intent_id = t.payment_intent_id)),
    'taxCartLink', (SELECT count(DISTINCT t.id) FROM tax t JOIN stripe_payments p ON p.intent_id = t.payment_intent_id WHERE NOT EXISTS (SELECT 1 FROM cart_collections l WHERE l.cart_id = t.cart_id AND l.payment_collection_id = p.payment_collection_id)),
    'taxOrderCart', (SELECT count(*) FROM tax t WHERE t.order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM order_carts l WHERE l.order_id = t.order_id AND l.cart_id = t.cart_id)),
    'taxOrderLink', (SELECT count(DISTINCT t.id) FROM tax t JOIN stripe_payments p ON p.intent_id = t.payment_intent_id WHERE t.order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM order_collections l WHERE l.order_id = t.order_id AND l.payment_collection_id = p.payment_collection_id)),
    'taxCurrency', (SELECT count(DISTINCT t.id) FROM tax t JOIN stripe_payments p ON p.intent_id = t.payment_intent_id WHERE lower(t.currency_code) <> lower(p.currency_code)),
    'taxAmountUsd', (SELECT count(DISTINCT t.id) FROM tax t JOIN stripe_payments p ON p.intent_id = t.payment_intent_id WHERE lower(t.currency_code) = 'usd' AND (p.amount * 100 <> t.amount_minor OR p.amount < 0)),
    'unsupportedTaxCurrency', (SELECT count(*) FROM tax t WHERE lower(t.currency_code) <> 'usd'),
    'capturePaymentOrphan', (SELECT count(*) FROM captures c WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = c.payment_id)),
    'refundPaymentOrphan', (SELECT count(*) FROM refunds r WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = r.payment_id)),
    'captureExcess', (SELECT count(*) FROM payments p WHERE (SELECT coalesce(sum(c.amount), 0) FROM captures c WHERE c.payment_id = p.id) > p.amount),
    'refundExcess', (SELECT count(*) FROM payments p WHERE (SELECT coalesce(sum(r.amount), 0) FROM refunds r WHERE r.payment_id = p.id) > (SELECT coalesce(sum(c.amount), 0) FROM captures c WHERE c.payment_id = p.id)),
    'processedEventPaymentMissing', (SELECT count(*) FROM events e WHERE e.status = 'processed' AND e.payment_intent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM stripe_payments p WHERE p.intent_id = e.payment_intent_id)),
    'livemodeEvent', (SELECT count(*) FROM events e WHERE e.livemode)
  )
);
COMMIT;
`

const countObject = (value, keys) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value))
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort())
  for (const key of keys)
    assert.ok(Number.isSafeInteger(value[key]) && value[key] >= 0)
}

const parseLine = (raw, label) => {
  try {
    assert.equal(typeof raw, "string")
    assert.ok(Buffer.byteLength(raw, "utf8") <= 8192)
    assert.ok(raw.length > 0 && !raw.includes("\n"))
    return JSON.parse(raw)
  } catch {
    throw new Error(`Invalid PostgreSQL business ${label}.`)
  }
}

export const parseBusinessParitySchema = (raw) => {
  try {
    const value = parseLine(raw, "schema")
    countObject(value, ["schemaVersion", "requiredColumns", "presentColumns"])
    assert.equal(value.schemaVersion, 1)
    assert.equal(value.requiredColumns, required.length)
    assert.equal(value.presentColumns, required.length)
    return true
  } catch {
    throw new Error("Invalid PostgreSQL business schema.")
  }
}

const mismatchKeys = [
  "orderCartOrphan",
  "orderPaymentOrphan",
  "cartPaymentOrphan",
  "paymentRelation",
  "paymentCurrency",
  "unsupportedPaymentProvider",
  "malformedStripeIntent",
  "duplicateStripeIntent",
  "stripePaymentTaxEvidenceMissing",
  "taxPaymentMissing",
  "taxCartLink",
  "taxOrderCart",
  "taxOrderLink",
  "taxCurrency",
  "taxAmountUsd",
  "unsupportedTaxCurrency",
  "capturePaymentOrphan",
  "refundPaymentOrphan",
  "captureExcess",
  "refundExcess",
  "processedEventPaymentMissing",
  "livemodeEvent",
]

export const parseBusinessParityOutput = (raw) => {
  try {
    const value = parseLine(raw, "parity")
    assert.deepEqual(Object.keys(value).sort(), [
      "mismatches",
      "scanned",
      "schemaVersion",
    ])
    assert.equal(value.schemaVersion, 1)
    countObject(value.scanned, Object.keys(limits))
    countObject(value.mismatches, mismatchKeys)
    for (const [key, limit] of Object.entries(limits))
      assert.ok(value.scanned[key] <= limit)
    assert.ok(value.scanned.stripePayments <= value.scanned.payments)
    assert.ok(value.scanned.payments === 0 || value.scanned.stripePayments > 0)
    for (const key of mismatchKeys) assert.ok(value.mismatches[key] <= 1000)
    assert.equal(
      value.mismatches.unsupportedPaymentProvider,
      value.scanned.payments - value.scanned.stripePayments
    )
    return {
      schemaVersion: 1,
      source: "verified_isolated_postgres_restore_only",
      readOnly: true,
      businessReconciled: false,
      scanned: value.scanned,
      mismatches: value.mismatches,
    }
  } catch {
    throw new Error("Invalid PostgreSQL business parity.")
  }
}
