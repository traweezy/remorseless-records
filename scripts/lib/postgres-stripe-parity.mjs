import assert from "node:assert/strict"

// This private descriptor is consumed in memory by the account-bound provider
// reader. It is never published as a recovery report or written to disk.
export const postgresStripeDescriptorSql = `
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5000ms';
SET LOCAL lock_timeout = '1000ms';
SET LOCAL idle_in_transaction_session_timeout = '6000ms';
SET LOCAL search_path = pg_catalog;
WITH
  payments AS MATERIALIZED (
    SELECT id, amount, currency_code, provider_id, data
    FROM public.payment WHERE deleted_at IS NULL ORDER BY id LIMIT 8
  ),
  tax AS MATERIALIZED (
    SELECT payment_intent_id, amount_minor, currency_code
    FROM public.tax_quote_evidences
    WHERE deleted_at IS NULL ORDER BY id LIMIT 101
  )
SELECT pg_catalog.json_build_object(
  'schemaVersion', 1,
  'paymentCount', (SELECT count(*) FROM payments),
  'taxCount', (SELECT count(*) FROM tax),
  'records', coalesce((SELECT pg_catalog.json_agg(
    pg_catalog.json_build_object(
      'paymentIntentId', p.data->>'id',
      'medusaAmountMajor', p.amount::text,
      'medusaCurrencyCode', lower(p.currency_code),
      'providerId', p.provider_id,
      'providerAmountMinor', CASE
        WHEN p.data->>'amount' ~ '^[1-9][0-9]{0,7}$'
        THEN (p.data->>'amount')::integer ELSE NULL END,
      'providerCurrencyCode', CASE
        WHEN p.data->>'currency' ~ '^[a-z]{3}$'
        THEN p.data->>'currency' ELSE NULL END,
      'taxMatches', (SELECT count(*) FROM tax t
        WHERE t.payment_intent_id = p.data->>'id'),
      'taxAmountMinor', (SELECT min(t.amount_minor) FROM tax t
        WHERE t.payment_intent_id = p.data->>'id'),
      'taxCurrencyCode', (SELECT min(lower(t.currency_code)) FROM tax t
        WHERE t.payment_intent_id = p.data->>'id')
    ) ORDER BY p.id
  ) FROM payments p), '[]'::json)
);
COMMIT;
`

const recordKeys = [
  "medusaAmountMajor",
  "medusaCurrencyCode",
  "paymentIntentId",
  "providerAmountMinor",
  "providerCurrencyCode",
  "providerId",
  "taxAmountMinor",
  "taxCurrencyCode",
  "taxMatches",
]

export const parsePostgresStripeDescriptor = (raw, expectedCounts) => {
  try {
    assert.equal(typeof raw, "string")
    assert.ok(raw.length > 0 && Buffer.byteLength(raw, "utf8") <= 8192)
    assert.ok(!raw.includes("\n"))
    const value = JSON.parse(raw)
    assert.deepEqual(Object.keys(value).sort(), [
      "paymentCount",
      "records",
      "schemaVersion",
      "taxCount",
    ])
    assert.equal(value.schemaVersion, 1)
    assert.ok(Array.isArray(value.records))
    assert.ok(value.records.length >= 1 && value.records.length <= 7)
    assert.equal(value.paymentCount, value.records.length)
    assert.equal(value.paymentCount, expectedCounts.payments)
    assert.equal(value.taxCount, expectedCounts.taxEvidence)
    assert.ok(value.taxCount <= 100)
    const ids = new Set()
    let matchedTax = 0
    const records = value.records.map((record) => {
      assert.ok(record && typeof record === "object" && !Array.isArray(record))
      assert.deepEqual(Object.keys(record).sort(), recordKeys)
      assert.equal(record.providerId, "pp_stripe_stripe")
      assert.match(record.paymentIntentId, /^pi_[A-Za-z0-9]{1,252}$/)
      assert.ok(!ids.has(record.paymentIntentId))
      ids.add(record.paymentIntentId)
      assert.match(
        record.medusaAmountMajor,
        /^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/
      )
      assert.equal(record.medusaCurrencyCode, "usd")
      assert.ok(record.taxMatches === 0 || record.taxMatches === 1)
      if (record.taxMatches === 1) matchedTax += 1
      assert.equal(record.taxAmountMinor === null, record.taxMatches === 0)
      assert.equal(record.taxCurrencyCode === null, record.taxMatches === 0)
      if (record.taxAmountMinor !== null)
        assert.ok(
          Number.isSafeInteger(record.taxAmountMinor) &&
            record.taxAmountMinor > 0
        )
      if (record.taxCurrencyCode !== null)
        assert.equal(record.taxCurrencyCode, "usd")
      assert.ok(
        Number.isSafeInteger(record.providerAmountMinor) &&
          record.providerAmountMinor > 0
      )
      assert.equal(record.providerCurrencyCode, "usd")
      const {
        providerId: _providerId,
        taxMatches: _taxMatches,
        ...privateRecord
      } = record
      return privateRecord
    })
    assert.equal(matchedTax, value.taxCount)
    return records
  } catch {
    throw new Error("Invalid private PostgreSQL Stripe descriptor.")
  }
}
