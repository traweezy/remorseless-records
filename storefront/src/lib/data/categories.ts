import { cache } from "react"
import type { HttpTypes } from "@medusajs/types"

import { storeClient } from "@/lib/medusa"
import { humanizeCategoryHandle } from "@/lib/products/categories"

type StoreProductCategory = HttpTypes.StoreProductCategory

export type GenreCategory = {
  id: string
  handle: string
  label: string
  rank: number
  path: string[]
}

const normalizeHandle = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim().toLowerCase()
  return trimmed.length ? trimmed : null
}

const coerceLabel = (
  category: StoreProductCategory | null | undefined,
  fallbackHandle: string
): string => {
  if (category?.name?.trim().length) {
    return category.name.trim()
  }
  return humanizeCategoryHandle(fallbackHandle)
}

const flattenCategoryTree = (
  categories: StoreProductCategory[] | null | undefined,
  ancestry: string[]
): GenreCategory[] => {
  if (!categories?.length) {
    return []
  }

  const entries: GenreCategory[] = []

  categories.forEach((category) => {
    const handle = normalizeHandle(category?.handle)
    if (!handle) {
      return
    }

    const label = coerceLabel(category, handle)
    const rank =
      typeof category?.rank === "number" ? category.rank : Number.MAX_SAFE_INTEGER
    const currentPath = [...ancestry, label]

    entries.push({
      id: category.id ?? handle,
      handle,
      label,
      rank,
      path: currentPath,
    })

    entries.push(
      ...flattenCategoryTree(category.category_children, currentPath)
    )
  })

  return entries
}

const GENRES_HANDLE = "genres"
const METAL_HANDLE = "metal"

export const getMetalGenreCategories = cache(async (): Promise<GenreCategory[]> => {
  try {
    const { product_categories } = await storeClient.category.list({
      include_descendants_tree: true,
      limit: 200,
    })

    if (!product_categories?.length) {
      return []
    }

    const genresRoot = product_categories.find(
      (category) => normalizeHandle(category.handle) === GENRES_HANDLE
    )

    if (!genresRoot?.category_children?.length) {
      return []
    }

    const metalRoot = genresRoot.category_children.find(
      (category) => normalizeHandle(category.handle) === METAL_HANDLE
    )

    if (!metalRoot) {
      return []
    }

    return flattenCategoryTree(
      metalRoot.category_children,
      [coerceLabel(metalRoot, METAL_HANDLE)]
    )
  } catch (error) {
    console.error("[getMetalGenreCategories] Failed to load categories", error)
    return []
  }
})
