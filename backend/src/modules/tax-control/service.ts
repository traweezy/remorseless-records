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
  type TaxCollectionMode,
  type TaxProviderName,
  type TaxQuoteEvidenceStatus,
} from "./constants"
import { ensureTaxProviderControlSingleton } from "./control-initialization"
import TaxProviderAudit from "./models/tax-provider-audit"
import TaxProviderControl from "./models/tax-provider-control"
import TaxProviderQuota from "./models/tax-provider-quota"
import TaxQuoteEvidence from "./models/tax-quote-evidence"
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
      create: async () =>
        (
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
        )[0],
      retrieve: () =>
        this.retrieveTaxProviderControl(TAX_CONTROL_ID, {}, sharedContext),
    })
  }

  @InjectTransactionManager()
  protected async recordTaxQuoteEvidence_(
    input: RecordTaxQuoteEvidenceInput,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ) {
    const existing = (
      await this.listTaxQuoteEvidences(
        { payment_intent_id: input.paymentIntentId },
        { take: 1 },
        sharedContext
      )
    )[0]
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
      const calculationEvidence = (
        await this.listTaxQuoteEvidences(
          { calculation_id: input.calculationId },
          { take: 1 },
          sharedContext
        )
      )[0]
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
      const [updated] = await this.updateTaxQuoteEvidences(
        [
          {
            id: existing.id,
            last_verified_at: now,
            status: input.status ?? existing.status,
          },
        ],
        sharedContext
      )
      if (!updated) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "Tax evidence verification was not persisted."
        )
      }
      return { evidence: updated, replayed: true }
    }

    const [created] = await this.createTaxQuoteEvidences(
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
    if (!created) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Tax evidence was not persisted."
      )
    }
    return { evidence: created, replayed: false }
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
    input: UpdateTaxQuoteEvidenceLifecycleInput,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ) {
    const evidence = (
      await this.listTaxQuoteEvidences(
        { payment_intent_id: input.paymentIntentId },
        { take: 1 },
        sharedContext
      )
    )[0]
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

    const [updated] = await this.updateTaxQuoteEvidences(
      [
        {
          association_status: input.associationStatus,
          id: evidence.id,
          last_verified_at: new Date(),
          metadata: {
            ...(evidence.metadata as Record<string, unknown>),
            ...input.metadata,
          },
          order_id: input.orderId ?? evidence.order_id,
          status: input.status,
          tax_transaction_id:
            input.taxTransactionId ?? evidence.tax_transaction_id,
        },
      ],
      sharedContext
    )
    if (!updated) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Tax evidence lifecycle verification was not persisted."
      )
    }
    return updated
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
    input: TransitionTaxControlInput,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ) {
    const existingAudits = await this.listTaxProviderAudits(
      { idempotency_key: input.idempotencyKey },
      { take: 1 },
      sharedContext
    )
    const existingAudit = existingAudits[0]
    if (existingAudit) {
      if (!matchesTaxControlTransitionReplay(existingAudit, input)) {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "The tax control idempotency key was already used for a different transition request."
        )
      }
      const control = await this.retrieveTaxProviderControl(
        TAX_CONTROL_ID,
        {},
        sharedContext
      )
      return { audit: existingAudit, control, replayed: true }
    }

    const control = await this.retrieveTaxProviderControl(
      TAX_CONTROL_ID,
      {},
      sharedContext
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
    const [audit] = await this.createTaxProviderAudits(
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
    const [updated] = await this.updateTaxProviderControls(
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

    if (!audit || !updated) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Tax control transition did not return its persisted state."
      )
    }

    return { audit, control: updated, replayed: false }
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
