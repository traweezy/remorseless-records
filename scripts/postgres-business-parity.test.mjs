import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  businessParitySchemaSql,
  businessParitySql,
  parseBusinessParityOutput,
  parseBusinessParitySchema,
} from "./lib/postgres-business-parity.mjs"
import { parseArguments } from "./postgres-isolated-target.mjs"

const command = async (binary, args, environment, captureOutput = true) => {
  const child = spawn(binary, args, {
    env: environment,
    stdio: ["ignore", captureOutput ? "pipe" : "ignore", "ignore"],
  })
  const chunks = []
  let bytes = 0
  const timer = setTimeout(() => child.kill("SIGKILL"), 20_000)
  try {
    return await new Promise((resolve, reject) => {
      child.on("error", () => reject(new Error("Fixture command failed.")))
      child.stdout?.on("data", (chunk) => {
        bytes += chunk.length
        if (bytes > 8192) child.kill("SIGKILL")
        else chunks.push(chunk)
      })
      child.once("close", (code, signal) => {
        if (code !== 0 || signal || bytes > 8192) {
          reject(new Error("Fixture command failed."))
          return
        }
        resolve(Buffer.concat(chunks).toString("utf8").trim())
      })
    })
  } finally {
    clearTimeout(timer)
  }
}

const fixtureSql = `
CREATE TABLE public.cart (id text PRIMARY KEY, deleted_at timestamptz);
CREATE TABLE public."order" (id text PRIMARY KEY, deleted_at timestamptz);
CREATE TABLE public.payment_collection (id text PRIMARY KEY, currency_code text, deleted_at timestamptz);
CREATE TABLE public.payment_session (id text PRIMARY KEY, payment_collection_id text, deleted_at timestamptz);
CREATE TABLE public.payment (id text PRIMARY KEY, amount numeric, currency_code text, provider_id text, data jsonb, payment_collection_id text, payment_session_id text, deleted_at timestamptz);
CREATE TABLE public.capture (id text PRIMARY KEY, amount numeric, payment_id text, deleted_at timestamptz);
CREATE TABLE public.refund (id text PRIMARY KEY, amount numeric, payment_id text, deleted_at timestamptz);
CREATE TABLE public.order_cart (id text PRIMARY KEY, order_id text, cart_id text, deleted_at timestamptz);
CREATE TABLE public.order_payment_collection (id text PRIMARY KEY, order_id text, payment_collection_id text, deleted_at timestamptz);
CREATE TABLE public.cart_payment_collection (id text PRIMARY KEY, cart_id text, payment_collection_id text, deleted_at timestamptz);
CREATE TABLE public.tax_quote_evidences (id text PRIMARY KEY, cart_id text, order_id text, payment_intent_id text, amount_minor integer, currency_code text, status text, deleted_at timestamptz);
CREATE TABLE public.stripe_lifecycle_events (id text PRIMARY KEY, payment_intent_id text, status text, livemode boolean, deleted_at timestamptz);
INSERT INTO public.cart VALUES ('cart_private_canary', NULL);
INSERT INTO public."order" VALUES ('order_private_canary', NULL);
INSERT INTO public.payment_collection VALUES ('paycol_private_canary', 'usd', NULL);
INSERT INTO public.payment_session VALUES ('payses_private_canary', 'paycol_private_canary', NULL);
INSERT INTO public.payment VALUES ('pay_private_canary', 25.00, 'usd', 'pp_stripe_stripe', '{"id":"pi_privatecanary"}', 'paycol_private_canary', 'payses_private_canary', NULL);
INSERT INTO public.capture VALUES ('cap_private_canary', 25.00, 'pay_private_canary', NULL);
INSERT INTO public.order_cart VALUES ('ordercart_private_canary', 'order_private_canary', 'cart_private_canary', NULL);
INSERT INTO public.order_payment_collection VALUES ('ordpay_private_canary', 'order_private_canary', 'paycol_private_canary', NULL);
INSERT INTO public.cart_payment_collection VALUES ('capaycol_private_canary', 'cart_private_canary', 'paycol_private_canary', NULL);
INSERT INTO public.tax_quote_evidences VALUES ('tax_private_canary', 'cart_private_canary', 'order_private_canary', 'pi_privatecanary', 2500, 'usd', 'succeeded', NULL);
INSERT INTO public.stripe_lifecycle_events VALUES ('evt_private_canary', 'pi_privatecanary', 'processed', false, NULL);
`

