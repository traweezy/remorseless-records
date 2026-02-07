import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it } from "vitest"

import {
  buildProductSlugParts,
  decodeSlugSegment,
  matchesProductSlug,
} from "@/lib/products/slug"

const asSlugInput = (
  source: Record<string, unknown>
): Parameters<typeof buildProductSlugParts>[0] =>
  source as unknown as Parameters<typeof buildProductSlugParts>[0]

describe("buildProductSlugParts", () => {
  beforeEach(() => {
    faker.seed(606)
  })

  it("prioritizes metadata artist/album and metadata slugs", () => {
    const slug = buildProductSlugParts(
      asSlugInput({
        title: "Ignored - Value",
        metadata: {
          artist: "Bjorrk",
          album: "Debut",
          artist_slug: "Bjorrk!!!",
          album_slug: "Debut (1993)",
        },
      })
    )

    expect(slug).toEqual({
      artist: "Bjorrk",
      album: "Debut",
      artistSlug: "bjorrk",
      albumSlug: "debut-1993",
    })
  })

  it("parses artist/album from title and removes format suffixes", () => {
    const slug = buildProductSlugParts(
      asSlugInput({
        title: "Ulcerate - Shrines Of Paralysis - LP",
      })
    )

    expect(slug.artist).toBe("Ulcerate")
    expect(slug.album).toBe("Shrines Of Paralysis")
    expect(slug.artistSlug).toBe("ulcerate")
    expect(slug.albumSlug).toBe("shrines-of-paralysis")
  })

  it("uses collection fallback when title has no separator", () => {
    const slug = buildProductSlugParts(
      asSlugInput({
        title: "Monolith",
        collectionTitle: "Conjurer",
      })
    )

    expect(slug.artist).toBe("Conjurer")
    expect(slug.album).toBe("Monolith")
  })

  it("derives artist and album from handle when title is unavailable", () => {
    const slug = buildProductSlugParts(
      asSlugInput({
        handle: "witchtrap-desecration-ritual",
      })
    )

    expect(slug).toEqual({
      artist: "witchtrap",
      album: "desecration ritual",
      artistSlug: "witchtrap",
      albumSlug: "desecration-ritual",
    })
  })

  it("uses category handle for artist slug when category is under artists root", () => {
    const slug = buildProductSlugParts(
      asSlugInput({
        title: "Some Artist - Some Record",
        metadata: {
          artist: "Some Artist",
          album: "Some Record",
        },
        categories: [
          {
            name: "Some Artist",
            handle: "some-artist",
            parent_category: {
              handle: "artists",
            },
          },
        ],
      })
    )

    expect(slug.artist).toBe("Some Artist")
    expect(slug.artistSlug).toBe("some-artist")
    expect(slug.albumSlug).toBe("some-record")
  })

  it("falls back to defaults when no useful source exists", () => {
    const slug = buildProductSlugParts(asSlugInput({}))

    expect(slug).toEqual({
      artist: "Remorseless Records",
      album: "Remorseless Records",
      artistSlug: "remorseless-records",
      albumSlug: "remorseless-records",
    })
  })

  it("handles blank titles and single-token handles", () => {
    const fromBlankTitle = buildProductSlugParts(
      asSlugInput({
        title: "   ",
        collectionTitle: "Fallback Collection",
      })
    )
    const fromSingleHandle = buildProductSlugParts(
      asSlugInput({
        handle: "single",
      })
    )
    const fromDelimiterOnlyHandle = buildProductSlugParts(
      asSlugInput({
        handle: "----",
      })
    )

    expect(fromBlankTitle.artist).toBe("Fallback Collection")
    expect(fromBlankTitle.album).toBe("Fallback Collection")
    expect(fromSingleHandle).toEqual({
      artist: "single",
      album: "single",
      artistSlug: "single",
      albumSlug: "single",
    })
    expect(fromDelimiterOnlyHandle).toEqual({
      artist: "----",
      album: "----",
      artistSlug: "release",
      albumSlug: "release",
    })
  })

  it("ignores non-artist categories when selecting artist category", () => {
    const slug = buildProductSlugParts(
      asSlugInput({
        title: "Artist - Album",
        categories: [
          {
            handle: "music",
            name: "Music",
            parent_category: null,
          },
        ],
      })
    )

    expect(slug.artistSlug).toBe("artist")
  })

  it("skips artist categories when the category handle is unusable", () => {
    const slug = buildProductSlugParts(
      asSlugInput({
        title: "Artist - Album",
        categories: [
          {
            handle: 42,
            name: "Artist",
            parent_category: {
              handle: "artists",
            },
          },
          {
            handle: " ",
            name: "Artist",
            parent_category: {
              handle: "artists",
            },
          },
        ],
      })
    )

    expect(slug.artistSlug).toBe("artist")
  })
})

describe("matchesProductSlug", () => {
  it("matches against derived slug parts", () => {
    const source = asSlugInput({
      title: "Portal - Vexovoid",
    })

    expect(matchesProductSlug(source, "portal", "vexovoid")).toBe(true)
    expect(matchesProductSlug(source, "portal", "avow")).toBe(false)
  })
})

describe("decodeSlugSegment", () => {
  it("converts hyphenated slug segments into human readable values", () => {
    expect(decodeSlugSegment("blackened-death-metal")).toBe("blackened death metal")
  })
})
