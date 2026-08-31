import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import type { Context } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"

import type { CatalogReferenceKind } from "../../modules/catalog/serializers"
import { sanitizeRichTextHtml } from "../content/rich-text"
import {
  coerceCatalogJsonList,
  coerceCatalogJsonRecord,
  normalizeCatalogList,
  toCatalogNullableString,
  toCatalogOptionalDate,
  toCatalogOptionalInteger,
} from "./normalization"
import {
  catalogNamedReferenceInputSchema,
  catalogProductArtistInputSchema,
  catalogProductProfileUpsertSchema,
  catalogProductReferenceInputSchema,
  type CatalogProductProfileMutationInput,
  type CatalogProductProfileMutationResult,
} from "./product-profile-contract"
import {
  deleteCreatedArtistIfOrphaned,
  deleteCreatedReferenceIfOrphaned,
  loadCatalogProductProfileRelations,
  resolveCatalogProductProfile,
  restoreCatalogProductProfileSnapshot,
  serializeCatalogProductProfileResponse,
  snapshotCatalogProductProfile,
  toCatalogReferenceKind,
} from "./product-profile-state"
import {
  readCatalogProductArtists,
  readCatalogProductProfileMutation,
  readCatalogProductReferences,
  readExactCatalogProductArtists,
  readExactCatalogProductReferences,
  readProductProfileOperationResult,
  readProfileOperationList,
  readProfileOperationMutation,
  type ProfileOperationExpectation,
} from "./profile-persistence-contracts"
import {
  resolveOrCreateCatalogArtist,
  resolveOrCreateCatalogReferenceValue,
  type CatalogService,
} from "./reference-resolution"

export {
  catalogNamedReferenceInputSchema,
  catalogProductArtistInputSchema,
  catalogProductProfileUpsertSchema,
  catalogProductReferenceInputSchema,
  loadCatalogProductProfileRelations,
  resolveCatalogProductProfile,
  serializeCatalogProductProfileResponse,
}
export type {
  CatalogProductArtistState,
  CatalogProductProfileMutationInput,
  CatalogProductProfileMutationResult,
  CatalogProductProfileSnapshot,
  CatalogProductProfileState,
  CatalogProductProfileUpsertInput,
  CatalogProductReferenceState,
} from "./product-profile-contract"

type ArtistInput = NonNullable<
  CatalogProductProfileMutationInput["patch"]["artists"]
>[number]
type ReferenceInput = NonNullable<
  CatalogProductProfileMutationInput["patch"]["references"]
>[number]

const resolveNamedReferenceId = async (
  catalogService: CatalogService,
  input: {
    id?: string | null | undefined
    kind: Extract<CatalogReferenceKind, "label" | "product_type">
    reference?:
      | CatalogProductProfileMutationInput["patch"]["label"]
      | null
      | undefined
  },
  createdReferenceValueIds: Set<string>,
  sharedContext: Context<EntityManager>
): Promise<string | null | undefined> => {
  if (input.id === null || input.reference === null) {
    return null
  }

  const referenceValueId = toCatalogNullableString(input.id)
  if (referenceValueId) {
    const resolution = await resolveOrCreateCatalogReferenceValue(
      catalogService,
      {
        kind: input.kind,
        referenceValueId,
      },
      sharedContext
    )
    return resolution.record?.id ?? null
  }
  if (!input.reference) {
    return undefined
  }

  const resolution = await resolveOrCreateCatalogReferenceValue(
    catalogService,
    {
      referenceValueId: input.reference.referenceValueId,
      kind: input.kind,
      label: input.reference.label,
      value: input.reference.value,
      metadata: coerceCatalogJsonRecord(input.reference.metadata),
    },
    sharedContext
  )
  if (resolution.created && resolution.record) {
    createdReferenceValueIds.add(resolution.record.id)
  }
  return resolution.record?.id ?? null
}

