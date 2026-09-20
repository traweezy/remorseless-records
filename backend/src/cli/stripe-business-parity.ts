import Stripe from "stripe"

import {
  readStripeBusinessParity,
  type StripeBusinessParityRecord,
} from "../lib/tax-control/stripe-business-parity"

const maxInputBytes = 8_192

const inputFromStdin = async (): Promise<StripeBusinessParityRecord[]> => {
  let raw = ""
  for await (const chunk of process.stdin) {
    raw += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)
    if (Buffer.byteLength(raw, "utf8") > maxInputBytes) {
      throw new Error("Invalid private descriptor.")
    }
  }
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    throw new Error("Invalid private descriptor.")
  }
  return parsed as StripeBusinessParityRecord[]
}

const run = async (): Promise<void> => {
  if (process.argv.length !== 2) {
    throw new Error("Invalid command arguments.")
  }
  const apiKey = process.env.STRIPE_API_KEY ?? ""
  const expectedAccountId = process.env.RR_STRIPE_EXPECTED_ACCOUNT_ID ?? ""
  const records = await inputFromStdin()
  const client = new Stripe(apiKey, {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 0,
    timeout: 30_000,
  })
  const report = await readStripeBusinessParity({
    apiKey,
    client,
    records,
    expectedAccountId,
  })
  process.stdout.write(`${JSON.stringify(report)}\n`)
}

void run().catch(() => {
  process.stderr.write("Stripe business parity diagnostic failed.\n")
  process.exitCode = 1
})
