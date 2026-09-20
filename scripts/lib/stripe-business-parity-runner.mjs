import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const backendRoot = fileURLToPath(new URL("../../backend/", import.meta.url))
const registerPath = join(
  backendRoot,
  "node_modules/ts-node/register/transpile-only.js"
)
const cliPath = join(backendRoot, "src/cli/stripe-business-parity.ts")
const timeoutMs = 33_000
const maxInputBytes = 8192
const maxOutputBytes = 4096

const fixedKeys = (value, keys) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value))
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort())
}

const boundedCounts = (value, keys, limit) => {
  fixedKeys(value, keys)
  for (const key of keys)
    assert.ok(
      Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= limit
    )
}

export const parseStripeBusinessParityReport = (raw, expected) => {
  try {
    assert.equal(typeof raw, "string")
    assert.ok(
      raw.length > 0 && Buffer.byteLength(raw, "utf8") <= maxOutputBytes
    )
    assert.ok(!raw.includes("\n"))
    const report = JSON.parse(raw)
    fixedKeys(report, [
      "schemaVersion",
      "source",
      "readOnly",
      "accountVerified",
      "testModeVerified",
      "businessReconciled",
      "scanned",
      "mismatches",
    ])
    assert.equal(report.schemaVersion, 1)
    assert.equal(
      report.source,
      "provided_private_descriptor_and_stripe_test_mode"
    )
    assert.equal(report.readOnly, true)
    assert.equal(report.accountVerified, true)
    assert.equal(report.testModeVerified, true)
    assert.equal(report.businessReconciled, false)
    boundedCounts(
      report.scanned,
      [
        "paymentIntents",
        "taxEvidencePairs",
        "missingTaxEvidence",
        "archivedProviderAmounts",
        "archivedProviderCurrencies",
      ],
      7
    )
    boundedCounts(
      report.mismatches,
      [
        "medusaAmount",
        "medusaCurrency",
        "providerAmount",
        "providerCurrency",
        "taxAmount",
        "taxCurrency",
      ],
      7
    )
    assert.equal(report.scanned.paymentIntents, expected.payments)
    assert.equal(report.scanned.taxEvidencePairs, expected.taxEvidence)
    assert.equal(
      report.scanned.missingTaxEvidence,
      expected.payments - expected.taxEvidence
    )
    assert.ok(report.scanned.archivedProviderAmounts <= expected.payments)
    assert.ok(report.scanned.archivedProviderCurrencies <= expected.payments)
    assert.equal(report.scanned.archivedProviderAmounts, expected.payments)
    assert.equal(report.scanned.archivedProviderCurrencies, expected.payments)
    for (const key of Object.keys(report.mismatches))
      assert.ok(report.mismatches[key] <= expected.payments)
    return report
  } catch {
    throw new Error("Invalid Stripe business parity report.")
  }
}

export const runStripeBusinessParity = async (
  records,
  { apiKey, expectedAccountId, signal }
) => {
  if (!/^(?:sk|rk)_test_[A-Za-z0-9_]+$/.test(apiKey))
    throw new Error("Invalid Stripe business parity key scope.")
  if (!/^acct_[A-Za-z0-9]{1,251}$/.test(expectedAccountId))
    throw new Error("Invalid Stripe business parity account scope.")
  const input = `${JSON.stringify(records)}\n`
  assert.ok(Buffer.byteLength(input, "utf8") <= maxInputBytes)
  const deadline = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs)
  const output = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--require", registerPath, cliPath],
      {
        cwd: backendRoot,
        env: {
          LANG: "C",
          STRIPE_API_KEY: apiKey,
          RR_STRIPE_EXPECTED_ACCOUNT_ID: expectedAccountId,
          TS_NODE_PROJECT: join(backendRoot, "tsconfig.json"),
        },
        stdio: ["pipe", "pipe", "ignore"],
        signal: deadline,
        killSignal: "SIGKILL",
      }
    )
    let raw = ""
    let failed = false
    child.on("error", () => {
      failed = true
    })
    child.stdout.on("data", (chunk) => {
      raw += chunk.toString("utf8")
      if (Buffer.byteLength(raw, "utf8") > maxOutputBytes) {
        failed = true
        child.kill("SIGKILL")
      }
    })
    child.stdin.on("error", () => {
      failed = true
    })
    child.stdin.end(input)
    child.once("close", (code) => {
      if (failed || code !== 0 || deadline.aborted)
        reject(new Error("Stripe business parity child failed."))
      else resolve(raw.trim())
    })
  })
  return parseStripeBusinessParityReport(output, {
    payments: records.length,
    taxEvidence: records.filter((record) => record.taxAmountMinor !== null)
      .length,
  })
}
