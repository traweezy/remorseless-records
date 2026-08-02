export const shelfModes = ["manual", "automatic", "hybrid"] as const
export const automationTypes = ["none", "new_release"] as const

export type ShelfMode = (typeof shelfModes)[number]
export type AutomationType = (typeof automationTypes)[number]

export type AdminProduct = {
  id: string
  handle: string | null
  thumbnail: string | null
  title: string
}

export type CatalogShelf = {
  archivedAt: string | null
  automationType: AutomationType
  description: string | null
  endsAt: string | null
  handle: string
  id: string
  isActive: boolean
  mode: ShelfMode
  productLimit: number | null
  ribbonLabel: string | null
  ribbonPriority: number
  showRibbon: boolean
  startsAt: string | null
  title: string
  version: number
}

export type CatalogShelfProduct = {
  endsAt: string | null
  id: string
  isPinned: boolean
  productId: string
  productProfileId: string | null
  shelfId: string
  sortOrder: number
  startsAt: string | null
}

export type ShelfResponse = {
  products: CatalogShelfProduct[]
  shelf: CatalogShelf
}

export type ShelfProductLine = {
  endsAt: string
  isPinned: boolean
  key: string
  productId: string
  sortOrder: string
  startsAt: string
}

export type ShelfFormState = {
  automationType: AutomationType
  description: string
  endsAt: string
  handle: string
  isActive: boolean
  mode: ShelfMode
  productLimit: string
  products: ShelfProductLine[]
  ribbonLabel: string
  ribbonPriority: string
  showRibbon: boolean
  startsAt: string
  title: string
  version: number
}

export type CreateShelfState = {
  automationType: AutomationType
  handle: string
  mode: ShelfMode
  productLimit: string
  ribbonLabel: string
  ribbonPriority: string
  showRibbon: boolean
  title: string
}
