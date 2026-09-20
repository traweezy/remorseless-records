import { MathBN } from "@medusajs/framework/utils"
import type Stripe from "stripe"

import {
  createStripeEvidenceReader,
  type StripeEvidenceClient,
  type StripeEvidenceReader,
} from "./stripe-evidence-client"

const maxPaymentIntents = 7
const maxTimeoutMs = 30_000
const accountIdPattern = /^acct_[A-Za-z0-9]{1,251}$/
const intentIdPattern = /^pi_[A-Za-z0-9]{1,252}$/
const currencyPattern = /^[a-z]{3}$/
const majorAmountPattern = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/

export type StripeBusinessParityRecord = {
  paymentIntentId: string
  medusaAmountMajor: string
  medusaCurrencyCode: string
  providerAmountMinor: number | null
  providerCurrencyCode: string | null
  taxAmountMinor: number | null
  taxCurrencyCode: string | null
}

export type StripeBusinessParityReport = {
  schemaVersion: 1
  source: "provided_private_descriptor_and_stripe_test_mode"
  readOnly: true
  accountVerified: boolean
  testModeVerified: true
  businessReconciled: false
  scanned: {
    paymentIntents: number
    taxEvidencePairs: number
    missingTaxEvidence: number
    archivedProviderAmounts: number
    archivedProviderCurrencies: number
  }
  mismatches: {
    medusaAmount: number
    medusaCurrency: number
    providerAmount: number
    providerCurrency: number
    taxAmount: number
    taxCurrency: number
  }
}

const validMinor = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0

const validCurrency = (value: unknown): value is string =>
  typeof value === "string" && currencyPattern.test(value)

const recordKeys = [
  "medusaAmountMajor",
  "medusaCurrencyCode",
  "paymentIntentId",
  "providerAmountMinor",
  "providerCurrencyCode",
  "taxAmountMinor",
  "taxCurrencyCode",
]

const medusaMinorFromMajor = (major: string): number => {
  try {
    return Math.round(MathBN.mult(major, 100).toNumber())
  } catch {
    return Number.NaN
  }
}

const validateRecords = (
  records: readonly StripeBusinessParityRecord[]
): void => {
  if (
    !Array.isArray(records) ||
    records.length < 1 ||
    records.length > maxPaymentIntents
  ) {
    throw new Error("Invalid Stripe business parity descriptor.")
  }
  const ids = new Set<string>()
  for (const record of records) {
    if (
      !record ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      JSON.stringify(Object.keys(record).sort()) !==
        JSON.stringify(recordKeys) ||
      !intentIdPattern.test(record.paymentIntentId) ||
      ids.has(record.paymentIntentId) ||
      !majorAmountPattern.test(record.medusaAmountMajor) ||
      !Number.isSafeInteger(medusaMinorFromMajor(record.medusaAmountMajor)) ||
      medusaMinorFromMajor(record.medusaAmountMajor) < 1 ||
      medusaMinorFromMajor(record.medusaAmountMajor) > 99_999_999 ||
      record.medusaCurrencyCode !== "usd" ||
      (record.providerAmountMinor !== null &&
        !validMinor(record.providerAmountMinor)) ||
      (record.providerCurrencyCode !== null &&
        record.providerCurrencyCode !== "usd") ||
      (record.taxAmountMinor === null) !== (record.taxCurrencyCode === null) ||
      (record.taxAmountMinor !== null && !validMinor(record.taxAmountMinor)) ||
      (record.taxCurrencyCode !== null && record.taxCurrencyCode !== "usd")
    ) {
      throw new Error("Invalid Stripe business parity descriptor.")
    }
    ids.add(record.paymentIntentId)
  }
}

