import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it } from "vitest"

import { catalogStore } from "@/lib/store/catalog"

const resetStore = () => {
  catalogStore.setState((state) => ({
    ...state,
    query: "",
    genres: [],
    artists: [],
    formats: [],
    productTypes: [],
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
    catalogStore.getState().setSort(sort)

    expect(catalogStore.getState()).toMatchObject({
      query,
      formats: [format],
      productTypes: [productType],
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
    })

    expect(catalogStore.getState()).toMatchObject({
      query,
      genres: [genre],
      formats: [format],
      showInStockOnly: true,
      sort: "price-high",
    })
  })
})
