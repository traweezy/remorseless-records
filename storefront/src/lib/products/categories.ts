import type { HttpTypes } from "@medusajs/types"

type StoreProduct = HttpTypes.StoreProduct
type StoreProductCategory = NonNullable<StoreProduct["categories"]>[number]

export type CategoryDescriptor = {
  handle: string
  label: string
}

export const humanizeCategoryHandle = (handle: string): string =>
  handle
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ")

const coerceHandle = (category: StoreProductCategory | null | undefined): string | null => {
  const handle = category?.handle
  return typeof handle === "string" && handle.trim().length ? handle.trim().toLowerCase() : null
}

const coerceLabel = (category: StoreProductCategory | null | undefined, fallbackHandle: string): string => {
  const name = category?.name
  if (typeof name === "string" && name.trim().length) {
    return name.trim()
  }
  return humanizeCategoryHandle(fallbackHandle)
}

const TYPE_HANDLES = new Set(["music", "bundles", "merch"])
const GENRE_HANDLES = new Set(["metal", "death", "doom", "grind", "sludge"])
const STRUCTURAL_HANDLES = new Set(["artists", "genres"])

const collectAncestors = (category: StoreProductCategory | null | undefined): StoreProductCategory[] => {
  const ancestors: StoreProductCategory[] = []
  let current: StoreProductCategory | null = category ?? null
  const guard = 16
  let iterations = 0

  while (current && iterations < guard) {
    ancestors.push(current)
    current = current.parent_category ?? null
    iterations += 1
  }

  return ancestors
}

const findRootCategory = (category: StoreProductCategory | null | undefined): StoreProductCategory | null => {
  const ancestors = collectAncestors(category)
  if (!ancestors.length) {
    return null
  }

  const root = ancestors[ancestors.length - 1]
  return root ?? null
}

const shouldExcludeCategory = (category: StoreProductCategory | null | undefined): boolean => {
  const handle = coerceHandle(category)
  if (!handle) {
    return true
  }

  if (STRUCTURAL_HANDLES.has(handle)) {
    return true
  }

  const root = findRootCategory(category)
  const rootHandle = coerceHandle(root)
  return rootHandle === "artists"
}

export type ProductCategoryGroups = {
  types: CategoryDescriptor[]
  genres: CategoryDescriptor[]
}

export type CategoryFacet = {
  handle: string
  label: string
  rootHandle: string
  rootLabel: string
}

type ExtractCategoryOptions = {
  excludeHandles?: Array<string | null | undefined>
}

export const extractProductCategoryGroups = (
  categories: StoreProductCategory[] | null | undefined,
  options?: ExtractCategoryOptions
): ProductCategoryGroups => {
  if (!categories?.length) {
    return { types: [], genres: [] }
  }

  const excludes = new Set(
    (options?.excludeHandles ?? [])
      .filter((handle): handle is string => typeof handle === "string" && handle.trim().length > 0)
      .map((handle) => handle.trim().toLowerCase())
  )

  const typeMap = new Map<string, CategoryDescriptor>()
  const genreMap = new Map<string, CategoryDescriptor>()

  for (const category of categories) {
    const handle = coerceHandle(category)
    if (!handle || excludes.has(handle)) {
      continue
    }

    if (TYPE_HANDLES.has(handle)) {
      const label = coerceLabel(category, handle)
      typeMap.set(handle, { handle, label })
      continue
    }

    if (GENRE_HANDLES.has(handle)) {
      const label = coerceLabel(category, handle)
      genreMap.set(handle, { handle, label })
    }
  }

  return {
    types: Array.from(typeMap.values()),
    genres: Array.from(genreMap.values()),
  }
}

export const extractNonArtistCategoryFacets = (
  categories: StoreProductCategory[] | null | undefined
): CategoryFacet[] => {
  if (!categories?.length) {
    return []
  }

  const entries = new Map<string, CategoryFacet>()

  categories.forEach((category) => {
    if (shouldExcludeCategory(category)) {
      return
    }

    const handle = coerceHandle(category)
    if (!handle) {
      return
    }

    const root = findRootCategory(category)
    const rootHandle = coerceHandle(root) ?? handle
    const rootLabel = coerceLabel(root, rootHandle)
    const label = coerceLabel(category, handle)

    entries.set(handle, {
      handle,
      label,
      rootHandle,
      rootLabel,
    })
  })

  return Array.from(entries.values())
}
