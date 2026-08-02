import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import type { Context } from "@medusajs/framework/types"
import {
  InjectManager,
  InjectTransactionManager,
  MedusaContext,
  MedusaService,
} from "@medusajs/framework/utils"

import NewsEntry from "./models/news-entry"
import NewsOperation from "./models/news-operation"

class NewsModuleService extends MedusaService({ NewsEntry, NewsOperation }) {
  @InjectTransactionManager()
  protected async runNewsTransaction_<T>(
    task: (sharedContext: Context<EntityManager>) => Promise<T>,
    @MedusaContext() sharedContext: Context<EntityManager> = {}
  ): Promise<T> {
    return task(sharedContext)
  }

  @InjectManager()
  async runNewsTransaction<T>(
    task: (sharedContext: Context<EntityManager>) => Promise<T>,
    @MedusaContext()
    sharedContext: Context<EntityManager> = {
      isolationLevel: "serializable",
    }
  ): Promise<T> {
    sharedContext.isolationLevel ??= "serializable"
    return this.runNewsTransaction_(task, sharedContext)
  }
}

export default NewsModuleService
