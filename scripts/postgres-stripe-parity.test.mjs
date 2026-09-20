import assert from "node:assert/strict"
import test from "node:test"
import {
  parsePostgresStripeDescriptor,
  postgresStripeDescriptorSql,
} from "./lib/postgres-stripe-parity.mjs"
import {
  parseStripeBusinessParityReport,
  runStripeBusinessParity,
} from "./lib/stripe-business-parity-runner.mjs"

const record = {
  paymentIntentId: "pi_private",
  medusaAmountMajor: "6.5325",
  medusaCurrencyCode: "usd",
  providerId: "pp_stripe_stripe",
  providerAmountMinor: 653,
  providerCurrencyCode: "usd",
  taxMatches: 1,
  taxAmountMinor: 653,
  taxCurrencyCode: "usd",
}

const descriptor = (records = [record], taxCount = 1) =>
  JSON.stringify({
    schemaVersion: 1,
    paymentCount: records.length,
    taxCount,
    records,
  })

test("Stripe descriptor query is bounded and read-only", () => {
  assert.match(postgresStripeDescriptorSql, /REPEATABLE READ READ ONLY/)
  assert.match(postgresStripeDescriptorSql, /statement_timeout = '5000ms'/)
  assert.match(postgresStripeDescriptorSql, /lock_timeout = '1000ms'/)
  assert.match(postgresStripeDescriptorSql, /FROM public\.payment .*LIMIT 8/)
  assert.match(postgresStripeDescriptorSql, /LIMIT 101/)
  assert.doesNotMatch(
    postgresStripeDescriptorSql,
    /\b(?:INSERT|UPDATE|DELETE|COPY)\b/i
  )
})

test("Stripe descriptor parser returns private rows only in memory", () => {
  assert.deepEqual(
    parsePostgresStripeDescriptor(descriptor(), {
      payments: 1,
      taxEvidence: 1,
    }),
    [
      {
        paymentIntentId: "pi_private",
        medusaAmountMajor: "6.5325",
        medusaCurrencyCode: "usd",
        providerAmountMinor: 653,
        providerCurrencyCode: "usd",
        taxAmountMinor: 653,
        taxCurrencyCode: "usd",
      },
    ]
  )
})

test("Stripe descriptor parser rejects unscoped or ambiguous rows without leaking IDs", () => {
  const bad = [
    descriptor([record], 2),
    descriptor([record, record], 2),
    descriptor([{ ...record, providerId: "pp_other" }]),
    descriptor([{ ...record, medusaAmountMajor: "6.53251" }]),
    descriptor([{ ...record, medusaCurrencyCode: "jpy" }]),
    descriptor([{ ...record, taxMatches: 2 }]),
    descriptor([{ ...record, taxAmountMinor: null }]),
    descriptor([{ ...record, providerAmountMinor: null }]),
    descriptor([{ ...record, providerCurrencyCode: null }]),
    descriptor([
      { ...record, paymentIntentId: "pi_private", extra: "private" },
    ]),
    descriptor(
      Array.from({ length: 8 }, (_, index) => ({
        ...record,
        paymentIntentId: `pi_${index}`,
      })),
      8
    ),
    "private pi_private sk_test_private",
  ]
  for (const raw of bad) {
    assert.throws(
      () => parsePostgresStripeDescriptor(raw, { payments: 1, taxEvidence: 1 }),
      (error) =>
        error.message === "Invalid private PostgreSQL Stripe descriptor." &&
        !error.message.includes("pi_private")
    )
  }
})

test("Stripe reader contract accepts only count-only, verified reports", () => {
  const report = {
    schemaVersion: 1,
    source: "provided_private_descriptor_and_stripe_test_mode",
    readOnly: true,
    accountVerified: true,
    testModeVerified: true,
    businessReconciled: false,
    scanned: {
      paymentIntents: 1,
      taxEvidencePairs: 1,
      missingTaxEvidence: 0,
      archivedProviderAmounts: 1,
      archivedProviderCurrencies: 1,
    },
    mismatches: {
      medusaAmount: 0,
      medusaCurrency: 0,
      providerAmount: 0,
      providerCurrency: 0,
      taxAmount: 0,
      taxCurrency: 0,
    },
  }
  assert.deepEqual(
    parseStripeBusinessParityReport(JSON.stringify(report), {
      payments: 1,
      taxEvidence: 1,
    }),
    report
  )
  for (const changed of [
    { ...report, accountVerified: false },
    { ...report, paymentIntentId: "pi_private" },
    { ...report, scanned: { ...report.scanned, paymentIntents: 2 } },
    { ...report, mismatches: { ...report.mismatches, taxAmount: 2 } },
  ]) {
    assert.throws(
      () =>
        parseStripeBusinessParityReport(JSON.stringify(changed), {
          payments: 1,
          taxEvidence: 1,
        }),
      { message: "Invalid Stripe business parity report." }
    )
  }
})

test("Stripe runner rejects malformed scopes without echoing private input", async () => {
  for (const [apiKey, expectedAccountId] of [
    ["sk_live_private", "acct_expected"],
    ["sk_test_private", "acct_private bad"],
  ]) {
    await assert.rejects(
      runStripeBusinessParity([record], { apiKey, expectedAccountId }),
      (error) =>
        !error.message.includes(apiKey) &&
        !error.message.includes(expectedAccountId) &&
        !error.message.includes("pi_private")
    )
  }
})

test("Stripe child rejects a bad descriptor before any provider request", async () => {
  await assert.rejects(
    runStripeBusinessParity(
      [{ ...record, paymentIntentId: "invalid-private-value" }],
      { apiKey: "sk_test_dummy", expectedAccountId: "acct_dummy" }
    ),
    { message: "Stripe business parity child failed." }
  )
})
