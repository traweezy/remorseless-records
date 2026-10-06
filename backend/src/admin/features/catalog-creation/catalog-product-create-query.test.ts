import { z } from "zod"

import { requestAdminJson } from "../../lib/admin-request"

import {
  catalogProductCreateResponseSchema,
  createCatalogProduct,
  decideCatalogProductCreationRetry,
  getCatalogProductCreationStatus,
  loadCatalogCreationVocabulary,
  loadCatalogCreationComponentInventory,
  withCatalogCreationComponentInventory,
  type CatalogCreationProductChoiceWithStock,
} from "./catalog-product-create-query"

jest.mock("../../lib/admin-request", () => ({
  requestAdminJson: jest.fn(
    async (input: { path: string; schema: z.ZodType }) =>
      input.schema.parse(
        input.path === "/admin/catalog/artists"
          ? {
              artists: [{ id: "artist_1", name: "Artist" }],
              count: 1,
              limit: 500,
              offset: 0,
            }
          : input.path === "/admin/catalog/reference-values"
            ? {
                count: 1,
                limit: 500,
                offset: 0,
                values: [
                  {
                    id: "reference_1",
                    isActive: true,
                    kind: "genre",
                    label: "Metal",
                  },
                ],
              }
            : input.path.includes("/status/")
              ? { state: "compensated" }
              : {
                  kind: "music_release",
                  productId: "product_1",
                  profileId: "profile_1",
                  replayed: false,
                  variantIds: ["variant_1"],
                }
      )
  ),
}))

describe("catalog product creation query", () => {
  it("validates the command response", () => {
    expect(
      catalogProductCreateResponseSchema.safeParse({
        kind: "music_release",
        productId: "product_1",
        profileId: "profile_1",
        replayed: false,
        variantIds: ["variant_1"],
      }).success
    ).toBe(true)
    expect(
      catalogProductCreateResponseSchema.safeParse({
        kind: "music_release",
        productId: "",
        profileId: "profile_1",
        replayed: false,
        variantIds: [],
      }).success
    ).toBe(false)
  })

  it("uses the atomic Admin command with its longer workflow timeout", async () => {
    const response = await createCatalogProduct({
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      kind: "music_release",
      media: [],
      options: [{ title: "Format", values: ["CD"] }],
      profile: {},
      title: "Record",
      variants: [
        {
          allowBackorder: false,
          key: "cd",
          options: { Format: "CD" },
          prices: [{ amount: 10, currencyCode: "usd" }],
          profile: {},
          sku: "RECORD-CD",
          stockQuantity: 1,
          title: "CD",
        },
      ],
    })

    expect(response.productId).toBe("product_1")
  })

  it("loads the actor-scoped status used to choose a safe retry key", async () => {
    await expect(
      getCatalogProductCreationStatus("00000000-0000-4000-8000-000000000001")
    ).resolves.toEqual({ state: "compensated" })
  })

  it("reuses only ambiguous keys and rotates only fully compensated keys", () => {
    expect(decideCatalogProductCreationRetry("absent")).toBe("same-key")
    expect(decideCatalogProductCreationRetry("succeeded")).toBe("same-key")
    expect(decideCatalogProductCreationRetry("compensated")).toBe("new-key")
    expect(decideCatalogProductCreationRetry("pending")).toBe("wait")
    expect(decideCatalogProductCreationRetry("failed")).toBe("blocked")
    expect(decideCatalogProductCreationRetry("unavailable")).toBe("blocked")
  })

  it("loads and validates the controlled creation vocabulary", async () => {
    const vocabulary = await loadCatalogCreationVocabulary(
      new AbortController().signal
    )

    expect(vocabulary).toEqual({
      artists: [{ id: "artist_1", name: "Artist" }],
      references: [
        {
          id: "reference_1",
          isActive: true,
          kind: "genre",
          label: "Metal",
        },
      ],
    })
  })
})

