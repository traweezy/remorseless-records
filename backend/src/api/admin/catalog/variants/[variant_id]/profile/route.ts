import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import type { Context } from "@medusajs/framework/types"
import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import {
  serializeCatalogVariantProfile,
} from "@/modules/catalog/serializers"
import { hashCatalogCommand } from "@/modules/catalog/catalog-command"
import {
  assertVariantExists,
  coerceJsonRecord,
  createOrReuseReferenceValue,
  firstResult,
  toNullableString,
  toOptionalDate,
  type CatalogService,
} from "../../../utils"

const namedReferenceInputSchema = z.object({
  referenceValueId: z.string().trim().optional().nullable(),
  label: z.string().trim().optional().nullable(),
  value: z.string().trim().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const variantProfileUpsertSchema = z.object({
  idempotencyKey: z.string().uuid(),
  expectedVersion: z.number().int().min(0),
  productProfileId: z.string().trim().optional().nullable(),
  productId: z.string().trim().optional().nullable(),
  formatId: z.string().trim().optional().nullable(),
  format: namedReferenceInputSchema.optional().nullable(),
  formatDetailId: z.string().trim().optional().nullable(),
  formatDetail: namedReferenceInputSchema.optional().nullable(),
  formatLabel: z.string().trim().optional().nullable(),
  formatDetailLabel: z.string().trim().optional().nullable(),
  displayLabel: z.string().trim().optional().nullable(),
  preorderAllowed: z.boolean().optional(),
  preorderReleaseDate: z.string().trim().optional().nullable(),
  backorderAllowed: z.boolean().optional(),
  backorderNote: z.string().trim().optional().nullable(),
  imageUrl: z.string().trim().url().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const resolveVariantProfile = async (
  catalogService: CatalogService,
  variantId: string,
  sharedContext?: Context<EntityManager>
) => {
  const profiles = await catalogService.listCatalogVariantProfiles(
    {
      variant_id: variantId,
    },
    {},
    sharedContext
  )
  return profiles.at(0) ?? null
}

const resolveProductProfileId = async (
  catalogService: CatalogService,
  input: {
    productProfileId?: string | null | undefined
    productId?: string | null | undefined
  },
  sharedContext?: Context<EntityManager>
): Promise<string | null | undefined> => {
  if (input.productProfileId === null || input.productId === null) {
    return null
  }

  const productProfileId = toNullableString(input.productProfileId)
  if (productProfileId) {
    await catalogService.retrieveCatalogProductProfile(
      productProfileId,
      {},
      sharedContext
    )
    return productProfileId
  }

  const productId = toNullableString(input.productId)
  if (!productId) {
    return undefined
  }

  const profiles = await catalogService.listCatalogProductProfiles(
    {
      product_id: productId,
    },
    {},
    sharedContext
  )
  const profile = profiles.at(0)
  if (!profile) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Catalog product profile not found"
    )
  }

  return profile.id
}

const resolveFormatReferenceId = async (
  catalogService: CatalogService,
  input: {
    id?: string | null | undefined
    kind: "format" | "format_detail"
    reference?: z.infer<typeof namedReferenceInputSchema> | null | undefined
  },
  sharedContext?: Context<EntityManager>
): Promise<string | null | undefined> => {
  if (input.id === null || input.reference === null) {
    return null
  }

  const referenceValueId = toNullableString(input.id)
  if (referenceValueId) {
    return referenceValueId
  }

  if (!input.reference) {
    return undefined
  }

  const value = await createOrReuseReferenceValue(catalogService, {
    referenceValueId: input.reference.referenceValueId,
    kind: input.kind,
    label: input.reference.label,
    value: input.reference.value,
    metadata: coerceJsonRecord(input.reference.metadata),
  }, sharedContext)

  return value?.id ?? null
}

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const variantId = req.params.variant_id
  if (!variantId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Product variant id is required"
    )
  }

  await assertVariantExists(req, variantId)
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const profile = await resolveVariantProfile(catalogService, variantId)
  res.status(200).json({
    profile: profile ? serializeCatalogVariantProfile(profile) : null,
  })
}

