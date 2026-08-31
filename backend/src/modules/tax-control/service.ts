import type { Context } from "@medusajs/framework/types"
import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import {
  InjectManager,
  InjectTransactionManager,
  MedusaContext,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils"

import {
  TAX_CONTROL_ID,
  taxCollectionModes,
  taxProviderNames,
  taxQuoteEvidenceStatuses,
  type TaxCollectionMode,
  type TaxProviderName,
  type TaxQuoteEvidenceStatus,
} from "./constants"
import { asUnknownRecord } from "../../lib/provider-boundary/records"
import { ensureTaxProviderControlSingleton } from "./control-initialization"
import TaxProviderAudit from "./models/tax-provider-audit"
import TaxProviderControl from "./models/tax-provider-control"
import TaxProviderQuota from "./models/tax-provider-quota"
import TaxQuoteEvidence from "./models/tax-quote-evidence"
import {
  taxControlMetadataFrom,
  taxProviderAuditListFrom,
  taxProviderAuditFrom,
  taxProviderAuditMatches,
  taxProviderAuditMutationFrom,
  taxProviderControlFrom,
  taxProviderControlMatches,
  taxProviderControlMutationFrom,
  taxQuoteEvidenceFrom,
  taxQuoteEvidenceListFrom,
  taxQuoteEvidenceMatches,
  taxQuoteEvidenceMutationFrom,
  type TaxProviderAuditRecord,
  type TaxProviderControlRecord,
  type TaxQuoteEvidenceRecord,
} from "./persistence-contracts"
import { matchesTaxControlTransitionReplay } from "./switch-idempotency"

type TransitionTaxControlInput = {
  acknowledgementVersion: string
  actorId: string
  expectedGeneration: number
  idempotencyKey: string
  reason: string
  targetCollectionMode: TaxCollectionMode
  targetProvider: TaxProviderName
}

type RecordTaxQuoteEvidenceInput = {
  amountMinor: number
  calculationId: string | null
  cartId: string
  collectionMode: TaxCollectionMode
  currencyCode: string
  fingerprint: string
  generation: number
  paymentIntentId: string
  provider: TaxProviderName | null
  status?: TaxQuoteEvidenceStatus
}

type UpdateTaxQuoteEvidenceLifecycleInput = {
  associationStatus: string | null
  metadata: Record<string, unknown>
  orderId?: string
  paymentIntentId: string
  status: TaxQuoteEvidenceStatus
  taxTransactionId: string | null
}

const unexpectedTaxPersistence = (message: string): never => {
  throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, message)
}

const invalidTaxInput = (): never => {
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    "The tax control request data is invalid."
  )
}

const inputIdentifier = (value: unknown, pattern: RegExp): string =>
  typeof value === "string" && pattern.test(value) ? value : invalidTaxInput()

const inputText = (value: unknown, minimum: number, maximum: number): string =>
  typeof value === "string" &&
  value.length >= minimum &&
  value.length <= maximum &&
  value === value.trim() &&
  !/[\u0000-\u001f\u007f]/u.test(value)
    ? value
    : invalidTaxInput()

const inputInteger = (
  value: unknown,
  minimum: number,
  maximum: number
): number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= minimum &&
  value <= maximum
    ? value
    : invalidTaxInput()

