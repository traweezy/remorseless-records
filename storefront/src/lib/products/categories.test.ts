import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it } from "vitest"

import {
  extractNonArtistCategoryFacets,
  extractProductCategoryGroups,
  humanizeCategoryHandle,
} from "@/lib/products/categories"

type CategoryNode = {
  handle?: string | null
  name?: string | null
  parent_category?: CategoryNode | null
}

const category = ({
  handle,
  name,
  parent,
}: {
  handle?: string | null
  name?: string | null
  parent?: CategoryNode | null
}): CategoryNode => ({
  handle: handle ?? null,
  name: name ?? null,
  parent_category: parent ?? null,
})

const asCategoryInput = (
  categories: CategoryNode[]
): Parameters<typeof extractProductCategoryGroups>[0] =>
  categories as unknown as Parameters<typeof extractProductCategoryGroups>[0]

const asFacetInput = (
  categories: CategoryNode[]
): Parameters<typeof extractNonArtistCategoryFacets>[0] =>
  categories as unknown as Parameters<typeof extractNonArtistCategoryFacets>[0]

describe("humanizeCategoryHandle", () => {
  it("converts hyphenated handles into title case labels", () => {
    expect(humanizeCategoryHandle("black-metal")).toBe("Black Metal")
  })
})

describe("extractProductCategoryGroups", () => {
  beforeEach(() => {
    faker.seed(404)
  })

  it("returns empty groups for missing categories", () => {
    expect(extractProductCategoryGroups(null)).toEqual({ types: [], genres: [] })
  })

  it("extracts type and genre handles with labels and excludes requested handles", () => {
    const categories = asCategoryInput([
      category({ handle: "music", name: "Music" }),
      category({ handle: "merch", name: "Merch" }),
      category({ handle: "death", name: "Death Metal" }),
      category({ handle: "doom" }),
      category({ handle: "grind", name: "Grindcore" }),
      category({ handle: "music", name: "Music Duplicate" }),
      category({ handle: "noise", name: "Noise" }),
      category({ handle: "  " }),
    ])

    const groups = extractProductCategoryGroups(categories, {
      excludeHandles: ["grind", "  merch  ", null, undefined],
    })

    expect(groups.types).toEqual([{ handle: "music", label: "Music Duplicate" }])
    expect(groups.genres).toEqual([
      { handle: "death", label: "Death Metal" },
      { handle: "doom", label: "Doom" },
    ])
  })
})

describe("extractNonArtistCategoryFacets", () => {
  beforeEach(() => {
    faker.seed(505)
  })

  it("excludes structural and artist-rooted categories", () => {
    const artistRoot = category({ handle: "artists", name: "Artists" })
    const genresRoot = category({ handle: "genres", name: "Genres" })
    const musicRoot = category({ handle: "music", name: "Music" })

    const categories = asFacetInput([
      artistRoot,
      genresRoot,
      category({
        handle: faker.helpers.slugify("Immolation").toLowerCase(),
        name: "Immolation",
        parent: artistRoot,
      }),
      category({ handle: "death", name: "Death Metal", parent: genresRoot }),
      category({ handle: "vinyl", name: "Vinyl", parent: musicRoot }),
      category({ handle: "vinyl", name: "Vinyl Duplicate", parent: musicRoot }),
    ])

    const facets = extractNonArtistCategoryFacets(categories)

    expect(facets).toEqual([
      {
        handle: "death",
        label: "Death Metal",
        rootHandle: "genres",
        rootLabel: "Genres",
      },
      {
        handle: "vinyl",
        label: "Vinyl Duplicate",
        rootHandle: "music",
        rootLabel: "Music",
      },
    ])
  })

  it("returns an empty array for missing category input", () => {
    expect(extractNonArtistCategoryFacets(null)).toEqual([])
  })

  it("excludes categories with blank handles", () => {
    const facets = extractNonArtistCategoryFacets(asFacetInput([category({ handle: "   " })]))
    expect(facets).toEqual([])
  })

  it("skips entries when handle cannot be resolved in a second read", () => {
    let reads = 0
    const unstableCategory = {
      get handle() {
        reads += 1
        return reads === 1 ? "music" : " "
      },
      name: "Music",
      parent_category: null,
    } as unknown as CategoryNode

    const facets = extractNonArtistCategoryFacets(asFacetInput([unstableCategory]))
    expect(facets).toEqual([])
  })
})
