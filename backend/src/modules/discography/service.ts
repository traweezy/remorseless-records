import type { Context } from "@medusajs/framework/types"
import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import {
  InjectManager,
  InjectTransactionManager,
  MedusaError,
  MedusaContext,
  MedusaService,
} from "@medusajs/framework/utils"

import {
  assertExactDiscographyProjectionRecords,
  loadAllDiscographyProjectionRecords,
  readDiscographyProjectionInput,
  readDiscographyProjectionMutationBatch,
  type DiscographyProjectionPersistenceEntry,
  type DiscographyProjectionRecordExpectation,
} from "@/lib/content/persistence-contracts"

import DiscographyEntry from "./models/discography-entry"
import DiscographyOperation from "./models/discography-operation"
import { planDiscographyProjectionSync } from "./projection-sync"

export type DiscographyReplacementEntry = {
  album: string
  artist: string
  availability:
    | "in_print"
    | "out_of_print"
    | "preorder"
    | "digital_only"
    | "unknown"
  catalog_number: string | null
  collection_title: string | null
  cover_alt_text: string | null
  cover_url: string | null
  formats: string[]
  genres: string[]
  product_handle: string
  product_id: string
  release_date: Date | null
  release_year: number | null
  source_mode: "catalog_product"
  tags: string[]
  title: string
  version: number
}

const MUTATION_BATCH_SIZE = 100

const batches = <T>(entries: readonly T[]): T[][] => {
  const result: T[][] = []
  for (let offset = 0; offset < entries.length; offset += MUTATION_BATCH_SIZE) {
    result.push(entries.slice(offset, offset + MUTATION_BATCH_SIZE))
  }
  return result
}

const storedTimestamp = (
  value: Date | string | null | undefined
): string | null => {
  if (value === undefined) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The Discography projection boundary omitted a timestamp field."
    )
  }
  return value === null ? null : new Date(value).toISOString()
}

const projectionFieldsFromRecord = (record: {
  album: string
  artist: string
  availability: DiscographyReplacementEntry["availability"]
  catalog_number: string | null
  collection_title: string | null
  cover_alt_text: string | null
  cover_url: string | null
  formats: string[] | null
  genres: string[] | null
  product_handle: string | null
  product_id: string | null
  release_date: Date | string | null
  release_year: number | null
  source_mode: string
  tags: string[] | null
  title: string
}): DiscographyProjectionPersistenceEntry => {
  const [parsed] = readDiscographyProjectionInput(
    [
      {
        album: record.album,
        artist: record.artist,
        availability: record.availability,
        catalog_number: record.catalog_number,
        collection_title: record.collection_title,
        cover_alt_text: record.cover_alt_text,
        cover_url: record.cover_url,
        formats: record.formats,
        genres: record.genres,
        product_handle: record.product_handle,
        product_id: record.product_id,
        release_date: record.release_date,
        release_year: record.release_year,
        source_mode: record.source_mode,
        tags: record.tags,
        title: record.title,
        version: 1,
      },
    ],
    1
  )
  if (!parsed) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The Discography projection boundary produced an empty record."
    )
  }
  return parsed
}

export type DiscographyProjectionSyncResult = {
  archived: number
  created: number
  retainedManual: number
  updated: number
}

