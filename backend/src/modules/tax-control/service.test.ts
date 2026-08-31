import { MedusaError } from "@medusajs/framework/utils"

import type {
  TaxProviderAuditRecord,
  TaxProviderControlRecord,
  TaxQuoteEvidenceRecord,
} from "./persistence-contracts"
import TaxControlModuleService from "./service"

const fingerprint = "abcdefghijklmnopqrstuvwxyzABCDEFG_0123456789"
const observedAt = new Date("2026-08-31T04:30:00.000Z")
const idempotencyKey = "00000000-0000-4000-8000-000000000001"

const evidenceFixture = (
  overrides: Partial<TaxQuoteEvidenceRecord> = {}
): TaxQuoteEvidenceRecord => ({
  amount_minor: 2_500,
  association_status: null,
  calculation_id: "taxcalc_01CALC",
  cart_id: "cart_01CART",
  collection_mode: "collect",
  currency_code: "usd",
  fingerprint,
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

const controlFixture = (
  overrides: Partial<TaxProviderControlRecord> = {}
): TaxProviderControlRecord => ({
  active_provider: "taxrate_io",
  collection_mode: "collect",
  generation: 4,
  id: "taxctrl_default",
  last_switch_reason: null,
  last_switched_by: null,
  metadata: {},
  updated_at: observedAt,
  ...overrides,
})

const auditFixture = (
  overrides: Partial<TaxProviderAuditRecord> = {}
): TaxProviderAuditRecord => ({
  acknowledgement_version: "tax-collection-control-2026-08-30",
  actor_id: "user_01ADMIN",
  created_at: observedAt,
  from_collection_mode: "collect",
  from_generation: 4,
  from_provider: "taxrate_io",
  id: "taxaudit_01AUDIT",
  idempotency_key: idempotencyKey,
  metadata: {},
  reason: "Temporarily disable tax collection for maintenance.",
  to_collection_mode: "disabled",
  to_generation: 5,
  to_provider: "taxrate_io",
  ...overrides,
})

const recordInput = () => ({
  amountMinor: 2_500,
  calculationId: "taxcalc_01CALC",
  cartId: "cart_01CART",
  collectionMode: "collect" as const,
  currencyCode: "usd",
  fingerprint,
  generation: 4,
  paymentIntentId: "pi_01PAYMENT",
  provider: "stripe_tax" as const,
  status: "prepared" as const,
})

const transitionInput = () => ({
  acknowledgementVersion: "tax-collection-control-2026-08-30",
  actorId: "user_01ADMIN",
  expectedGeneration: 4,
  idempotencyKey,
  reason: "Temporarily disable tax collection for maintenance.",
  targetCollectionMode: "disabled" as const,
  targetProvider: "taxrate_io" as const,
})

type HarnessState = {
  audit: TaxProviderAuditRecord | null
  control: TaxProviderControlRecord
  evidence: TaxQuoteEvidenceRecord | null
}

type ServiceHarness = TaxControlModuleService & {
  createTaxProviderAudits: jest.Mock
  createTaxProviderControls: jest.Mock
  createTaxQuoteEvidences: jest.Mock
  listTaxProviderAudits: jest.Mock
  listTaxQuoteEvidences: jest.Mock
  retrieveTaxProviderAudit: jest.Mock
  retrieveTaxProviderControl: jest.Mock
  retrieveTaxQuoteEvidence: jest.Mock
  state: HarnessState
  updateTaxProviderControls: jest.Mock
  updateTaxQuoteEvidences: jest.Mock
}

const serviceHarness = (): ServiceHarness => {
  const manager = {}
  const state: HarnessState = {
    audit: null,
    control: controlFixture(),
    evidence: null,
  }
  return Object.assign(Object.create(TaxControlModuleService.prototype), {
    baseRepository_: {
      getFreshManager: jest.fn(() => manager),
      transaction: jest.fn(
        async (callback: (transactionManager: unknown) => unknown) =>
          callback(manager)
      ),
    },
    createTaxProviderAudits: jest.fn(
      async ([input]: [Record<string, unknown>]) => {
        state.audit = auditFixture(input)
        return [state.audit]
      }
    ),
    createTaxProviderControls: jest.fn(
      async ([input]: [Record<string, unknown>]) => {
        state.control = controlFixture({
          ...input,
          generation: 1,
          updated_at: observedAt,
        })
        return [state.control]
      }
    ),
    createTaxQuoteEvidences: jest.fn(
      async ([input]: [Record<string, unknown>]) => {
        state.evidence = evidenceFixture({
          ...input,
          association_status: null,
          id: "taxevidence_01EVIDENCE",
          order_id: null,
          tax_transaction_id: null,
        })
        return [state.evidence]
      }
    ),
    listTaxProviderAudits: jest.fn(async () =>
      state.audit ? [state.audit] : []
    ),
    listTaxQuoteEvidences: jest.fn(async (filter: Record<string, unknown>) => {
      if (!state.evidence) {
        return []
      }
      if (
        filter.payment_intent_id === state.evidence.payment_intent_id ||
        filter.calculation_id === state.evidence.calculation_id
      ) {
        return [state.evidence]
      }
      return []
    }),
    retrieveTaxProviderAudit: jest.fn(async () => state.audit),
    retrieveTaxProviderControl: jest.fn(async () => state.control),
    retrieveTaxQuoteEvidence: jest.fn(async () => state.evidence),
    state,
    updateTaxProviderControls: jest.fn(
      async ([update]: [Partial<TaxProviderControlRecord>]) => {
        state.control = { ...state.control, ...update }
        return [state.control]
      }
    ),
    updateTaxQuoteEvidences: jest.fn(
      async ([update]: [Partial<TaxQuoteEvidenceRecord>]) => {
        if (!state.evidence) {
          return []
        }
        state.evidence = { ...state.evidence, ...update }
        return [state.evidence]
      }
    ),
  }) as ServiceHarness
}

describe("tax control service persistence boundaries", () => {
  it("rejects malformed direct inputs before persistence access", async () => {
    const service = serviceHarness()

    await expect(
      service.recordTaxQuoteEvidence({
        ...recordInput(),
        amountMinor: Number.NaN,
      })
    ).rejects.toMatchObject({ type: MedusaError.Types.INVALID_DATA })
    await expect(
      service.updateTaxQuoteEvidenceLifecycle({
        associationStatus: "COMMITTED",
        metadata: {},
        paymentIntentId: "pi_01PAYMENT",
        status: "succeeded",
        taxTransactionId: null,
      })
    ).rejects.toMatchObject({ type: MedusaError.Types.INVALID_DATA })
    await expect(
      service.transitionTaxControl({
        ...transitionInput(),
        idempotencyKey: "reused-key",
      })
    ).rejects.toMatchObject({ type: MedusaError.Types.INVALID_DATA })

    expect(service.listTaxQuoteEvidences).not.toHaveBeenCalled()
    expect(service.listTaxProviderAudits).not.toHaveBeenCalled()
  })

  it("returns a complete existing singleton and rejects malformed control state", async () => {
    const service = serviceHarness()

    await expect(service.ensureTaxProviderControl()).resolves.toEqual(
      controlFixture()
    )
    expect(service.createTaxProviderControls).not.toHaveBeenCalled()

    service.retrieveTaxProviderControl.mockResolvedValueOnce({
      ...controlFixture(),
      generation: "4",
    })
    await expect(service.ensureTaxProviderControl()).rejects.toMatchObject({
      type: MedusaError.Types.UNEXPECTED_STATE,
    })
  })

  it("initializes exactly one complete singleton after a genuine not-found", async () => {
    const service = serviceHarness()
    service.retrieveTaxProviderControl.mockRejectedValueOnce(
      new MedusaError(MedusaError.Types.NOT_FOUND, "missing")
    )

    await expect(service.ensureTaxProviderControl()).resolves.toMatchObject({
      generation: 1,
      id: "taxctrl_default",
    })

    service.retrieveTaxProviderControl.mockRejectedValueOnce(
      new MedusaError(MedusaError.Types.NOT_FOUND, "missing")
    )
    service.createTaxProviderControls.mockResolvedValueOnce([
      controlFixture({ generation: 1 }),
      controlFixture({ generation: 1 }),
    ])
    await expect(service.ensureTaxProviderControl()).rejects.toMatchObject({
      type: MedusaError.Types.UNEXPECTED_STATE,
    })
  })

  it("creates quote evidence and verifies the committed readback", async () => {
    const service = serviceHarness()

    await expect(
      service.recordTaxQuoteEvidence(recordInput())
    ).resolves.toMatchObject({
      evidence: {
        calculation_id: "taxcalc_01CALC",
        payment_intent_id: "pi_01PAYMENT",
      },
      replayed: false,
    })
    expect(service.retrieveTaxQuoteEvidence).toHaveBeenCalledWith(
      "taxevidence_01EVIDENCE",
      {},
      expect.any(Object)
    )
  })

  it("rejects ambiguous evidence identity queries and immutable replay drift", async () => {
    const ambiguous = serviceHarness()
    ambiguous.listTaxQuoteEvidences.mockResolvedValue([
      evidenceFixture(),
      evidenceFixture({ id: "taxevidence_02EVIDENCE" }),
    ])
    await expect(
      ambiguous.recordTaxQuoteEvidence(recordInput())
    ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })

    const conflict = serviceHarness()
    conflict.state.evidence = evidenceFixture({ amount_minor: 2_501 })
    await expect(
      conflict.recordTaxQuoteEvidence(recordInput())
    ).rejects.toMatchObject({ type: MedusaError.Types.CONFLICT })
    expect(conflict.updateTaxQuoteEvidences).not.toHaveBeenCalled()
  })

  it("rejects quote evidence write drift and mismatched readback", async () => {
    const writeDrift = serviceHarness()
    writeDrift.createTaxQuoteEvidences.mockImplementation(
      async ([input]: [Record<string, unknown>]) => [
        evidenceFixture({ ...input, amount_minor: 2_501 }),
      ]
    )
    await expect(
      writeDrift.recordTaxQuoteEvidence(recordInput())
    ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })

    const readbackDrift = serviceHarness()
    readbackDrift.retrieveTaxQuoteEvidence.mockResolvedValue(
      evidenceFixture({ status: "failed" })
    )
    await expect(
      readbackDrift.recordTaxQuoteEvidence(recordInput())
    ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })
  })

  it("merges lifecycle evidence exactly and preserves immutable fields", async () => {
    const service = serviceHarness()
    service.state.evidence = evidenceFixture({ metadata: { prior: true } })

    await expect(
      service.updateTaxQuoteEvidenceLifecycle({
        associationStatus: "committed",
        metadata: { refund_amount_minor: 500 },
        orderId: "order_01ORDER",
        paymentIntentId: "pi_01PAYMENT",
        status: "partially_refunded",
        taxTransactionId: "tax_01TRANSACTION",
      })
    ).resolves.toMatchObject({
      amount_minor: 2_500,
      metadata: { prior: true, refund_amount_minor: 500 },
      order_id: "order_01ORDER",
      status: "partially_refunded",
    })
  })

  it("rejects ambiguous lifecycle reads, order conflicts, and mutation drift", async () => {
    const ambiguous = serviceHarness()
    ambiguous.listTaxQuoteEvidences.mockResolvedValue([
      evidenceFixture(),
      evidenceFixture({ id: "taxevidence_02EVIDENCE" }),
    ])
    await expect(
      ambiguous.updateTaxQuoteEvidenceLifecycle({
        associationStatus: null,
        metadata: {},
        paymentIntentId: "pi_01PAYMENT",
        status: "succeeded",
        taxTransactionId: null,
      })
    ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })

    const conflict = serviceHarness()
    conflict.state.evidence = evidenceFixture({ order_id: "order_01OTHER" })
    await expect(
      conflict.updateTaxQuoteEvidenceLifecycle({
        associationStatus: "committed",
        metadata: {},
        orderId: "order_01ORDER",
        paymentIntentId: "pi_01PAYMENT",
        status: "succeeded",
        taxTransactionId: "tax_01TRANSACTION",
      })
    ).rejects.toMatchObject({ type: MedusaError.Types.CONFLICT })

    const drift = serviceHarness()
    drift.state.evidence = evidenceFixture()
    drift.updateTaxQuoteEvidences.mockResolvedValue([
      evidenceFixture({ amount_minor: 2_501, status: "succeeded" }),
    ])
    await expect(
      drift.updateTaxQuoteEvidenceLifecycle({
        associationStatus: "committed",
        metadata: {},
        paymentIntentId: "pi_01PAYMENT",
        status: "succeeded",
        taxTransactionId: null,
      })
    ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })
  })

  it("persists and reads back an exact tax control transition", async () => {
    const service = serviceHarness()

    await expect(
      service.transitionTaxControl(transitionInput())
    ).resolves.toMatchObject({
      audit: { idempotency_key: idempotencyKey, to_generation: 5 },
      control: { collection_mode: "disabled", generation: 5 },
      replayed: false,
    })
    expect(service.retrieveTaxProviderAudit).toHaveBeenCalledWith(
      "taxaudit_01AUDIT",
      {},
      expect.any(Object)
    )
  })

  it("replays only while the audited transition remains active", async () => {
    const service = serviceHarness()
    service.state.audit = auditFixture()
    service.state.control = controlFixture({
      collection_mode: "disabled",
      generation: 5,
      last_switch_reason: transitionInput().reason,
      last_switched_by: "user_01ADMIN",
    })

    await expect(
      service.transitionTaxControl(transitionInput())
    ).resolves.toMatchObject({ replayed: true })
    expect(service.createTaxProviderAudits).not.toHaveBeenCalled()

    service.state.control = controlFixture({ generation: 6 })
    await expect(
      service.transitionTaxControl(transitionInput())
    ).rejects.toMatchObject({ type: MedusaError.Types.CONFLICT })
  })

  it("rejects ambiguous audits, stale generations, and transition drift", async () => {
    const ambiguous = serviceHarness()
    ambiguous.listTaxProviderAudits.mockResolvedValue([
      auditFixture(),
      auditFixture({ id: "taxaudit_02AUDIT" }),
    ])
    await expect(
      ambiguous.transitionTaxControl(transitionInput())
    ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })

    const stale = serviceHarness()
    stale.state.control = controlFixture({ generation: 5 })
    await expect(
      stale.transitionTaxControl(transitionInput())
    ).rejects.toMatchObject({ type: MedusaError.Types.CONFLICT })

    const drift = serviceHarness()
    drift.updateTaxProviderControls.mockResolvedValue([
      controlFixture({ collection_mode: "disabled", generation: 4 }),
    ])
    await expect(
      drift.transitionTaxControl(transitionInput())
    ).rejects.toMatchObject({ type: MedusaError.Types.UNEXPECTED_STATE })
  })
})