export const PUT = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const variantId = req.params.variant_id
  if (!variantId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Product variant id is required"
    )
  }

  const parsed = variantProfileUpsertSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid catalog variant profile payload"
    )
  }

  await assertVariantExists(req, variantId)
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const actorId =
    (
      req as MedusaRequest & {
        auth_context?: { actor_id?: string | null }
      }
    ).auth_context?.actor_id ?? null
  const { idempotencyKey, ...commandData } = parsed.data
  const requestSha256 = hashCatalogCommand({
    command: "catalog.variant-profile.upsert",
    variantId,
    input: commandData,
  })
  const result = await catalogService.runCatalogTransaction(
    async (sharedContext) => {
      const existingOperation = (
        await catalogService.listCatalogAuthoringOperations(
          { idempotency_key: idempotencyKey },
          { take: 1 },
          sharedContext
        )
      )[0]
      if (existingOperation) {
        const matches =
          existingOperation.command === "catalog.variant-profile.upsert" &&
          existingOperation.aggregate_id === variantId &&
          existingOperation.actor_id === actorId &&
          existingOperation.expected_version === parsed.data.expectedVersion &&
          existingOperation.request_sha256 === requestSha256
        if (!matches || existingOperation.status !== "succeeded") {
          throw new MedusaError(
            MedusaError.Types.CONFLICT,
            "The catalog idempotency key cannot be replayed for this variant profile command."
          )
        }
        const profile = await resolveVariantProfile(
          catalogService,
          variantId,
          sharedContext
        )
        return { created: false, profile }
      }

      const existing = await resolveVariantProfile(
        catalogService,
        variantId,
        sharedContext
      )
      const currentVersion = existing?.version ?? 0
      if (currentVersion !== parsed.data.expectedVersion) {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "The variant profile changed after it was loaded. Refresh before saving."
        )
      }
      const [operation] = await catalogService.createCatalogAuthoringOperations(
        [
          {
            idempotency_key: idempotencyKey,
            command: "catalog.variant-profile.upsert",
            aggregate_id: variantId,
            actor_id: actorId,
            request_sha256: requestSha256,
            expected_version: parsed.data.expectedVersion,
            status: "pending",
            result: {},
            metadata: {},
          },
        ],
        sharedContext
      )
      if (!operation) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "The variant profile command audit record was not created."
        )
      }

      const productProfileId = await resolveProductProfileId(
        catalogService,
        {
          productProfileId: parsed.data.productProfileId,
          productId: parsed.data.productId,
        },
        sharedContext
      )
      const formatId = await resolveFormatReferenceId(
        catalogService,
        {
          id: parsed.data.formatId,
          kind: "format",
          reference: parsed.data.format,
        },
        sharedContext
      )
      const formatDetailId = await resolveFormatReferenceId(
        catalogService,
        {
          id: parsed.data.formatDetailId,
          kind: "format_detail",
          reference: parsed.data.formatDetail,
        },
        sharedContext
      )
      const payload: Record<string, unknown> = {
        variant_id: variantId,
        availability_status: "available",
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
      if (parsed.data.formatLabel !== undefined) {
        payload.format_label = toNullableString(parsed.data.formatLabel)
      }
      if (parsed.data.formatDetailLabel !== undefined) {
        payload.format_detail_label = toNullableString(
          parsed.data.formatDetailLabel
        )
      }
      if (parsed.data.displayLabel !== undefined) {
        payload.display_label = toNullableString(parsed.data.displayLabel)
      }
      if (parsed.data.preorderAllowed !== undefined) {
        payload.preorder_allowed = parsed.data.preorderAllowed
      }
      if (parsed.data.preorderReleaseDate !== undefined) {
        payload.preorder_release_date = toOptionalDate(
          parsed.data.preorderReleaseDate
        )
      }
      if (parsed.data.backorderAllowed !== undefined) {
        payload.backorder_allowed = parsed.data.backorderAllowed
      }
      if (parsed.data.backorderNote !== undefined) {
        payload.backorder_note = toNullableString(parsed.data.backorderNote)
      }
      if (parsed.data.imageUrl !== undefined) {
        payload.image_url = toNullableString(parsed.data.imageUrl)
      }
      if (parsed.data.metadata !== undefined) {
        payload.metadata = coerceJsonRecord(parsed.data.metadata)
      }

      const savedResult = existing
        ? await catalogService.updateCatalogVariantProfiles(
            [{ id: existing.id, ...payload }],
            sharedContext
          )
        : await catalogService.createCatalogVariantProfiles(
            [payload],
            sharedContext
          )
      const saved = firstResult(savedResult)
      if (!saved) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "Unable to save catalog variant profile"
        )
      }
      await catalogService.completeCatalogAuthoringOperation(
        operation.id,
        {
          profileId: saved.id,
          variantId,
          version: currentVersion + 1,
        },
        sharedContext
      )
      return { created: !existing, profile: saved }
    }
  )

  res.status(result.created ? 201 : 200).json({
    profile: result.profile
      ? serializeCatalogVariantProfile(result.profile)
      : null,
  })
}

export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const variantId = req.params.variant_id
  if (!variantId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Product variant id is required"
    )
  }

  const catalogService = req.scope.resolve("catalog") as CatalogService
  await catalogService.runCatalogTransaction(async (sharedContext) => {
    const profile = await resolveVariantProfile(
      catalogService,
      variantId,
      sharedContext
    )
    if (profile) {
      await catalogService.deleteCatalogVariantProfiles(
        profile.id,
        sharedContext
      )
    }
  })
  res.sendStatus(204)
}
