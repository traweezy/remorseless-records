import { StrictMode } from "react"
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { useCatalogFilterExitReset } from "@/hooks/use-catalog-filter-exit-reset"
import { catalogStore } from "@/lib/store/catalog"

const CatalogFilterLifecycleProbe = () => {
  useCatalogFilterExitReset()
  return null
}

const resetStore = () => {
  catalogStore.setState((state) => ({
    ...state,
    query: "",
    genres: [],
    artists: [],
    formats: [],
    productTypes: [],
    priceMin: null,
    priceMax: null,
    showInStockOnly: false,
    sort: "title-asc",
  }))
}

describe("useCatalogFilterExitReset", () => {
  beforeEach(() => {
    resetStore()
  })

  afterEach(async () => {
    cleanup()
    await act(async () => {
      await Promise.resolve()
    })
  })

  it("keeps filters mounted through Strict Mode effect replay", async () => {
    catalogStore.getState().toggleProductType("merch")

    render(
      <StrictMode>
        <CatalogFilterLifecycleProbe />
      </StrictMode>
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(catalogStore.getState().productTypes).toEqual(["merch"])
  })

  it("clears filters after leaving while preserving search and sort", async () => {
    catalogStore.getState().setQuery("concrete winds")
    catalogStore.getState().toggleGenre("death-metal")
    catalogStore.getState().toggleFormat("LP")
    catalogStore.getState().toggleProductType("music-release")
    catalogStore.getState().toggleStockOnly()
    catalogStore.getState().setPriceRange(1_000, 5_000)
    catalogStore.getState().setSort("price-high")

    const view = render(<CatalogFilterLifecycleProbe />)
    view.unmount()

    await act(async () => {
      await Promise.resolve()
    })

    expect(catalogStore.getState()).toMatchObject({
      query: "concrete winds",
      genres: [],
      artists: [],
      formats: [],
      productTypes: [],
      priceMin: null,
      priceMax: null,
      showInStockOnly: false,
      sort: "price-high",
    })
  })
})
