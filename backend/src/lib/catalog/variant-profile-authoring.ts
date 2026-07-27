import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import type { Context } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"

import {
  coerceCatalogJsonRecord,
  firstCatalogResult,
  toCatalogNullableString,
  toCatalogOptionalDate,
} from "./normalization"
import { deleteCreatedReferenceIfOrphaned } from "./product-profile-state"
import {
  resolveOrCreateCatalogReferenceValue,
  type CatalogService,
} from "./reference-resolution"
import {
  catalogVariantProfileUpsertSchema,
  type CatalogVariantProfileMutationInput,
  type CatalogVariantProfileMutationResult,
} from "./variant-profile-contract"
import {
  resolveCatalogVariantProfile,
  restoreCatalogVariantProfileSnapshot,
  serializeCatalogVariantProfileResponse,
  snapshotCatalogVariantProfile,
} from "./variant-profile-state"

export {
  catalogVariantProfileUpsertSchema,
  resolveCatalogVariantProfile,
  serializeCatalogVariantProfileResponse,
}
export type {
  CatalogVariantProfileMutationInput,
  CatalogVariantProfileMutationResult,
  CatalogVariantProfileSnapshot,
  CatalogVariantProfileState,
  CatalogVariantProfileUpsertInput,
} from "./variant-profile-contract"

type NamedReferenceInput =
  | CatalogVariantProfileMutationInput["patch"]["format"]
  | null
  | undefined

const resolveProductProfileId = async (
  catalogService: CatalogService,
  input: {
    productProfileId?: string | null | undefined
    productId?: string | null | undefined
  },
  sharedContext: Context<EntityManager>,
): Promise<string | null | undefined> => {
  if (input.productProfileId === null || input.productId === null) {
    return null
  }

  const productProfileId = toCatalogNullableString(input.productProfileId)
  if (productProfileId) {
    await catalogService.retrieveCatalogProductProfile(
      productProfileId,
      {},
      sharedContext,
    )
    return productProfileId
  }

  const productId = toCatalogNullableString(input.productId)
  if (!productId) {
    return undefined
  }
  const profiles = await catalogService.listCatalogProductProfiles(
    { product_id: productId },
    { take: 1 },
    sharedContext,
  )
  const profile = profiles.at(0)
  if (!profile) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Catalog product profile not found.",
    )
  }
  return profile.id
}

const resolveFormatReferenceId = async (
  catalogService: CatalogService,
  input: {
    id?: string | null | undefined
    kind: "format" | "format_detail"
    reference?: NamedReferenceInput
  },
  createdReferenceValueIds: Set<string>,
  sharedContext: Context<EntityManager>,
): Promise<string | null | undefined> => {
  if (input.id === null || input.reference === null) {
    return null
  }

  const referenceValueId = toCatalogNullableString(input.id)
  if (!referenceValueId && !input.reference) {
    return undefined
  }
  const resolution = await resolveOrCreateCatalogReferenceValue(
    catalogService,
    referenceValueId
      ? {
          kind: input.kind,
          referenceValueId,
        }
      : {
          kind: input.kind,
          label: input.reference?.label,
          metadata: coerceCatalogJsonRecord(input.reference?.metadata),
          referenceValueId: input.reference?.referenceValueId,
          value: input.reference?.value,
    },
    sharedContext,
  )
  if (resolution.created && resolution.record) {
    createdReferenceValueIds.add(resolution.record.id)
  }
  return resolution.record?.id ?? null
}

const buildVariantProfilePatch = ({
  currentVersion,
  formatDetailId,
  formatId,
  patch,
  productProfileId,
  variantId,
}: {
  currentVersion: number
  formatDetailId: string | null | undefined
  formatId: string | null | undefined
  patch: CatalogVariantProfileMutationInput["patch"]
  productProfileId: string | null | undefined
  variantId: string
}): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    variant_id: variantId,
    version: currentVersion + 1,
  }
  if (productProfileId !== undefined) {
    payload.product_profile_id = productProfileId
  }
  if (formatId !== undefined) {
    payload.format_id = formatId
  }
  if (formatDetailId !== undefined) {
    payload.format_detail_id = formatDetailId
  }
  if (patch.formatLabel !== undefined) {
    payload.format_label = toCatalogNullableString(patch.formatLabel)
  }
  if (patch.formatDetailLabel !== undefined) {
    payload.format_detail_label = toCatalogNullableString(
      patch.formatDetailLabel,
    )
  }
  if (patch.displayLabel !== undefined) {
    payload.display_label = toCatalogNullableString(patch.displayLabel)
  }
  if (patch.preorderAllowed !== undefined) {
    payload.preorder_allowed = patch.preorderAllowed
  }
  if (patch.preorderReleaseDate !== undefined) {
    payload.preorder_release_date = toCatalogOptionalDate(
      patch.preorderReleaseDate,
    )
  }
  if (patch.backorderAllowed !== undefined) {
    payload.backorder_allowed = patch.backorderAllowed
  }
  if (patch.backorderNote !== undefined) {
    payload.backorder_note = toCatalogNullableString(patch.backorderNote)
  }
  if (patch.imageUrl !== undefined) {
    payload.image_url = toCatalogNullableString(patch.imageUrl)
  }
  if (patch.metadata !== undefined) {
    payload.metadata = coerceCatalogJsonRecord(patch.metadata)
  }
  return payload
}