describe("native bundle component availability", () => {
  const request = jest.mocked(requestAdminJson)
  const choices: CatalogCreationProductChoiceWithStock[] = [
    {
      id: "prod_owned",
      title: "Owned release",
      variants: [
        {
          id: "variant_owned",
          title: "CD",
          sku: "OWNED-CD",
          managesInventory: true,
          inventoryQuantity: 999,
        },
      ],
    },
  ]

  it("requests native computed stock only for the selected product", async () => {
    const signal = new AbortController().signal
    request.mockImplementationOnce(async (input) => {
      expect(input).toMatchObject({
        path: "/admin/products/prod_owned/variants",
        query: {
          fields: "id,manage_inventory,inventory_quantity",
          limit: 200,
          offset: 0,
        },
        signal,
      })
      return input.schema.parse({
        count: 1,
        variants: [
          {
            id: "variant_owned",
            manage_inventory: true,
            inventory_quantity: 19,
          },
        ],
      })
    })
    const native = await loadCatalogCreationComponentInventory(
      "prod_owned",
      signal
    )
    expect(
      withCatalogCreationComponentInventory(choices, [native])?.[0]?.variants[0]
    ).toMatchObject({ inventoryQuantity: 19, managesInventory: true })
  })

  it("keeps missing or unrelated native evidence unknown", () => {
    for (const evidence of [
      undefined,
      {
        productId: "prod_other",
        variants: [{ id: "variant_owned", manage_inventory: false }],
      },
      {
        productId: "prod_owned",
        variants: [{ id: "variant_other", manage_inventory: false }],
      },
    ]) {
      expect(
        withCatalogCreationComponentInventory(choices, [evidence])?.[0]
          ?.variants[0]
      ).toMatchObject({ inventoryQuantity: null, managesInventory: true })
    }
  })

  it("preserves real sold-out, backordered and unmanaged native states", () => {
    for (const quantity of [0, -3]) {
      expect(
        withCatalogCreationComponentInventory(choices, [
          {
            productId: "prod_owned",
            variants: [
              {
                id: "variant_owned",
                manage_inventory: true,
                inventory_quantity: quantity,
              },
            ],
          },
        ])?.[0]?.variants[0]
      ).toMatchObject({ inventoryQuantity: quantity, managesInventory: true })
    }
    expect(
      withCatalogCreationComponentInventory(choices, [
        {
          productId: "prod_owned",
          variants: [{ id: "variant_owned", manage_inventory: false }],
        },
      ])?.[0]?.variants[0]
    ).toMatchObject({ inventoryQuantity: null, managesInventory: false })
  })

  it("reads every native variant page with the caller's abort signal", async () => {
    const signal = new AbortController().signal
    for (let offset = 0; offset <= 200; offset += 200) {
      request.mockImplementationOnce(async (input) => {
        expect(input).toMatchObject({ query: { offset }, signal })
        return input.schema.parse({
          count: 201,
          variants: Array.from({ length: offset ? 1 : 200 }, (_, index) => ({
            id: `variant_${offset + index}`,
            manage_inventory: true,
            inventory_quantity: index,
          })),
        })
      })
    }
    expect(
      (await loadCatalogCreationComponentInventory("prod_owned", signal))
        .variants
    ).toHaveLength(201)
  })

  it.each(["missing", "duplicate", "changed-count"])(
    "rejects %s native stock pages without inventing availability",
    async (failure) => {
      request.mockImplementationOnce(async (input) =>
        input.schema.parse({
          count: failure === "missing" ? 2 : 201,
          variants: Array.from(
            { length: failure === "missing" ? 1 : 200 },
            (_, index) => ({
              id: `variant_${index}`,
              manage_inventory: true,
              inventory_quantity: 19,
            })
          ),
        })
      )
      if (failure !== "missing")
        request.mockImplementationOnce(async (input) =>
          input.schema.parse({
            count: failure === "changed-count" ? 202 : 201,
            variants: [
              {
                id: "variant_0",
                manage_inventory: true,
                inventory_quantity: 19,
              },
            ],
          })
        )
      await expect(
        loadCatalogCreationComponentInventory(
          "prod_owned",
          new AbortController().signal
        )
      ).rejects.toThrow(/Component (inventory|variants)/)
    }
  )
})
