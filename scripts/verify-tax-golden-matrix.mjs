import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)))

const requirements = [
  {
    file: "backend/src/modules/tax-rate-provider/service.test.ts",
    id: "tax.golden.taxable",
    marker: 'objective: "tax.golden.taxable"',
  },
  {
    file: "backend/src/modules/tax-rate-provider/service.test.ts",
    id: "tax.golden.nontaxable",
    marker: 'objective: "tax.golden.nontaxable"',
  },
  {
    file: "backend/src/modules/tax-rate-provider/service.test.ts",
    id: "tax.golden.mixed",
    marker: 'objective: "tax.golden.mixed"',
  },
  {
    file: "backend/src/modules/tax-rate-provider/service.test.ts",
    id: "tax.golden.shipping_taxed",
    marker: 'objective: "tax.golden.shipping_taxed"',
  },
  {
    file: "backend/src/modules/tax-rate-provider/service.test.ts",
    id: "tax.golden.discounted",
    marker: 'objective: "tax.golden.discounted"',
  },
  {
    file: "backend/src/workflows/hooks/set-tax-control-context.test.ts",
    id: "tax.discount.adjusted_minor_units",
    marker: "builds bounded minor-unit amounts from explicit numeric strings",
  },
  {
    file: "backend/src/modules/tax-rate-provider/clients/stripe-tax.test.ts",
    id: "tax.provider.stripe_response_validation",
    marker:
      "creates an exclusive calculation with a bounded idempotent request",
  },
  {
    file: "backend/src/modules/tax-rate-provider/clients/taxrate-io.test.ts",
    id: "tax.provider.taxrate_response_validation",
    marker:
      "normalizes a decimal rate and exposes the authoritative quota snapshot",
  },
  {
    file: "backend/src/modules/tax-rate-provider/service.test.ts",
    id: "tax.compare.quote_only",
    marker:
      "compares representative Stripe Tax and TaxRate.io quotes without creating a payment",
  },
  {
    file: "backend/src/modules/tax-rate-provider/service.test.ts",
    id: "tax.disabled.no_provider_call",
    marker: "emits one explicit zero line per subject without a provider call",
  },
  {
    file: "backend/src/lib/tax-control/payment-binding.test.ts",
    id: "tax.amount.three_way",
    marker:
      "enforces the Medusa, PaymentIntent, and Stripe Tax three-way amount invariant before linking",
  },
  {
    file: "backend/src/lib/tax-control/evidence-reconciliation.test.ts",
    id: "tax.transaction.committed",
    marker: "persists the committed Stripe Tax transaction and order identity",
  },
  {
    file: "backend/src/lib/tax-control/evidence-reconciliation.test.ts",
    id: "tax.refund.partial_reversal",
    marker:
      "records partial refunds and their Stripe Tax reversal transactions",
  },
  {
    file: "backend/src/lib/tax-control/evidence-reconciliation.test.ts",
    id: "tax.refund.full_reversal",
    marker:
      "records a full refund only when its Stripe Tax reversal is committed",
  },
  {
    file: "backend/src/lib/tax-control/evidence-reconciliation.test.ts",
    id: "tax.refund.reversal_per_refund",
    marker:
      "keeps a second partial refund pending until its own reversal appears",
  },
  {
    file: "backend/src/lib/tax-reporting/projection.test.ts",
    id: "tax.reporting.partial_refund",
    marker:
      "records partial refunds in their own period with an explicit estimate",
  },
  {
    file: "backend/src/lib/tax-reporting/projection.test.ts",
    id: "tax.reporting.full_refund",
    marker: "treats a full refund allocation as exact",
  },
]

const requirementIds = requirements.map(({ id }) => id)
assert.equal(
  new Set(requirementIds).size,
  requirementIds.length,
  "Tax golden-matrix objective IDs must remain unique."
)

const sources = new Map()
await Promise.all(
  [...new Set(requirements.map(({ file }) => file))].map(async (file) => {
    sources.set(file, await readFile(join(repositoryRoot, file), "utf8"))
  })
)

for (const { file, id, marker } of requirements) {
  assert.ok(
    sources.get(file)?.includes(marker),
    `${id} is missing its executable evidence marker in ${file}: ${marker}`
  )
}

const [filingRunbook, runbook, hardeningPlan, packageSource, workflow] =
  await Promise.all([
    readFile(join(repositoryRoot, "docs/TAX_RECORDS_AND_FILING.md"), "utf8"),
    readFile(join(repositoryRoot, "docs/TAX_CONTROL_OPERATIONS.md"), "utf8"),
    readFile(join(repositoryRoot, "docs/PRODUCTION_HARDENING_PLAN.md"), "utf8"),
    readFile(join(repositoryRoot, "package.json"), "utf8"),
    readFile(join(repositoryRoot, ".github/workflows/root.yml"), "utf8"),
  ])

for (const marker of [
  "## Deterministic golden matrix",
  "## Sandbox golden matrix",
  "PaymentIntent, charge, refund, or Tax transaction",
]) {
  assert.ok(runbook.includes(marker), `Tax runbook lost: ${marker}`)
}
for (const marker of [
  "## Purpose and boundary",
  "## The filing-jurisdiction control",
  "## State-specific destination workpapers",
  "## Record projection",
  "## Quality states",
  "### Explicit disabled collection",
  "## Totals and exports",
  "## Filing workflow",
  "## Retention",
  "## Items the storefront cannot derive",
  "https://portal.ct.gov/drs/sales-tax/tax-information",
  "https://www.tax.ny.gov/bus/st/filing_sales_tax_returns.htm",
  "2026_rev-819.pdf",
]) {
  assert.ok(
    filingRunbook.includes(marker),
    `Tax filing runbook lost: ${marker}`
  )
}
const normalizedHardeningPlan = hardeningPlan.replace(/\s+/gu, " ")
for (const marker of [
  "tax.golden.taxable",
  "tax.refund.full_reversal",
  "External sandbox evidence remains open",
]) {
  assert.ok(
    normalizedHardeningPlan.includes(marker),
    `Hardening evidence lost: ${marker}`
  )
}

const packageManifest = JSON.parse(packageSource)
assert.equal(
  packageManifest.scripts?.["qa:tax-golden-matrix"],
  "node scripts/verify-tax-golden-matrix.mjs"
)
assert.match(
  packageManifest.scripts?.["qa:lint"] ?? "",
  /pnpm run qa:tax-golden-matrix/u
)
assert.match(workflow, /run: pnpm run qa:tax-golden-matrix/u)