const replaceArtists = async (
  catalogService: CatalogService,
  profileId: string,
  artists: ArtistInput[],
  createdArtistIds: Set<string>,
  sharedContext: Context<EntityManager>
): Promise<void> => {
  const existing = readCatalogProductArtists(
    await catalogService.listCatalogProductArtists(
      { product_profile_id: profileId },
      { take: 101 },
      sharedContext
    ),
    profileId
  )
  if (existing.length) {
    await catalogService.deleteCatalogProductArtists(
      existing.map(({ id }) => id),
      sharedContext
    )
  }

  const payloads = []
  for (const [index, input] of artists.entries()) {
    const resolution = await resolveOrCreateCatalogArtist(
      catalogService,
      {
        artistId: input.artistId,
        name: input.name ?? input.displayName,
        metadata: coerceCatalogJsonRecord(input.metadata),
      },
      sharedContext
    )
    if (resolution.created && resolution.record) {
      createdArtistIds.add(resolution.record.id)
    }
    const displayName =
      toCatalogNullableString(input.displayName) ??
      resolution.record?.name ??
      toCatalogNullableString(input.name)
    if (!displayName) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Each product artist requires an artistId, name, or displayName."
      )
    }
    payloads.push({
      artist_id: resolution.record?.id ?? null,
      display_name: displayName,
      metadata: coerceCatalogJsonRecord(input.metadata),
      product_profile_id: profileId,
      role: toCatalogNullableString(input.role) ?? "primary",
      sort_order: input.sortOrder ?? index,
    })
  }
  if (payloads.length) {
    readExactCatalogProductArtists(
      await catalogService.createCatalogProductArtists(payloads, sharedContext),
      profileId,
      payloads
    )
  }
  readExactCatalogProductArtists(
    await catalogService.listCatalogProductArtists(
      { product_profile_id: profileId },
      { order: { sort_order: "ASC", id: "ASC" }, take: 101 },
      sharedContext
    ),
    profileId,
    payloads
  )
}

const replaceReferences = async (
  catalogService: CatalogService,
  profileId: string,
  references: ReferenceInput[],
  createdReferenceValueIds: Set<string>,
  sharedContext: Context<EntityManager>
): Promise<void> => {
  const existing = readCatalogProductReferences(
    await catalogService.listCatalogProductReferences(
      { product_profile_id: profileId },
      { take: 101 },
      sharedContext
    ),
    profileId
  )
  if (existing.length) {
    await catalogService.deleteCatalogProductReferences(
      existing.map(({ id }) => id),
      sharedContext
    )
  }

  const payloads = []
  for (const [index, input] of references.entries()) {
    const resolution = await resolveOrCreateCatalogReferenceValue(
      catalogService,
      {
        referenceValueId: input.referenceValueId,
        kind: input.kind,
        label: input.label,
        value: input.value,
        metadata: coerceCatalogJsonRecord(input.metadata),
      },
      sharedContext
    )
    if (!resolution.record) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Each product reference requires a referenceValueId or kind and label."
      )
    }
    if (resolution.created) {
      createdReferenceValueIds.add(resolution.record.id)
    }
    payloads.push({
      kind: toCatalogReferenceKind(resolution.record.kind),
      metadata: coerceCatalogJsonRecord(input.metadata),
      product_profile_id: profileId,
      reference_value_id: resolution.record.id,
      sort_order: input.sortOrder ?? index,
    })
  }
  if (payloads.length) {
    readExactCatalogProductReferences(
      await catalogService.createCatalogProductReferences(
        payloads,
        sharedContext
      ),
      profileId,
      payloads
    )
  }
  readExactCatalogProductReferences(
    await catalogService.listCatalogProductReferences(
      { product_profile_id: profileId },
      { order: { sort_order: "ASC", id: "ASC" }, take: 101 },
      sharedContext
    ),
    profileId,
    payloads
  )
}

