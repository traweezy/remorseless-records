import { MedusaError } from "@medusajs/framework/utils"

import {
  taxProviderAuditFrom,
  taxProviderAuditListFrom,
  taxProviderControlFrom,
  taxProviderControlMutationFrom,
  taxQuoteEvidenceFrom,
  taxQuoteEvidenceListFrom,
  taxQuoteEvidenceMatches,
  type TaxQuoteEvidenceRecord,
} from "./persistence-contracts"

const observedAt = new Date("2026-08-31T04:30:00.000Z")

const evidence = (
  overrides: Partial<TaxQuoteEvidenceRecord> = {}
): TaxQuoteEvidenceRecord => ({
  amount_minor: 2_500,
  association_status: null,
  calculation_id: "taxcalc_01CALC",
  cart_id: "cart_01CART",
  collection_mode: "collect",
  currency_code: "usd",
  fingerprint: "abcdefghijklmnopqrstuvwxyzABCDEFG_0123456789",
  generation: 4,
  id: "taxevidence_01EVIDENCE",
  last_verified_at: observedAt,
  linked_at: observedAt,
  metadata: {},
  order_id: null,
  payment_intent_id: "pi_01PAYMENT",
  provider: "stripe_tax",
  status: "prepared",
  tax_transaction_id: null,
  ...overrides,
})

const control = () => ({
  active_provider: "taxrate_io",
  collection_mode: "collect",
  generation: 4,
  id: "taxctrl_default",
  last_switch_reason: null,
  last_switched_by: null,
  metadata: {},
  updated_at: observedAt,
})

const audit = () => ({
  acknowledgement_version: "tax-collection-control-2026-08-30",
  actor_id: "user_01ADMIN",
  created_at: observedAt,
  from_collection_mode: "collect",
  from_generation: 4,
  from_provider: "taxrate_io",
  id: "taxaudit_01AUDIT",
  idempotency_key: "00000000-0000-4000-8000-000000000001",
  metadata: {},
  reason: "Temporarily disable tax collection for maintenance.",
  to_collection_mode: "disabled",
  to_generation: 5,
  to_provider: "taxrate_io",
})

describe("tax control persistence contracts", () => {
  it("parses complete controls, audits, and quote evidence", () => {
    expect(taxProviderControlFrom(control())).toMatchObject({ generation: 4 })
    expect(taxProviderAuditFrom(audit())).toMatchObject({ to_generation: 5 })
    expect(taxQuoteEvidenceFrom(evidence())).toEqual(evidence())
  })

  it("rejects ambiguous singleton queries and mutations", () => {
    expect(() => taxQuoteEvidenceListFrom([evidence(), evidence()])).toThrow(
      MedusaError
    )
    expect(() => taxProviderAuditListFrom([audit(), audit()])).toThrow(
      MedusaError
    )
    expect(() => taxProviderControlMutationFrom([])).toThrow(MedusaError)
    expect(() =>
      taxProviderControlMutationFrom([control(), control()])
    ).toThrow(MedusaError)
  })

  it("rejects malformed identifiers, amounts, timestamps, and generations", () => {
    expect(() =>
      taxQuoteEvidenceFrom({ ...evidence(), amount_minor: 2_500.5 })
    ).toThrow(MedusaError)
    expect(() =>
      taxQuoteEvidenceFrom({ ...evidence(), last_verified_at: "tomorrow" })
    ).toThrow(MedusaError)
    expect(() =>
      taxProviderControlFrom({ ...control(), generation: "4" })
    ).toThrow(MedusaError)
    expect(() =>
      taxProviderAuditFrom({ ...audit(), idempotency_key: "reused-key" })
    ).toThrow(MedusaError)
  })

  it("enforces collection/provider consistency and bounded metadata", () => {
    expect(() =>
      taxQuoteEvidenceFrom({
        ...evidence(),
        collection_mode: "disabled",
        provider: "stripe_tax",
      })
    ).toThrow(MedusaError)
    expect(() =>
      taxQuoteEvidenceFrom({
        ...evidence(),
        metadata: { nested: { value: "\u0000" } },
      })
    ).toThrow(MedusaError)
  })

  it("compares all persisted quote evidence fields with stable JSON order", () => {
    expect(
      taxQuoteEvidenceMatches(
        evidence({ metadata: { a: 1, b: { c: true } } }),
        evidence({ metadata: { b: { c: true }, a: 1 } })
      )
    ).toBe(true)
    expect(
      taxQuoteEvidenceMatches(evidence(), evidence({ amount_minor: 2_501 }))
    ).toBe(false)
  })
})