test("isolated target accepts only the exact parity mode", () => {
  assert.deepEqual(
    parseArguments(["business-parity", "--target-dir", "/private/target"]),
    { mode: "business-parity", options: { "--target-dir": "/private/target" } }
  )
  for (const args of [
    ["business-parity"],
    ["business-parity", "--target-dir", "/private/target", "--confirm", "x"],
    [
      "business-parity",
      "--target-dir",
      "/private/target",
      "--target-dir",
      "/other",
    ],
  ])
    assert.throws(() => parseArguments(args))
})

test("CLI failure hides target paths and business identifiers", () => {
  const result = spawnSync(
    process.execPath,
    [
      new URL("./postgres-isolated-target.mjs", import.meta.url).pathname,
      "business-parity",
      "--target-dir",
      "/tmp/pi_privatecanary",
    ],
    { encoding: "utf8", timeout: 5_000 }
  )
  assert.equal(result.status, 1)
  assert.equal(result.stdout, "")
  assert.equal(result.stderr, '{"status":"failed","phase":"isolated_target"}\n')
})

test("parity parser accepts only bounded fixed counts and redacts failures", () => {
  const scanned = Object.fromEntries(
    [
      "carts",
      "orders",
      "paymentCollections",
      "paymentSessions",
      "payments",
      "stripePayments",
      "captures",
      "refunds",
      "orderCartLinks",
      "orderPaymentLinks",
      "cartPaymentLinks",
      "taxEvidence",
      "lifecycleEvents",
    ].map((key) => [key, 0])
  )
  const mismatches = Object.fromEntries(
    [
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
    ].map((key) => [key, 0])
  )
  const valid = { schemaVersion: 1, scanned, mismatches }
  assert.equal(
    parseBusinessParityOutput(JSON.stringify(valid)).businessReconciled,
    false
  )
  for (const value of [
    { ...valid, rowId: "pi_private_canary" },
    { ...valid, scanned: { ...scanned, payments: 101 } },
    { ...valid, scanned: { ...scanned, payments: 1 } },
    { ...valid, mismatches: { ...mismatches, taxAmountUsd: -1 } },
    { ...valid, mismatches: { ...mismatches, rawId: "pi_private_canary" } },
  ])
    assert.throws(
      () => parseBusinessParityOutput(JSON.stringify(value)),
      (error) => error.message === "Invalid PostgreSQL business parity."
    )
  assert.throws(
    () => parseBusinessParityOutput("pi_private_canary\n"),
    (error) => !error.message.includes("private_canary")
  )
  assert.throws(
    () =>
      parseBusinessParitySchema(
        '{"schemaVersion":1,"requiredColumns":1,"presentColumns":1}'
      ),
    (error) => error.message === "Invalid PostgreSQL business schema."
  )
})