export const readStripeBusinessParity = async ({
  apiKey,
  client,
  expectedAccountId,
  reader,
  records,
  timeoutMs = maxTimeoutMs,
}: {
  apiKey: string
  client: StripeEvidenceClient & Pick<Stripe, "accounts">
  expectedAccountId: string
  reader?: StripeEvidenceReader
  records: readonly StripeBusinessParityRecord[]
  timeoutMs?: number
}): Promise<StripeBusinessParityReport> => {
  validateRecords(records)
  if (!/^(?:sk|rk)_test_[A-Za-z0-9_]+$/.test(apiKey)) {
    throw new Error("Stripe business parity requires a test-mode key.")
  }
  if (!accountIdPattern.test(expectedAccountId)) {
    throw new Error("Invalid Stripe business parity account expectation.")
  }
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > maxTimeoutMs
  ) {
    throw new Error("Invalid Stripe business parity timeout.")
  }

  const deadlineAt = Date.now() + timeoutMs
  const evidenceReader =
    reader ?? createStripeEvidenceReader({ client, timeoutMs })
  let accountValue: unknown
  try {
    accountValue = await client.accounts.retrieveCurrent(
      {},
      {
        maxNetworkRetries: 0,
        timeout: timeoutMs,
      }
    )
  } catch {
    throw new Error("Stripe business parity account read failed.")
  }
  const account =
    accountValue !== null &&
    typeof accountValue === "object" &&
    !Array.isArray(accountValue)
      ? (accountValue as Record<string, unknown>)
      : null
  if (
    account?.object !== "account" ||
    typeof account.id !== "string" ||
    !accountIdPattern.test(account.id)
  ) {
    throw new Error("Invalid Stripe business parity account response.")
  }
  if (account.id !== expectedAccountId) {
    throw new Error("Stripe business parity account mismatch.")
  }

  const mismatches = {
    medusaAmount: 0,
    medusaCurrency: 0,
    providerAmount: 0,
    providerCurrency: 0,
    taxAmount: 0,
    taxCurrency: 0,
  }
  let taxEvidencePairs = 0
  for (const record of records) {
    if (Date.now() >= deadlineAt) {
      throw new Error("Stripe business parity deadline exceeded.")
    }
    let intent: Awaited<ReturnType<StripeEvidenceReader["readIntentSummary"]>>
    try {
      intent = await evidenceReader.readIntentSummary(record.paymentIntentId)
    } catch {
      throw new Error("Stripe business parity provider read failed.")
    }
    if (Date.now() >= deadlineAt) {
      throw new Error("Stripe business parity deadline exceeded.")
    }
    if (intent.id !== record.paymentIntentId || intent.livemode !== false) {
      throw new Error("Stripe business parity requires test-mode objects.")
    }
    if (
      !validMinor(intent.amountMinor) ||
      !validCurrency(intent.currencyCode)
    ) {
      throw new Error("Invalid Stripe business parity intent response.")
    }
    if (medusaMinorFromMajor(record.medusaAmountMajor) !== intent.amountMinor) {
      mismatches.medusaAmount += 1
    }
    if (intent.currencyCode !== record.medusaCurrencyCode) {
      mismatches.medusaCurrency += 1
    }
    if (
      record.providerAmountMinor !== null &&
      intent.amountMinor !== record.providerAmountMinor
    ) {
      mismatches.providerAmount += 1
    }
    if (
      record.providerCurrencyCode !== null &&
      intent.currencyCode !== record.providerCurrencyCode
    ) {
      mismatches.providerCurrency += 1
    }
    if (record.taxAmountMinor !== null && record.taxCurrencyCode !== null) {
      taxEvidencePairs += 1
      if (intent.amountMinor !== record.taxAmountMinor) {
        mismatches.taxAmount += 1
      }
      if (intent.currencyCode !== record.taxCurrencyCode) {
        mismatches.taxCurrency += 1
      }
    }
  }

  return {
    schemaVersion: 1,
    source: "provided_private_descriptor_and_stripe_test_mode",
    readOnly: true,
    accountVerified: true,
    testModeVerified: true,
    businessReconciled: false,
    scanned: {
      paymentIntents: records.length,
      taxEvidencePairs,
      missingTaxEvidence: records.length - taxEvidencePairs,
      archivedProviderAmounts: records.filter(
        (record) => record.providerAmountMinor !== null
      ).length,
      archivedProviderCurrencies: records.filter(
        (record) => record.providerCurrencyCode !== null
      ).length,
    },
    mismatches,
  }
}
