import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import {
  businessAggregateSql,
  parseBusinessAggregateOutput,
} from "./lib/postgres-business-aggregate.mjs"

const zeroCounts = {
  schemaVersion: 1,
  physicalRelationCounts: {
    carts: 0,
    paymentCollections: 0,
    paymentSessions: 0,
    payments: 0,
    orders: 0,
    orderCarts: 0,
    captures: 0,
    refunds: 0,
    orderTransactions: 0,
  },
  taxQuoteEvidence: {
    prepared: 0,
    succeeded: 0,
    canceled: 0,
    failed: 0,
    associationFailed: 0,
    disputed: 0,
    partiallyRefunded: 0,
    refunded: 0,
    unknown: 0,
    collect: 0,
    disabled: 0,
    unknownCollectionMode: 0,
  },
  stripeLifecycleEvents: {
    activeTotal: 0,
    received: 0,
    processing: 0,
    processed: 0,
    ignored: 0,
    failed: 0,
    unknown: 0,
    livemode: 0,
  },
}

test("accepts only exact, safe aggregate fields and keeps reconciliation false", () => {
  const report = parseBusinessAggregateOutput(JSON.stringify(zeroCounts))
  assert.equal(report.businessReconciled, false)
  assert.equal(report.source, "postgres_snapshot_only")
  assert.deepEqual(
    report.physicalRelationCounts,
    zeroCounts.physicalRelationCounts
  )
  const mutate = (operation) => {
    const copy = structuredClone(zeroCounts)
    operation(copy)
    assert.throws(() => parseBusinessAggregateOutput(JSON.stringify(copy)))
  }
  mutate((value) => {
    value.physicalRelationCounts.carts = -1
  })
  mutate((value) => {
    value.taxQuoteEvidence.prepared = "1"
  })
  mutate((value) => {
    value.taxQuoteEvidence.prepared = 1
  })
  mutate((value) => {
    value.stripeLifecycleEvents.providerEventId = "evt_private"
  })
  mutate((value) => {
    value.stripeLifecycleEvents.activeTotal = 1
  })
  mutate((value) => {
    value.businessReconciled = true
  })
  assert.throws(() => parseBusinessAggregateOutput("{invalid"))
  assert.throws(() => parseBusinessAggregateOutput("BEGIN\n{}"))
  assert.throws(() => parseBusinessAggregateOutput("x".repeat(8193)))
  const marker = "secret-pii-do-not-log"
  assert.throws(
    () =>
      parseBusinessAggregateOutput(JSON.stringify({ ...zeroCounts, marker })),
    (error) => {
      assert.equal(error.message, "Invalid PostgreSQL business aggregate.")
      assert.equal(error.stack.includes(marker), false)
      assert.equal(error.cause, undefined)
      return true
    }
  )
})

const command = async (
  binary,
  args,
  { environment, timeoutMs = 15_000, captureOutput = true }
) => {
  const child = spawn(binary, args, {
    env: environment,
    stdio: ["ignore", captureOutput ? "pipe" : "ignore", "ignore"],
  })
  const output = []
  let bytes = 0
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs)
  try {
    return await new Promise((resolve, reject) => {
      child.on("error", () =>
        reject(new Error("Disposable PostgreSQL command failed."))
      )
      child.stdout?.on("data", (chunk) => {
        bytes += chunk.length
        if (bytes > 8192) child.kill("SIGKILL")
        else output.push(chunk)
      })
      child.once("close", (code, signal) => {
        if (code !== 0 || signal || bytes > 8192) {
          reject(new Error("Disposable PostgreSQL command failed."))
          return
        }
        resolve(Buffer.concat(output).toString("utf8").trim())
      })
    })
  } finally {
    clearTimeout(timer)
  }
}

const fixtureSql = `
CREATE TABLE public.cart (id integer, deleted_at timestamptz);
CREATE TABLE public.payment_collection (id integer);
CREATE TABLE public.payment_session (id integer);
CREATE TABLE public.payment (id integer);
CREATE TABLE public."order" (id integer);
CREATE TABLE public.order_cart (id integer);
CREATE TABLE public.capture (id integer);
CREATE TABLE public.refund (id integer);
CREATE TABLE public.order_transaction (id integer);
-- These relevant columns and checks reflect both 20260725220000 and
-- 20260830150000 tax-evidence migrations.
CREATE TABLE public.tax_quote_evidences (
  status text NOT NULL CHECK (status IN (
    'prepared', 'succeeded', 'canceled', 'failed', 'association_failed',
    'disputed', 'partially_refunded', 'refunded'
  )),
  collection_mode text NOT NULL DEFAULT 'collect'
    CHECK (collection_mode IN ('collect', 'disabled')),
  deleted_at timestamptz
);
CREATE TABLE public.stripe_lifecycle_events (
  status text NOT NULL CHECK (status IN (
    'received', 'processing', 'processed', 'ignored', 'failed'
  )),
  livemode boolean NOT NULL,
  deleted_at timestamptz
);
INSERT INTO public.cart VALUES (1, NULL), (2, now());
INSERT INTO public."order" VALUES (1);
INSERT INTO public.payment VALUES (1);
INSERT INTO public.tax_quote_evidences VALUES
  ('prepared', 'collect', NULL),
  ('association_failed', 'disabled', NULL),
  ('refunded', 'collect', now());
INSERT INTO public.stripe_lifecycle_events VALUES
  ('processed', false, NULL),
  ('failed', false, NULL),
  ('processed', true, NULL),
  ('received', false, now());
`

test("counts disposable PostgreSQL fixture in one read-only snapshot", {
  skip: !process.env.RR_POSTGRES_TEST_BIN,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "rr-business-aggregate-"))
  const bin = process.env.RR_POSTGRES_TEST_BIN
  const data = join(root, "data")
  const environment = {
    HOME: root,
    LANG: "C",
    PATH: process.env.PATH,
  }
  const port = String(50_000 + (process.pid % 10_000))
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
      { environment }
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
      { environment }
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
      { environment, captureOutput: false }
    )
    started = true
    await psql(fixtureSql)
    const output = await psql(businessAggregateSql)
    const report = parseBusinessAggregateOutput(output)
    assert.equal(report.physicalRelationCounts.carts, 2)
    assert.equal(report.physicalRelationCounts.orders, 1)
    assert.equal(report.physicalRelationCounts.payments, 1)
    assert.equal(report.taxQuoteEvidence.prepared, 1)
    assert.equal(report.taxQuoteEvidence.associationFailed, 1)
    assert.equal(report.taxQuoteEvidence.refunded, 0)
    assert.equal(report.taxQuoteEvidence.collect, 1)
    assert.equal(report.taxQuoteEvidence.disabled, 1)
    assert.equal(report.stripeLifecycleEvents.processed, 1)
    assert.equal(report.stripeLifecycleEvents.failed, 1)
    assert.equal(report.stripeLifecycleEvents.received, 0)
    assert.equal(report.stripeLifecycleEvents.livemode, 1)
    assert.equal(report.stripeLifecycleEvents.activeTotal, 3)
    assert.equal(report.businessReconciled, false)
    await psql("DROP TABLE public.payment;")
    await assert.rejects(psql(businessAggregateSql))
  } finally {
    if (started || existsSync(join(data, "postmaster.pid"))) {
      await command(
        join(bin, "pg_ctl"),
        ["--pgdata", data, "--mode", "immediate", "--wait", "stop"],
        { environment, captureOutput: false }
      )
    }
    await rm(root, { recursive: true, force: true })
  }
})
