import { describe, expect, it } from "vitest"

import {
  filterDiscographyEntries,
  sortDiscographyEntries,
  type DiscographyFilters,
} from "@/components/discography/discography-table"
import type { DiscographyEntry } from "@/lib/data/discography"

const entry = (
  overrides: Partial<DiscographyEntry> & Pick<DiscographyEntry, "id" | "title">
): DiscographyEntry => {
  const { id, title, ...rest } = overrides
  return {
    id,
    title,
    artist: "Artist",
    album: title,
    slug: {
      artist: "Artist",
      album: title,
      artistSlug: "artist",
      albumSlug: title.toLowerCase().replaceAll(" ", "-"),
    },
    productHandle: `music-release-${id}`,
    productPath: `/music-release/${id}`,
    sourceMode: "catalog_product",
    linkHealth: "healthy",
    collectionTitle: null,
    catalogNumber: null,
    releaseDate: null,
    releaseYear: null,
    formats: [],
    genres: [],
    tags: [],
    availability: "unknown",
    coverUrl: null,
    coverAltText: null,
    ...rest,
  }
}

const entries = [
  entry({
    id: "prod_new",
    title: "Blestemul din adânc",
    artist: "Cultus",
    catalogNumber: "RR010",
    releaseDate: "2025-10-31",
    releaseYear: 2025,
    formats: ["Vinyl", "CD"],
    tags: ["Black Metal"],
    availability: "in_print",
  }),
  entry({
    id: "prod_old",
    title: "Demo",
    artist: "Rötual",
    releaseDate: "2024-01-01",
    releaseYear: 2024,
    formats: ["Cassette"],
    tags: ["Death Metal"],
    availability: "out_of_print",
  }),
  entry({
    id: "prod_unknown",
    title: "Archive",
    artist: "Various",
  }),
]

const filters: DiscographyFilters = {
  availability: "",
  format: "",
  query: "",
  tag: "",
}

describe("discography list controls", () => {
  it("combines independent filters and accent-insensitive search", () => {
    expect(
      filterDiscographyEntries(entries, {
        ...filters,
        availability: "in_print",
        format: "CD",
        query: "adanc",
        tag: "Black Metal",
      }).map(({ id }) => id)
    ).toEqual(["prod_new"])

    expect(
      filterDiscographyEntries(entries, {
        ...filters,
        query: "rotual",
      }).map(({ id }) => id)
    ).toEqual(["prod_old"])
  })

  it("sorts dated releases while keeping unknown dates last", () => {
    expect(
      sortDiscographyEntries(entries, "newest").map(({ id }) => id)
    ).toEqual(["prod_new", "prod_old", "prod_unknown"])
    expect(
      sortDiscographyEntries(entries, "oldest").map(({ id }) => id)
    ).toEqual(["prod_old", "prod_new", "prod_unknown"])
  })

  it("sorts catalog numbers high-to-low using natural numeric order", () => {
    expect(
      sortDiscographyEntries(
        [
          ...entries,
          entry({
            id: "prod_second",
            title: "Second",
            catalogNumber: "RR2",
          }),
        ],
        "catalog-desc"
      ).map(({ id }) => id)
    ).toEqual(["prod_new", "prod_second", "prod_old", "prod_unknown"])
  })
})
