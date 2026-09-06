import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { catalogStore } from "@/lib/store/catalog"

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

describe("catalogStore", () => {
  beforeEach(() => {
    faker.seed(2901)
  })

  it("toggles normalized genres and artists", () => {
    const genre = faker.music.genre().toLowerCase()
    const artist = faker.person.fullName().toLowerCase()

    resetStore()
    catalogStore.getState().toggleGenre(` ${genre} `)
    catalogStore.getState().toggleGenre(genre)
    catalogStore.getState().toggleArtist(` ${artist} `)
    catalogStore.getState().toggleArtist(artist)

    expect(catalogStore.getState().genres).toEqual([])
    expect(catalogStore.getState().artists).toEqual([])
  })

  it("ignores blank genre and artist tokens", () => {
    resetStore()
    catalogStore.getState().toggleGenre("   ")
    catalogStore.getState().toggleArtist("   ")
    expect(catalogStore.getState().genres).toEqual([])
    expect(catalogStore.getState().artists).toEqual([])
  })

  it("updates filter state and clears active filters", () => {
    const query = faker.word.words(2)
    const format = faker.helpers.arrayElement(["Cassette", "Vinyl", "CD"])
    const productType = faker.helpers.arrayElement(["album", "single"])
    const sort = faker.helpers.arrayElement(["newest", "price-high"] as const)

    resetStore()
    catalogStore.getState().setQuery(query)
    catalogStore.getState().toggleFormat(format)
    catalogStore.getState().toggleProductType(productType)
    catalogStore.getState().toggleStockOnly()
    catalogStore.getState().setPriceRange(10.99, 30.25)
    catalogStore.getState().setSort(sort)

    expect(catalogStore.getState()).toMatchObject({
      query,
      formats: [format],
      productTypes: [productType],
      priceMin: 10.99,
      priceMax: 30.25,
      showInStockOnly: true,
      sort,
    })

    catalogStore.getState().toggleFormat(format)
    catalogStore.getState().toggleProductType(productType)
    expect(catalogStore.getState().formats).toEqual([])
    expect(catalogStore.getState().productTypes).toEqual([])

    catalogStore.getState().clearFilters()
    expect(catalogStore.getState()).toMatchObject({
      genres: [],
      artists: [],
      formats: [],
      productTypes: [],
      priceMin: null,
      priceMax: null,
      showInStockOnly: false,
      query,
      sort,
    })
  })

  it("hydrates from params while preserving unspecified keys", () => {
    const query = faker.word.words(1)
    const genre = faker.music.genre().toLowerCase()
    const format = faker.helpers.arrayElement(["Vinyl", "CD"])

    resetStore()
    catalogStore.getState().setQuery(query)
    catalogStore.getState().hydrateFromParams({
      genres: [genre],
      formats: [format],
      showInStockOnly: true,
      sort: "price-high",
      priceMin: 5,
      priceMax: null,
    })

    expect(catalogStore.getState()).toMatchObject({
      query,
      genres: [genre],
      formats: [format],
      showInStockOnly: true,
      sort: "price-high",
      priceMin: 5,
      priceMax: null,
    })
  })

  it("keeps hydrated snapshots immutable and shares untouched arrays", () => {
    resetStore()
    const genres = ["death-metal"]
    const artists = ["fixture-artist"]
    catalogStore.getState().hydrateFromParams({ genres, artists })
    const hydrated = catalogStore.getState()

    hydrated.toggleGenre(" Grindcore ")
    const added = catalogStore.getState()
    expect(added.genres).toEqual(["death-metal", "grindcore"])
    expect(added.genres).not.toBe(hydrated.genres)
    expect(added.artists).toBe(hydrated.artists)
    expect(added.formats).toBe(hydrated.formats)
    expect(hydrated.genres).toEqual(["death-metal"])
    expect(genres).toEqual(["death-metal"])

    added.toggleGenre("DEATH-METAL")
    const removed = catalogStore.getState()
    expect(removed.genres).toEqual(["grindcore"])
    expect(removed.artists).toBe(artists)
    expect(added.genres).toEqual(["death-metal", "grindcore"])
    expect(hydrated.genres).toEqual(["death-metal"])
  })

  it("does not notify subscribers for unchanged or rejected draft updates", () => {
    resetStore()
    const before = catalogStore.getState()
    const listener = vi.fn()
    const unsubscribe = catalogStore.subscribe(listener)
    try {
      before.toggleGenre("  ")
      before.toggleArtist("\t")
      before.setQuery(before.query)
      before.setSort(before.sort)
      before.setPriceRange(null, null)
      before.hydrateFromParams({})

      expect(catalogStore.getState()).toBe(before)
      expect(listener).not.toHaveBeenCalled()

      before.toggleFormat("Vinyl")
      const after = catalogStore.getState()
      expect(listener).toHaveBeenCalledExactlyOnceWith(after, before)
      expect(after.formats).toEqual(["Vinyl"])
      expect(before.formats).toEqual([])
      expect(after.genres).toBe(before.genres)
    } finally {
      unsubscribe()
    }
  })
})