const buildProfilePatch = ({
  currentVersion,
  existing,
  labelId,
  patch,
  productId,
  productTypeId,
}: {
  currentVersion: number
  existing: boolean
  labelId: string | null | undefined
  patch: CatalogProductProfileMutationInput["patch"]
  productId: string
  productTypeId: string | null | undefined
}): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    product_id: productId,
    version: currentVersion + 1,
  }
  if (patch.releaseTitle !== undefined) {
    payload.release_title = toCatalogNullableString(patch.releaseTitle)
  }
  if (labelId !== undefined) {
    payload.label_id = labelId
  }
  if (productTypeId !== undefined) {
    payload.product_type_id = productTypeId
  }
  if (patch.releaseDate !== undefined) {
    payload.release_date = toCatalogOptionalDate(patch.releaseDate)
  }
  if (patch.releaseYear !== undefined) {
    payload.release_year = toCatalogOptionalInteger(patch.releaseYear)
  }
  if (patch.releaseDatePrecision !== undefined) {
    payload.release_date_precision = patch.releaseDatePrecision
  } else if (
    patch.releaseDate !== undefined ||
    patch.releaseYear !== undefined ||
    !existing
  ) {
    payload.release_date_precision = patch.releaseDate
      ? "day"
      : patch.releaseYear
        ? "year"
        : "unknown"
  }
  if (patch.descriptionHtml !== undefined) {
    const description = toCatalogNullableString(patch.descriptionHtml)
    payload.description_html = description
      ? sanitizeRichTextHtml(description)
      : null
  }
  if (patch.searchKeywords !== undefined) {
    payload.search_keywords = normalizeCatalogList(patch.searchKeywords)
  }
  if (patch.tracklist !== undefined) {
    payload.tracklist = coerceCatalogJsonList(patch.tracklist)
  }
  if (patch.credits !== undefined) {
    payload.credits = coerceCatalogJsonRecord(patch.credits)
  }
  if (patch.pressingNotes !== undefined) {
    payload.pressing_notes = coerceCatalogJsonRecord(patch.pressingNotes)
  }
  if (patch.merchDetails !== undefined) {
    payload.merch_details = coerceCatalogJsonRecord(patch.merchDetails)
  }
  if (patch.metadata !== undefined) {
    payload.metadata = coerceCatalogJsonRecord(patch.metadata)
  }
  return payload
}

