import { ProductStatus } from "@medusajs/framework/utils"

import {
  readStoreDiscographyProductProjections,
  readStoreProductHandleProjections,
  readStoreRelatedProductProjections,
  readStoreShelfProductProjections,
} from "./store-product-projections"

const invalidBoundary =
  "The Store product projection returned invalid structured data."

describe("Store product projections", () => {
  it("normalizes validated product-handle timestamps", () => {
    expect(
      readStoreProductHandleProjections([
        {
          created_at: new Date("2026-08-01T00:00:00.000Z"),
          handle: "first-release",
          id: "prod_1",
          updated_at: "2026-08-28T00:00:00-04:00",
        },
      ])
    ).toEqual([
      {
        created_at: "2026-08-01T00:00:00.000Z",
        handle: "first-release",
        id: "prod_1",
        updated_at: "2026-08-28T04:00:00.000Z",
      },
    ])
  })

  it.each([
    undefined,
    [null],
    [{ created_at: null, handle: null, id: "prod_1", updated_at: null }],
    [{ created_at: null, handle: " release", id: "prod_1", updated_at: null }],
    [
      {
        created_at: "not-a-date",
        handle: "release",
        id: "prod_1",
        updated_at: null,
      },
    ],
    [
      { created_at: null, handle: "first", id: "prod_1", updated_at: null },
      { created_at: null, handle: "second", id: "prod_1", updated_at: null },
    ],
  ])("rejects malformed product-handle projections", (value) => {
    expect(() => readStoreProductHandleProjections(value)).toThrow(
      invalidBoundary
    )
  })

  it("validates discography and shelf Product projections", () => {
    expect(
      readStoreDiscographyProductProjections([
        {
          handle: "visible-release",
          id: "prod_visible",
          status: ProductStatus.PUBLISHED,
        },
      ])
    ).toEqual([
      {
        handle: "visible-release",
        id: "prod_visible",
        status: ProductStatus.PUBLISHED,
      },
    ])
    expect(
      readStoreShelfProductProjections([
        {
          created_at: new Date("2026-08-01T00:00:00.000Z"),
          id: "prod_visible",
        },
      ])
    ).toEqual([
      {
        created_at: "2026-08-01T00:00:00.000Z",
        id: "prod_visible",
      },
    ])
  })

  it.each([
    {
      value: [
        { handle: null, id: "prod_visible", status: ProductStatus.PUBLISHED },
      ],
    },
    {
      value: [{ handle: "release", id: "prod_visible", status: "draft" }],
    },
    {
      value: [
        {
          handle: "release",
          id: "prod_visible",
          status: ProductStatus.PUBLISHED,
        },
        {
          handle: "duplicate",
          id: "prod_visible",
          status: ProductStatus.PUBLISHED,
        },
      ],
    },
  ])("rejects malformed discography Product projections", ({ value }) => {
    expect(() => readStoreDiscographyProductProjections(value)).toThrow(
      invalidBoundary
    )
  })

  it.each([
    [{ created_at: null, id: "prod_visible" }],
    [{ created_at: "not-a-date", id: "prod_visible" }],
    [{ created_at: "2026-08-01T00:00:00.000Z", id: " prod_visible" }],
  ])("rejects malformed shelf Product projections", (value) => {
    expect(() => readStoreShelfProductProjections(value)).toThrow(
      invalidBoundary
    )
  })

  it("allowlists and validates the related Product projection", () => {
    expect(
      readStoreRelatedProductProjections([
        {
          categories: [
            {
              handle: "artist-name",
              id: "pcat_artist",
              name: "Artist Name",
              parent_category: {
                handle: "artists",
                id: "pcat_artists",
                name: "Artists",
              },
              parent_category_id: "pcat_artists",
            },
          ],
          collection: { id: "pcol_1", title: "Collection" },
          collection_id: "pcol_1",
          handle: "release",
          id: "prod_release",
          metadata: { artist: "Artist Name", private_note: "do not expose" },
          status: ProductStatus.PUBLISHED,
          title: "Artist Name - Release",
        },
      ])
    ).toEqual([
      {
        categories: [
          {
            handle: "artist-name",
            id: "pcat_artist",
            name: "Artist Name",
            parent_category: {
              handle: "artists",
              id: "pcat_artists",
              name: "Artists",
            },
            parent_category_id: "pcat_artists",
          },
        ],
        collection: { id: "pcol_1", title: "Collection" },
        collection_id: "pcol_1",
        handle: "release",
        id: "prod_release",
        metadata: { artist: "Artist Name" },
        status: ProductStatus.PUBLISHED,
        title: "Artist Name - Release",
      },
    ])
  })

  it.each([
    [
      {
        categories: [],
        collection: { id: "pcol_other", title: "Other" },
        collection_id: "pcol_1",
        handle: "release",
        id: "prod_release",
        metadata: {},
        status: ProductStatus.PUBLISHED,
        title: "Release",
      },
    ],
    [
      {
        categories: [
          {
            handle: "genre",
            id: "pcat_genre",
            name: "Genre",
            parent_category: null,
            parent_category_id: null,
          },
          {
            handle: "duplicate",
            id: "pcat_genre",
            name: "Duplicate",
            parent_category: null,
            parent_category_id: null,
          },
        ],
        collection: null,
        collection_id: null,
        handle: "release",
        id: "prod_release",
        metadata: {},
        status: ProductStatus.PUBLISHED,
        title: "Release",
      },
    ],
    [
      {
        categories: [],
        collection: null,
        collection_id: null,
        handle: "release",
        id: "prod_release",
        metadata: { artist: false },
        status: ProductStatus.PUBLISHED,
        title: "Release",
      },
    ],
  ])("rejects inconsistent related Product projections", (value) => {
    expect(() => readStoreRelatedProductProjections(value)).toThrow(
      invalidBoundary
    )
  })
})
