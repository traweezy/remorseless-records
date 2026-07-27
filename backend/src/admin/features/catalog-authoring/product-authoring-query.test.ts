import { requestAdminJson } from "../../lib/admin-request";
import {
  productAuthoringViewPayloadSchema,
  productAuthoringViewQueryOptions,
} from "./product-authoring-query";

jest.mock("../../lib/admin-request", () => ({
  requestAdminJson: jest.fn(),
}));

const validPayload = {
  view: {
    catalog: {
      artists: [
        {
          artist: { id: "cartist_01", name: "Test Artist" },
          assignment: { displayName: "Test Artist", role: "primary" },
        },
      ],
      bundle: null,
      label: { id: "cref_label", label: "Remorseless Records" },
      media: [
        {
          asset: { altText: "Album cover", lifecycleStatus: "active" },
          isPrimary: true,
          mediaAssetId: "cmedia_01",
        },
      ],
      productType: { id: "cref_type", label: "Music release" },
      profile: {
        id: "cprod_01",
        releaseDate: "2026-01-01T00:00:00.000Z",
        releaseDatePrecision: "day",
        releaseTitle: "Test Release",
        releaseYear: 2026,
      },
      variants: [
        {
          format: { id: "cref_format", label: "CD" },
          formatDetail: null,
          status: {
            customerStatus: "in_stock",
            inventoryQuantity: 12,
            inventoryStatus: "in_stock",
            reason: "12 units are currently available.",
          },
          variantId: "variant_01",
        },
      ],
    },
    classification: {
      issues: [],
      kind: "music_release",
      status: "classified",
    },
    commerce: {
      handle: "test-release",
      id: "prod_01",
      status: "published",
      title: "Test Release",
      variants: [{ id: "variant_01", title: "CD" }],
    },
    diagnostics: {
      duplicateBundleProfileIds: [],
      duplicateProductProfileIds: [],
      inventoryAvailability: "available",
      missingArtistIds: [],
      missingMediaAssetIds: [],
      missingReferenceValueIds: [],
      missingVariantProfileIds: [],
      orphanVariantProfileIds: [],
    },
  },
} as const;

describe("product authoring view query boundary", () => {
  beforeEach(() => {
    jest.mocked(requestAdminJson).mockReset();
  });

  it("accepts the consolidated commerce, catalog, and diagnostic summary", () => {
    expect(productAuthoringViewPayloadSchema.parse(validPayload)).toEqual(
      validPayload,
    );
  });

  it("rejects unsupported classifications and malformed inventory", () => {
    expect(() =>
      productAuthoringViewPayloadSchema.parse({
        ...validPayload,
        view: {
          ...validPayload.view,
          catalog: {
            ...validPayload.view.catalog,
            variants: [
              {
                ...validPayload.view.catalog.variants[0],
                status: {
                  ...validPayload.view.catalog.variants[0].status,
                  inventoryQuantity: "12",
                },
              },
            ],
          },
          classification: {
            ...validPayload.view.classification,
            kind: "deal",
          },
        },
      }),
    ).toThrow();
  });

  it("encodes the product id and forwards Query cancellation", async () => {
    jest.mocked(requestAdminJson).mockResolvedValue(validPayload);
    const options = productAuthoringViewQueryOptions("prod/01");
    const controller = new AbortController();

    await expect(
      options.queryFn?.({
        meta: undefined,
        queryKey: options.queryKey,
        signal: controller.signal,
      }),
    ).resolves.toEqual(validPayload.view);

    expect(requestAdminJson).toHaveBeenCalledWith({
      path: "/admin/catalog/products/prod%2F01/authoring-view",
      schema: productAuthoringViewPayloadSchema,
      signal: controller.signal,
    });
    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.retry).toBe(false);
    expect(options.staleTime).toBe(30_000);
  });
});