export const mutateCatalogProductProfile = async (
  catalogService: CatalogService,
  input: CatalogProductProfileMutationInput
): Promise<CatalogProductProfileMutationResult> =>
  catalogService.runCatalogTransaction(async (sharedContext) => {
    const operationExpectation: ProfileOperationExpectation = {
      actorId: input.actorId,
      aggregateId: input.aggregateId,
      command: input.command,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      requestSha256: input.requestSha256,
      status: "pending",
    }
    const existingOperation = readProfileOperationList(
      await catalogService.listCatalogAuthoringOperations(
        { idempotency_key: input.idempotencyKey },
        { take: 2 },
        sharedContext
      )
    )
    if (existingOperation) {
      const sameCommand =
        existingOperation.command === input.command &&
        existingOperation.aggregateId === input.aggregateId &&
        existingOperation.actorId === input.actorId &&
        existingOperation.expectedVersion === input.expectedVersion &&
        existingOperation.idempotencyKey === input.idempotencyKey &&
        existingOperation.requestSha256 === input.requestSha256
      if (!sameCommand || existingOperation.status !== "succeeded") {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "The catalog idempotency key cannot be replayed for this product profile command."
        )
      }
      const result = readProductProfileOperationResult(existingOperation.result)
      if (
        result.productId !== input.aggregateId ||
        result.version !== input.expectedVersion + 1
      ) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "The completed product profile command result did not match the requested write."
        )
      }
      const retained = await resolveCatalogProductProfile(
        catalogService,
        input.aggregateId,
        sharedContext
      )
      if (
        !retained ||
        retained.id !== result.profileId ||
        retained.version !== result.version
      ) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "The completed product profile command no longer has its exact response."
        )
      }
      return {
        actorId: input.actorId,
        created: result.created,
        createdArtistIds: [],
        createdReferenceValueIds: [],
        operationId: existingOperation.id,
        previous: { artists: [], profile: null, references: [] },
        productId: input.aggregateId,
        profileId: result.profileId,
        idempotencyKey: input.idempotencyKey,
        replayed: true,
        requestSha256: input.requestSha256,
        result: existingOperation.result,
        version: result.version,
      }
    }

    const previous = await snapshotCatalogProductProfile(
      catalogService,
      input.aggregateId,
      sharedContext
    )
    const currentVersion = previous.profile?.version ?? 0
    if (currentVersion !== input.expectedVersion) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The product profile changed after it was loaded. Refresh before saving."
      )
    }

    const operation = readProfileOperationMutation(
      await catalogService.createCatalogAuthoringOperations(
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
        sharedContext
      ),
      operationExpectation
    )

    const createdArtistIds = new Set<string>()
    const createdReferenceValueIds = new Set<string>()
    const labelId = await resolveNamedReferenceId(
      catalogService,
      {
        id: input.patch.labelId,
        kind: "label",
        reference: input.patch.label,
      },
      createdReferenceValueIds,
      sharedContext
    )
    const productTypeId = await resolveNamedReferenceId(
      catalogService,
      {
        id: input.patch.productTypeId,
        kind: "product_type",
        reference: input.patch.productType,
      },
      createdReferenceValueIds,
      sharedContext
    )
    const payload = buildProfilePatch({
      currentVersion,
      existing: Boolean(previous.profile),
      labelId,
      patch: input.patch,
      productId: input.aggregateId,
      productTypeId,
    })
    const savedResult = previous.profile
      ? await catalogService.updateCatalogProductProfiles(
          [{ id: previous.profile.id, ...payload }],
          sharedContext
        )
      : await catalogService.createCatalogProductProfiles(
          [payload],
          sharedContext
        )
    const saved = readCatalogProductProfileMutation(savedResult, {
      fields: payload,
      ...(previous.profile ? { id: previous.profile.id } : {}),
      productId: input.aggregateId,
      version: currentVersion + 1,
    })
    if (input.patch.artists !== undefined) {
      await replaceArtists(
        catalogService,
        saved.id,
        input.patch.artists,
        createdArtistIds,
        sharedContext
      )
    }
    if (input.patch.references !== undefined) {
      await replaceReferences(
        catalogService,
        saved.id,
        input.patch.references,
        createdReferenceValueIds,
        sharedContext
      )
    }

    return {
      actorId: input.actorId,
      created: previous.profile === null,
      createdArtistIds: [...createdArtistIds],
      createdReferenceValueIds: [...createdReferenceValueIds],
      operationId: operation.id,
      previous,
      productId: input.aggregateId,
      profileId: saved.id,
      idempotencyKey: input.idempotencyKey,
      replayed: false,
      requestSha256: input.requestSha256,
      result: {},
      version: currentVersion + 1,
    }
  })

export const compensateCatalogProductProfileMutation = async (
  catalogService: CatalogService,
  input: {
    aggregateId: string
    createdArtistIds: string[]
    createdReferenceValueIds: string[]
    operationId: string
    previous: CatalogProductProfileMutationResult["previous"]
  }
): Promise<void> =>
  catalogService.runCatalogTransaction(async (sharedContext) => {
    const operation = readProfileOperationList(
      await catalogService.listCatalogAuthoringOperations(
        { id: input.operationId },
        { take: 2 },
        sharedContext
      )
    )
    if (
      !operation ||
      operation.id !== input.operationId ||
      operation.status !== "pending"
    ) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The product profile compensation operation could not be verified."
      )
    }
    await restoreCatalogProductProfileSnapshot(
      catalogService,
      input.aggregateId,
      input.previous,
      sharedContext
    )
    for (const artistId of input.createdArtistIds) {
      await deleteCreatedArtistIfOrphaned(
        catalogService,
        artistId,
        sharedContext
      )
    }
    for (const referenceValueId of input.createdReferenceValueIds) {
      await deleteCreatedReferenceIfOrphaned(
        catalogService,
        referenceValueId,
        sharedContext
      )
    }
    readProfileOperationMutation(
      await catalogService.updateCatalogAuthoringOperations(
        [
          {
            completed_at: new Date(),
            error_code: "workflow_compensated",
            error_detail:
              "A later workflow step failed; the previous product profile state was restored.",
            id: input.operationId,
            status: "compensated",
          },
        ],
        sharedContext
      ),
      {
        ...operation,
        id: input.operationId,
        result: operation.result,
        status: "compensated",
      }
    )
  })
