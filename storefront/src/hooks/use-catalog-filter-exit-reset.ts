"use client"

import { useEffect } from "react"

import { catalogStore } from "@/lib/store/catalog"

let activeCatalogViews = 0

export const useCatalogFilterExitReset = (): void => {
  useEffect(() => {
    activeCatalogViews += 1

    return () => {
      activeCatalogViews = Math.max(0, activeCatalogViews - 1)
      queueMicrotask(() => {
        if (activeCatalogViews === 0) {
          catalogStore.getState().clearFilters()
        }
      })
    }
  }, [])
}