test("bounded PostgreSQL fixture identifies relationships without returning IDs", {
  skip: !process.env.RR_POSTGRES_TEST_BIN,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "rr-business-parity-"))
  const bin = process.env.RR_POSTGRES_TEST_BIN
  const data = join(root, "data")
  const environment = { HOME: root, LANG: "C", PATH: process.env.PATH }
  const port = String(40_000 + (process.pid % 20_000))
  const psql = (sql) =>
    command(
      "psql",
      [
        "--no-psqlrc",
        "--no-password",
        "--quiet",
        "--tuples-only",
        "--no-align",
        "--set=ON_ERROR_STOP=1",
        "--host",
        root,
        "--port",
        port,
        "--dbname",
        "postgres",
        "--command",
        sql,
      ],
      environment
    )
  let started = false
  try {
    await command(
      join(bin, "initdb"),
      [
        "--pgdata",
        data,
        "--auth-local=trust",
        "--auth-host=reject",
        "--no-instructions",
      ],
      environment
    )
    await command(
      join(bin, "pg_ctl"),
      [
        "--pgdata",
        data,
        "--options",
        `-c listen_addresses='' -c unix_socket_directories=${root} -p ${port}`,
        "--log",
        join(root, "postgres.log"),
        "--wait",
        "start",
      ],
      environment,
      false
    )
    started = true
    await psql(fixtureSql)
    parseBusinessParitySchema(await psql(businessParitySchemaSql))
    const baseline = parseBusinessParityOutput(await psql(businessParitySql))
    assert.equal(baseline.scanned.payments, 1)
    assert.equal(baseline.scanned.stripePayments, 1)
    assert.ok(Object.values(baseline.mismatches).every((count) => count === 0))
    assert.equal(baseline.businessReconciled, false)
    assert.ok(!JSON.stringify(baseline).includes("private_canary"))

    await psql(
      "INSERT INTO public.payment VALUES ('pay_other', 1, 'usd', 'pp_other', NULL, 'paycol_private_canary', 'payses_private_canary', NULL);"
    )
    const otherProvider = parseBusinessParityOutput(
      await psql(businessParitySql)
    )
    assert.equal(otherProvider.scanned.payments, 2)
    assert.equal(otherProvider.scanned.stripePayments, 1)
    assert.equal(otherProvider.mismatches.unsupportedPaymentProvider, 1)
    await psql("DELETE FROM public.payment WHERE id = 'pay_other';")

    await psql(
      "INSERT INTO public.payment VALUES ('pay_legacy', 1, 'usd', 'pp_stripe_stripe', '{\"id\":\"pi_legacy\"}', 'paycol_private_canary', 'payses_private_canary', NULL);"
    )
    const legacy = parseBusinessParityOutput(await psql(businessParitySql))
    assert.equal(legacy.mismatches.stripePaymentTaxEvidenceMissing, 1)
    await psql("DELETE FROM public.payment WHERE id = 'pay_legacy';")

    await psql(`
INSERT INTO public.cart VALUES ('cart_other', NULL);
INSERT INTO public."order" VALUES ('order_other', NULL);
INSERT INTO public.order_cart VALUES ('ordercart_other', 'order_other', 'cart_other', NULL);
INSERT INTO public.order_payment_collection VALUES ('ordpay_other', 'order_other', 'paycol_private_canary', NULL);
INSERT INTO public.cart_payment_collection VALUES ('capaycol_other', 'cart_other', 'paycol_private_canary', NULL);
UPDATE public.tax_quote_evidences SET order_id = 'order_other';
`)
    const swappedOrder = parseBusinessParityOutput(
      await psql(businessParitySql)
    )
    assert.equal(swappedOrder.mismatches.taxOrderCart, 1)
    assert.equal(swappedOrder.mismatches.taxCartLink, 0)
    assert.equal(swappedOrder.mismatches.taxOrderLink, 0)
    await psql(
      "UPDATE public.tax_quote_evidences SET order_id = 'order_private_canary';"
    )

    await psql(
      "UPDATE public.tax_quote_evidences SET amount_minor = 2501, currency_code = 'eur';"
    )
    await psql(
      "UPDATE public.payment_session SET payment_collection_id = 'paycol_wrong';"
    )
    await psql("UPDATE public.stripe_lifecycle_events SET livemode = true;")
    const changed = parseBusinessParityOutput(await psql(businessParitySql))
    assert.equal(changed.mismatches.paymentRelation, 1)
    assert.equal(changed.mismatches.taxCurrency, 1)
    assert.equal(changed.mismatches.unsupportedTaxCurrency, 1)
    assert.equal(changed.mismatches.livemodeEvent, 1)
    assert.ok(!JSON.stringify(changed).includes("private_canary"))

    await psql(
      "UPDATE public.tax_quote_evidences SET amount_minor = 2501, currency_code = 'usd';"
    )
    await psql(
      "UPDATE public.order_cart SET cart_id = 'cart_missing' WHERE id = 'ordercart_private_canary';"
    )
    await psql(
      "INSERT INTO public.payment VALUES ('pay_duplicate', 25.00, 'usd', 'pp_stripe_stripe', '{\"id\":\"pi_privatecanary\"}', 'paycol_private_canary', 'payses_private_canary', NULL);"
    )
    const relational = parseBusinessParityOutput(await psql(businessParitySql))
    assert.equal(relational.mismatches.orderCartOrphan, 1)
    assert.equal(relational.mismatches.taxOrderCart, 1)
    assert.equal(relational.mismatches.duplicateStripeIntent, 1)
    assert.equal(relational.mismatches.taxAmountUsd, 1)

    await psql(
      "INSERT INTO public.payment SELECT 'pay_extra_' || i, 1, 'usd', 'pp_other', NULL, 'paycol_private_canary', 'payses_private_canary', NULL FROM generate_series(1, 100) AS i;"
    )
    await assert.rejects(
      async () => parseBusinessParityOutput(await psql(businessParitySql)),
      /Invalid PostgreSQL business parity/u
    )

    await psql("ALTER TABLE public.payment DROP COLUMN payment_session_id;")
    await assert.rejects(
      async () =>
        parseBusinessParitySchema(await psql(businessParitySchemaSql)),
      /Invalid PostgreSQL business schema/u
    )
  } finally {
    if (started || existsSync(join(data, "postmaster.pid")))
      await command(
        join(bin, "pg_ctl"),
        ["--pgdata", data, "--mode", "immediate", "--wait", "stop"],
        environment,
        false
      )
    await rm(root, { recursive: true, force: true })
  }
})
