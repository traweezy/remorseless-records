import type { MedusaRequest } from "@medusajs/framework"
import type { IEventBusModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

export const emitCatalogShelfChanged = async (
  req: MedusaRequest,
  shelfId: string
): Promise<void> => {
  const eventBus = req.scope.resolve(Modules.EVENT_BUS) as IEventBusModuleService
  await eventBus.emit({
    name: "catalog.shelf.changed",
    data: { shelfId },
  })
}
