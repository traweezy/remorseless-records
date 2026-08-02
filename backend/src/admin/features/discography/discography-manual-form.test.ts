import {
  buildManualDiscographyInput,
  discographyManualFormSchema,
  valuesFromDiscographyEntry,
} from "./discography-manual-form"
import type { DiscographyEntry } from "./discography-query"

const entry: DiscographyEntry = {
  album: "Demo",
  archivedAt: null,
  artist: "Artist",
  availability: "out_of_print",
  catalogNumber: "RR001",
  collectionTitle: "Remorseless",
  coverAltText: "Black and white sleeve",
  coverUrl: "https://example.com/demo.jpg",
  createdAt: null,
  formats: ["CD", "Cassette"],
  genres: ["Death metal"],
  id: "disc_1",
  lastSyncedAt: null,
  linkHealth: "not_applicable",
  productHandle: null,
  productId: null,
  releaseDate: null,
  releaseYear: 1999,
  sourceMode: "manual",
  tags: ["Demo"],
  title: "Demo",
  updatedAt: null,
  version: 1,
}

describe("discography historical form", () => {
  it("keeps a new untouched form invalid until required fields are present", () => {
    expect(
      discographyManualFormSchema.safeParse({
        ...valuesFromDiscographyEntry(entry),
        artist: "",
        releaseTitle: "",
      }).success
    ).toBe(false)
  })

  it("uses a single date-detail control and normalizes list input", () => {
    const values = valuesFromDiscographyEntry(entry)
    const input = buildManualDiscographyInput({
      ...values,
      formatsText: "CD, cassette\ncd",
      tagsText: "Demo, demo, Archive",
    })

    expect(values).toMatchObject({
      datePrecision: "year",
      dateValue: "1999",
    })
    expect(input).toMatchObject({
      formats: ["CD", "cassette"],
      releaseDate: null,
      releaseYear: 1999,
      tags: ["Demo", "Archive"],
    })
  })

  it("rejects impossible dates and malformed artwork URLs", () => {
    const values = valuesFromDiscographyEntry(entry)
    expect(
      discographyManualFormSchema.safeParse({
        ...values,
        coverUrl: "not-a-url",
        datePrecision: "day",
        dateValue: "2026-02-31",
      }).success
    ).toBe(false)
  })
})
