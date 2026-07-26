import type { Context } from "@medusajs/framework/types"
import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import {
  InjectManager,
  InjectTransactionManager,
  MedusaContext,
  MedusaService,
} from "@medusajs/framework/utils"

import DiscographyEntry from "./models/discography-entry"

type DiscographyReplacementEntry = {
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

class DiscographyModuleService extends MedusaService({ DiscographyEntry }) {
  @InjectTransactionManager()
  protected async replaceWithCatalogProjection_(
    entries: DiscographyReplacementEntry[],
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ): Promise<{ created: number; removed: number }> {
    const existing = await this.listDiscographyEntries(
      {},
      { select: ["id"] },
      sharedContext
    )
    if (existing.length) {
      await this.deleteDiscographyEntries(
        existing.map(({ id }) => id),
        sharedContext
      )
    }
    if (entries.length) {
      await this.createDiscographyEntries(entries, sharedContext)
    }
    return { created: entries.length, removed: existing.length }
  }

  @InjectManager()
  async replaceWithCatalogProjection(
    entries: DiscographyReplacementEntry[],
    @MedusaContext() sharedContext: Context<EntityManager> = {
      isolationLevel: "serializable",
    }
  ): Promise<{ created: number; removed: number }> {
    sharedContext.isolationLevel ??= "serializable"
    return this.replaceWithCatalogProjection_(entries, sharedContext)
  }
}

export default DiscographyModuleService