const recordEvidenceInputFrom = (
  value: unknown
): RecordTaxQuoteEvidenceInput => {
  const input = asUnknownRecord(value)
  if (
    !input ||
    input.currencyCode !== "usd" ||
    !taxCollectionModes.includes(input.collectionMode as TaxCollectionMode) ||
    (input.provider !== null &&
      !taxProviderNames.includes(input.provider as TaxProviderName)) ||
    (input.collectionMode === "collect" && input.provider === null) ||
    (input.collectionMode === "disabled" && input.provider !== null) ||
    (input.provider === "stripe_tax" && input.calculationId === null) ||
    (input.provider !== "stripe_tax" && input.calculationId !== null) ||
    (input.status !== undefined &&
      !taxQuoteEvidenceStatuses.includes(
        input.status as TaxQuoteEvidenceStatus
      ))
  ) {
    return invalidTaxInput()
  }
  return {
    amountMinor: inputInteger(input.amountMinor, 0, 99_999_999),
    calculationId:
      input.calculationId === null
        ? null
        : inputIdentifier(input.calculationId, /^taxcalc_[A-Za-z0-9]+$/u),
    cartId: inputIdentifier(input.cartId, /^cart_[A-Za-z0-9]+$/u),
    collectionMode: input.collectionMode as TaxCollectionMode,
    currencyCode: "usd",
    fingerprint: inputIdentifier(input.fingerprint, /^[A-Za-z0-9_-]{32,128}$/u),
    generation: inputInteger(input.generation, 1, 1_000_000),
    paymentIntentId: inputIdentifier(
      input.paymentIntentId,
      /^pi_[A-Za-z0-9]+$/u
    ),
    provider: input.provider as TaxProviderName | null,
    ...(input.status === undefined
      ? {}
      : { status: input.status as TaxQuoteEvidenceStatus }),
  }
}

const lifecycleInputFrom = (
  value: unknown
): UpdateTaxQuoteEvidenceLifecycleInput => {
  const input = asUnknownRecord(value)
  if (
    !input ||
    (input.associationStatus !== null &&
      (typeof input.associationStatus !== "string" ||
        !/^[a-z0-9_:,.-]{2,512}$/u.test(input.associationStatus))) ||
    !taxQuoteEvidenceStatuses.includes(input.status as TaxQuoteEvidenceStatus)
  ) {
    return invalidTaxInput()
  }
  let metadata: Record<string, unknown>
  try {
    metadata = taxControlMetadataFrom(input.metadata)
  } catch {
    return invalidTaxInput()
  }
  return {
    associationStatus: input.associationStatus as string | null,
    metadata,
    ...(input.orderId === undefined
      ? {}
      : {
          orderId: inputIdentifier(input.orderId, /^order_[A-Za-z0-9]+$/u),
        }),
    paymentIntentId: inputIdentifier(
      input.paymentIntentId,
      /^pi_[A-Za-z0-9]+$/u
    ),
    status: input.status as TaxQuoteEvidenceStatus,
    taxTransactionId:
      input.taxTransactionId === null
        ? null
        : inputIdentifier(input.taxTransactionId, /^tax_[A-Za-z0-9]+$/u),
  }
}

const transitionInputFrom = (value: unknown): TransitionTaxControlInput => {
  const input = asUnknownRecord(value)
  if (
    !input ||
    !taxCollectionModes.includes(
      input.targetCollectionMode as TaxCollectionMode
    ) ||
    !taxProviderNames.includes(input.targetProvider as TaxProviderName)
  ) {
    return invalidTaxInput()
  }
  return {
    acknowledgementVersion: inputText(input.acknowledgementVersion, 1, 255),
    actorId: inputText(input.actorId, 1, 255),
    expectedGeneration: inputInteger(input.expectedGeneration, 1, 1_000_000),
    idempotencyKey: inputIdentifier(
      input.idempotencyKey,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    ),
    reason: inputText(input.reason, 10, 500),
    targetCollectionMode: input.targetCollectionMode as TaxCollectionMode,
    targetProvider: input.targetProvider as TaxProviderName,
  }
}

const assertEvidenceState = (
  actual: TaxQuoteEvidenceRecord,
  expected: TaxQuoteEvidenceRecord,
  message: string
): TaxQuoteEvidenceRecord =>
  taxQuoteEvidenceMatches(actual, expected)
    ? actual
    : unexpectedTaxPersistence(message)

const assertControlState = (
  actual: TaxProviderControlRecord,
  expected: TaxProviderControlRecord,
  message: string
): TaxProviderControlRecord =>
  taxProviderControlMatches(actual, expected)
    ? actual
    : unexpectedTaxPersistence(message)

const assertAuditState = (
  actual: TaxProviderAuditRecord,
  expected: TaxProviderAuditRecord,
  message: string
): TaxProviderAuditRecord =>
  taxProviderAuditMatches(actual, expected)
    ? actual
    : unexpectedTaxPersistence(message)

