import type { Context } from "@medusajs/framework/types"
import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import {
  InjectManager,
  InjectTransactionManager,
  MedusaContext,
  MedusaService,
} from "@medusajs/framework/utils"

import DiscographyEntry from "./models/discography-entry"
import DiscographyOperation from "./models/discography-operation"
import { planDiscographyProjectionSync } from "./projection-sync"

type DiscographyReplacementEntry = {
  album: string
  artist: string
  availability:
    "in_print" | "out_of_print" | "preorder" | "digital_only" | "unknown"
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
    const existing = await this.listDiscographyEntries(
      {},
      { take: 10_000 },
      sharedContext
    )
    const plan = planDiscographyProjectionSync(entries, existing, new Date())
    if (plan.updates.length) {
      await this.updateDiscographyEntries(plan.updates, sharedContext)
    }
    if (plan.creates.length) {
      await this.createDiscographyEntries(plan.creates, sharedContext)
    }
    if (plan.archives.length) {
      await this.updateDiscographyEntries(plan.archives, sharedContext)
    }
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