class DiscographyModuleService extends MedusaService({
  DiscographyEntry,
  DiscographyOperation,
}) {
  @InjectTransactionManager()
  protected async runDiscographyTransaction_<T>(
    task: (sharedContext: Context<EntityManager>) => Promise<T>,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ): Promise<T> {
    return task(sharedContext)
  }

  @InjectManager()
  async runDiscographyTransaction<T>(
    task: (sharedContext: Context<EntityManager>) => Promise<T>,
    @MedusaContext()
    sharedContext: Context<EntityManager> = {
      isolationLevel: "serializable",
    }
  ): Promise<T> {
    sharedContext.isolationLevel ??= "serializable"
    return this.runDiscographyTransaction_(task, sharedContext)
  }

  @InjectTransactionManager()
  protected async replaceWithCatalogProjection_(
    entries: DiscographyReplacementEntry[],
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ): Promise<DiscographyProjectionSyncResult> {
    let projection: DiscographyProjectionPersistenceEntry[]
    try {
      projection = readDiscographyProjectionInput(entries)
    } catch {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "The Discography catalog projection is invalid."
      )
    }
    const listAll = (): Promise<
      Awaited<ReturnType<typeof loadAllDiscographyProjectionRecords>>
    > =>
      loadAllDiscographyProjectionRecords((skip, take) =>
        this.listAndCountDiscographyEntries(
          {},
          { order: { id: "ASC" }, skip, take },
          sharedContext
        )
      )
    const existing = await listAll()
    const archivedAt = new Date()
    const plan = planDiscographyProjectionSync(projection, existing, archivedAt)
    const existingById = new Map(existing.map((entry) => [entry.id, entry]))
    const existingByProductId = new Map(
      existing.flatMap((entry) =>
        entry.source_mode === "catalog_product" && entry.product_id
          ? [[entry.product_id, entry] as const]
          : []
      )
    )
    const expectedByProductId = new Map<
      string,
      DiscographyProjectionRecordExpectation
    >()
    for (const [productId, entry] of existingByProductId) {
      expectedByProductId.set(productId, {
        ...projectionFieldsFromRecord(entry),
        archived_at: storedTimestamp(entry.archived_at),
        id: entry.id,
        version: entry.version,
      })
    }
    const updateExpectations = projection.flatMap((entry) => {
      const current = existingByProductId.get(entry.product_id)
      if (!current) {
        return []
      }
      const expected = {
        ...entry,
        archived_at: storedTimestamp(current.archived_at),
        id: current.id,
        version: current.version + 1,
      } satisfies DiscographyProjectionRecordExpectation
      expectedByProductId.set(entry.product_id, expected)
      return [expected]
    })
    const createExpectations = projection.flatMap((entry) =>
      existingByProductId.has(entry.product_id)
        ? []
        : [{ ...entry, archived_at: null }]
    )
    const archiveExpectations = plan.archives.map((archive) => {
      const current = existingById.get(archive.id)
      if (!current) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "The Discography projection archive plan references missing state."
        )
      }
      const expected = {
        ...projectionFieldsFromRecord(current),
        archived_at: archivedAt.toISOString(),
        id: current.id,
        version: current.version + 1,
      } satisfies DiscographyProjectionRecordExpectation
      expectedByProductId.set(expected.product_id, expected)
      return expected
    })

    for (const [index, batch] of batches(plan.updates).entries()) {
      readDiscographyProjectionMutationBatch(
        await this.updateDiscographyEntries(batch, sharedContext),
        updateExpectations.slice(
          index * MUTATION_BATCH_SIZE,
          (index + 1) * MUTATION_BATCH_SIZE
        )
      )
    }
    for (const [index, batch] of batches(plan.creates).entries()) {
      const expectations = createExpectations.slice(
        index * MUTATION_BATCH_SIZE,
        (index + 1) * MUTATION_BATCH_SIZE
      )
      const created = readDiscographyProjectionMutationBatch(
        await this.createDiscographyEntries(batch, sharedContext),
        expectations
      )
      for (const entry of created) {
        const productId = entry.product_id
        if (productId === null) {
          throw new MedusaError(
            MedusaError.Types.UNEXPECTED_STATE,
            "The Discography projection create acknowledgement lost ownership."
          )
        }
        const expectation = expectations.find(
          ({ product_id }) => product_id === productId
        )
        if (!expectation) {
          throw new MedusaError(
            MedusaError.Types.UNEXPECTED_STATE,
            "The Discography projection create acknowledgement is unowned."
          )
        }
        expectedByProductId.set(productId, {
          ...expectation,
          id: entry.id,
        })
      }
    }
    for (const [index, batch] of batches(plan.archives).entries()) {
      readDiscographyProjectionMutationBatch(
        await this.updateDiscographyEntries(batch, sharedContext),
        archiveExpectations.slice(
          index * MUTATION_BATCH_SIZE,
          (index + 1) * MUTATION_BATCH_SIZE
        )
      )
    }

    const persisted = await listAll()
    if (
      persisted.length !== existing.length + plan.creates.length ||
      existing.some(
        ({ id }) =>
          !persisted.some((persistedEntry) => persistedEntry.id === id)
      )
    ) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The Discography projection transaction changed unexpected identities."
      )
    }
    assertExactDiscographyProjectionRecords(
      persisted.filter(({ source_mode }) => source_mode === "catalog_product"),
      [...expectedByProductId.values()]
    )
    return {
      archived: plan.archives.length,
      created: plan.creates.length,
      retainedManual: plan.retainedManual,
      updated: plan.updates.length,
    }
  }

  @InjectManager()
  async replaceWithCatalogProjection(
    entries: DiscographyReplacementEntry[],
    @MedusaContext()
    sharedContext: Context<EntityManager> = {
      isolationLevel: "serializable",
    }
  ): Promise<DiscographyProjectionSyncResult> {
    sharedContext.isolationLevel ??= "serializable"
    return this.replaceWithCatalogProjection_(entries, sharedContext)
  }
}

export default DiscographyModuleService