class TaxControlModuleService extends MedusaService({
  TaxProviderAudit,
  TaxProviderControl,
  TaxProviderQuota,
  TaxQuoteEvidence,
}) {
  @InjectManager()
  async ensureTaxProviderControl(
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ) {
    return ensureTaxProviderControlSingleton({
      create: async () => {
        const created = taxProviderControlMutationFrom(
          await this.createTaxProviderControls(
            [
              {
                id: TAX_CONTROL_ID,
                active_provider: "taxrate_io",
                collection_mode: "collect",
                generation: 1,
                metadata: {},
              },
            ],
            sharedContext
          )
        )
        return assertControlState(
          created,
          {
            active_provider: "taxrate_io",
            collection_mode: "collect",
            generation: 1,
            id: TAX_CONTROL_ID,
            last_switch_reason: null,
            last_switched_by: null,
            metadata: {},
            updated_at: created.updated_at,
          },
          "The initialized tax provider control does not match its requested state."
        )
      },
      retrieve: async () =>
        taxProviderControlFrom(
          await this.retrieveTaxProviderControl(
            TAX_CONTROL_ID,
            {},
            sharedContext
          )
        ),
    })
  }

  @InjectTransactionManager()
  protected async recordTaxQuoteEvidence_(
    rawInput: RecordTaxQuoteEvidenceInput,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ) {
    const input = recordEvidenceInputFrom(rawInput)
    const existing = taxQuoteEvidenceListFrom(
      await this.listTaxQuoteEvidences(
        { payment_intent_id: input.paymentIntentId },
        { take: 2 },
        sharedContext
      ),
      1
    ).at(0)
    const immutableMatches =
      existing &&
      existing.amount_minor === input.amountMinor &&
      existing.calculation_id === input.calculationId &&
      existing.cart_id === input.cartId &&
      existing.collection_mode === input.collectionMode &&
      existing.currency_code === input.currencyCode &&
      existing.fingerprint === input.fingerprint &&
      existing.generation === input.generation &&
      existing.provider === input.provider
    if (existing && !immutableMatches) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The PaymentIntent is already bound to different tax evidence."
      )
    }

    if (input.calculationId) {
      const calculationEvidence = taxQuoteEvidenceListFrom(
        await this.listTaxQuoteEvidences(
          { calculation_id: input.calculationId },
          { take: 2 },
          sharedContext
        ),
        1
      ).at(0)
      if (
        calculationEvidence &&
        calculationEvidence.payment_intent_id !== input.paymentIntentId
      ) {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "The Stripe Tax calculation is already bound to another PaymentIntent."
        )
      }
    }

    const now = new Date()
    if (existing) {
      const expected: TaxQuoteEvidenceRecord = {
        ...existing,
        last_verified_at: now,
        status: input.status ?? existing.status,
      }
      const updated = taxQuoteEvidenceMutationFrom(
        await this.updateTaxQuoteEvidences(
          [
            {
              id: existing.id,
              last_verified_at: now,
              status: expected.status,
            },
          ],
          sharedContext
        )
      )
      assertEvidenceState(
        updated,
        expected,
        "The persisted tax evidence verification does not match the request."
      )
      const readback = taxQuoteEvidenceFrom(
        await this.retrieveTaxQuoteEvidence(existing.id, {}, sharedContext)
      )
      return {
        evidence: assertEvidenceState(
          readback,
          expected,
          "The tax evidence verification readback does not match the committed state."
        ),
        replayed: true,
      }
    }

    const created = taxQuoteEvidenceMutationFrom(
      await this.createTaxQuoteEvidences(
        [
          {
            amount_minor: input.amountMinor,
            calculation_id: input.calculationId,
            cart_id: input.cartId,
            collection_mode: input.collectionMode,
            currency_code: input.currencyCode,
            fingerprint: input.fingerprint,
            generation: input.generation,
            last_verified_at: now,
            linked_at: now,
            metadata: {},
            payment_intent_id: input.paymentIntentId,
            provider: input.provider,
            status: input.status ?? "prepared",
          },
        ],
        sharedContext
      )
    )
    const expected: TaxQuoteEvidenceRecord = {
      amount_minor: input.amountMinor,
      association_status: null,
      calculation_id: input.calculationId,
      cart_id: input.cartId,
      collection_mode: input.collectionMode,
      currency_code: "usd",
      fingerprint: input.fingerprint,
      generation: input.generation,
      id: created.id,
      last_verified_at: now,
      linked_at: now,
      metadata: {},
      order_id: null,
      payment_intent_id: input.paymentIntentId,
      provider: input.provider,
      status: input.status ?? "prepared",
      tax_transaction_id: null,
    }
    assertEvidenceState(
      created,
      expected,
      "The persisted tax evidence does not match the request."
    )
    const readback = taxQuoteEvidenceFrom(
      await this.retrieveTaxQuoteEvidence(created.id, {}, sharedContext)
    )
    return {
      evidence: assertEvidenceState(
        readback,
        expected,
        "The tax evidence readback does not match the committed state."
      ),
      replayed: false,
    }
  }

  @InjectManager()
  async recordTaxQuoteEvidence(
    input: RecordTaxQuoteEvidenceInput,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ) {
    return this.recordTaxQuoteEvidence_(input, sharedContext)
  }

  @InjectTransactionManager()
  protected async updateTaxQuoteEvidenceLifecycle_(
    rawInput: UpdateTaxQuoteEvidenceLifecycleInput,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ) {
    const input = lifecycleInputFrom(rawInput)
    const evidence = taxQuoteEvidenceListFrom(
      await this.listTaxQuoteEvidences(
        { payment_intent_id: input.paymentIntentId },
        { take: 2 },
        sharedContext
      ),
      1
    ).at(0)
    if (!evidence) {
      return null
    }
    if (
      input.orderId &&
      evidence.order_id &&
      evidence.order_id !== input.orderId
    ) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "Tax evidence is already assigned to a different order."
      )
    }

    const metadata = taxControlMetadataFrom(
      input.metadata,
      "Tax evidence lifecycle metadata is invalid."
    )
    const expected: TaxQuoteEvidenceRecord = {
      ...evidence,
      association_status: input.associationStatus,
      last_verified_at: new Date(),
      metadata: taxControlMetadataFrom(
        { ...evidence.metadata, ...metadata },
        "The merged tax evidence lifecycle metadata is invalid."
      ),
      order_id: input.orderId ?? evidence.order_id,
      status: input.status,
      tax_transaction_id: input.taxTransactionId ?? evidence.tax_transaction_id,
    }
    const updated = taxQuoteEvidenceMutationFrom(
      await this.updateTaxQuoteEvidences(
        [
          {
            association_status: expected.association_status,
            id: evidence.id,
            last_verified_at: expected.last_verified_at,
            metadata: expected.metadata,
            order_id: expected.order_id,
            status: expected.status,
            tax_transaction_id: expected.tax_transaction_id,
          },
        ],
        sharedContext
      )
    )
    assertEvidenceState(
      updated,
      expected,
      "The persisted tax evidence lifecycle does not match the request."
    )
    return assertEvidenceState(
      taxQuoteEvidenceFrom(
        await this.retrieveTaxQuoteEvidence(evidence.id, {}, sharedContext)
      ),
      expected,
      "The tax evidence lifecycle readback does not match the committed state."
    )
  }

  @InjectManager()
  async updateTaxQuoteEvidenceLifecycle(
    input: UpdateTaxQuoteEvidenceLifecycleInput,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ) {
    return this.updateTaxQuoteEvidenceLifecycle_(input, sharedContext)
  }

  @InjectTransactionManager()
  protected async transitionTaxControl_(
    rawInput: TransitionTaxControlInput,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ) {
    const input = transitionInputFrom(rawInput)
    const existingAudit = taxProviderAuditListFrom(
      await this.listTaxProviderAudits(
        { idempotency_key: input.idempotencyKey },
        { take: 2 },
        sharedContext
      ),
      1
    ).at(0)
    if (existingAudit) {
      if (!matchesTaxControlTransitionReplay(existingAudit, input)) {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "The tax control idempotency key was already used for a different transition request."
        )
      }
      const control = taxProviderControlFrom(
        await this.retrieveTaxProviderControl(TAX_CONTROL_ID, {}, sharedContext)
      )
      if (
        control.generation !== existingAudit.to_generation ||
        control.active_provider !== existingAudit.to_provider ||
        control.collection_mode !== existingAudit.to_collection_mode ||
        control.last_switch_reason !== existingAudit.reason ||
        control.last_switched_by !== existingAudit.actor_id
      ) {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "The replayed tax transition is no longer the active control state. Refresh before switching."
        )
      }
      return { audit: existingAudit, control, replayed: true }
    }

    const control = taxProviderControlFrom(
      await this.retrieveTaxProviderControl(TAX_CONTROL_ID, {}, sharedContext)
    )
    if (control.generation !== input.expectedGeneration) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "Tax provider state changed. Refresh before switching."
      )
    }

    if (
      control.active_provider === input.targetProvider &&
      control.collection_mode === input.targetCollectionMode
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "The requested tax collection state is already active."
      )
    }

    const nextGeneration = control.generation + 1
    const audit = taxProviderAuditMutationFrom(
      await this.createTaxProviderAudits(
        [
          {
            acknowledgement_version: input.acknowledgementVersion,
            actor_id: input.actorId,
            from_collection_mode: control.collection_mode,
            from_generation: control.generation,
            from_provider: control.active_provider,
            idempotency_key: input.idempotencyKey,
            metadata: {},
            reason: input.reason,
            to_collection_mode: input.targetCollectionMode,
            to_generation: nextGeneration,
            to_provider: input.targetProvider,
          },
        ],
        sharedContext
      )
    )
    const expectedAudit: TaxProviderAuditRecord = {
      acknowledgement_version: input.acknowledgementVersion,
      actor_id: input.actorId,
      created_at: audit.created_at,
      from_collection_mode: control.collection_mode,
      from_generation: control.generation,
      from_provider: control.active_provider,
      id: audit.id,
      idempotency_key: input.idempotencyKey,
      metadata: {},
      reason: input.reason,
      to_collection_mode: input.targetCollectionMode,
      to_generation: nextGeneration,
      to_provider: input.targetProvider,
    }
    assertAuditState(
      audit,
      expectedAudit,
      "The persisted tax provider audit does not match the request."
    )
    const expectedControl: TaxProviderControlRecord = {
      ...control,
      active_provider: input.targetProvider,
      collection_mode: input.targetCollectionMode,
      generation: nextGeneration,
      last_switch_reason: input.reason,
      last_switched_by: input.actorId,
      updated_at: control.updated_at,
    }
    const updated = taxProviderControlMutationFrom(
      await this.updateTaxProviderControls(
        [
          {
            id: TAX_CONTROL_ID,
            active_provider: input.targetProvider,
            collection_mode: input.targetCollectionMode,
            generation: nextGeneration,
            last_switch_reason: input.reason,
            last_switched_by: input.actorId,
          },
        ],
        sharedContext
      )
    )
    assertControlState(
      updated,
      expectedControl,
      "The persisted tax provider control does not match the transition."
    )

    const auditReadback = await this.retrieveTaxProviderAudit(
      audit.id,
      {},
      sharedContext
    )
    const controlReadback = await this.retrieveTaxProviderControl(
      TAX_CONTROL_ID,
      {},
      sharedContext
    )
    return {
      audit: assertAuditState(
        taxProviderAuditFrom(auditReadback),
        expectedAudit,
        "The tax provider audit readback does not match the committed state."
      ),
      control: assertControlState(
        taxProviderControlFrom(controlReadback),
        expectedControl,
        "The tax provider control readback does not match the committed state."
      ),
      replayed: false,
    }
  }

  @InjectManager()
  async transitionTaxControl(
    input: TransitionTaxControlInput,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ) {
    return this.transitionTaxControl_(input, sharedContext)
  }
}

export default TaxControlModuleService