export const mutateCatalogVariantProfile = async (
  catalogService: CatalogService,
  input: CatalogVariantProfileMutationInput,
): Promise<CatalogVariantProfileMutationResult> =>
  catalogService.runCatalogTransaction(async (sharedContext) => {
    const existingOperation = (
      await catalogService.listCatalogAuthoringOperations(
        { idempotency_key: input.idempotencyKey },
        { take: 1 },
        sharedContext,
      )
    )[0]
    if (existingOperation) {
      const sameCommand =
        existingOperation.command === input.command &&
        existingOperation.aggregate_id === input.aggregateId &&
        existingOperation.actor_id === input.actorId &&
        existingOperation.expected_version === input.expectedVersion &&
        existingOperation.request_sha256 === input.requestSha256
      if (!sameCommand || existingOperation.status !== "succeeded") {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "The catalog idempotency key cannot be replayed for this variant profile command.",
        )
      }
      const result = coerceCatalogJsonRecord(existingOperation.result)
      const profileId =
        typeof result.profileId === "string" ? result.profileId : null
      if (!profileId) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "The completed variant profile command has no profile result.",
        )
      }
      return {
        created: false,
        createdReferenceValueIds: [],
        operationId: existingOperation.id,
        previous: { profile: null },
        profileId,
        replayed: true,
        result,
        variantId: input.aggregateId,
        version:
          typeof result.version === "number"
            ? result.version
            : input.expectedVersion,
      }
    }

    const previous = await snapshotCatalogVariantProfile(
      catalogService,
      input.aggregateId,
      sharedContext,
    )
    const currentVersion = previous.profile?.version ?? 0
    if (currentVersion !== input.expectedVersion) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The variant profile changed after it was loaded. Refresh before saving.",
      )
    }

    const [operation] = await catalogService.createCatalogAuthoringOperations(
      [
        {
          actor_id: input.actorId,
          aggregate_id: input.aggregateId,
          command: input.command,
          expected_version: input.expectedVersion,
          idempotency_key: input.idempotencyKey,
          metadata: {},
          request_sha256: input.requestSha256,
          result: {},
          status: "pending",
        },
      ],
      sharedContext,
    )
    if (!operation) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The variant profile command audit record was not created.",
      )
    }

    const createdReferenceValueIds = new Set<string>()
    const productProfileId = await resolveProductProfileId(
      catalogService,
      {
        productId: input.patch.productId,
        productProfileId: input.patch.productProfileId,
      },
      sharedContext,
    )
    const formatId = await resolveFormatReferenceId(
      catalogService,
      {
        id: input.patch.formatId,
        kind: "format",
        reference: input.patch.format,
      },
      createdReferenceValueIds,
      sharedContext,
    )
    const formatDetailId = await resolveFormatReferenceId(
      catalogService,
      {
        id: input.patch.formatDetailId,
        kind: "format_detail",
        reference: input.patch.formatDetail,
      },
      createdReferenceValueIds,
      sharedContext,
    )
    const payload = buildVariantProfilePatch({
      currentVersion,
      formatDetailId,
      formatId,
      patch: input.patch,
      productProfileId,
      variantId: input.aggregateId,
    })
    const savedResult = previous.profile
      ? await catalogService.updateCatalogVariantProfiles(
          [{ id: previous.profile.id, ...payload }],
          sharedContext,
        )
      : await catalogService.createCatalogVariantProfiles(
          [payload],
          sharedContext,
        )
    const saved = firstCatalogResult(savedResult)
    if (!saved) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Unable to save catalog variant profile.",
      )
    }

    return {
      created: previous.profile === null,
      createdReferenceValueIds: [...createdReferenceValueIds],
      operationId: operation.id,
      previous,
      profileId: saved.id,
      replayed: false,
      result: {},
      variantId: input.aggregateId,
      version: currentVersion + 1,
    }
  })

export const compensateCatalogVariantProfileMutation = async (
  catalogService: CatalogService,
  input: {
    aggregateId: string
    createdReferenceValueIds: string[]
    operationId: string
    previous: CatalogVariantProfileMutationResult["previous"]
  },
): Promise<void> =>
  catalogService.runCatalogTransaction(async (sharedContext) => {
    await restoreCatalogVariantProfileSnapshot(
      catalogService,
      input.aggregateId,
      input.previous,
      sharedContext,
    )
    for (const referenceValueId of input.createdReferenceValueIds) {
      await deleteCreatedReferenceIfOrphaned(
        catalogService,
        referenceValueId,
        sharedContext,
      )
    }
    await catalogService.updateCatalogAuthoringOperations(
      [
        {
          completed_at: new Date(),
          error_code: "workflow_compensated",
          error_detail:
            "A later workflow step failed; the previous variant profile state was restored.",
          id: input.operationId,
          status: "compensated",
        },
      ],
      sharedContext,
    )
  })
