import type { AdminProduct } from "@medusajs/framework/types";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import {
  productAuthoringViewQueryKey,
  type ProductAuthoringView,
} from "./product-authoring-query";
import { ProductCatalogSummaryWidget } from "./product-catalog-summary-widget";

const productId = "prod_01";

const view: ProductAuthoringView = {
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
    id: productId,
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
};

describe("ProductCatalogSummaryWidget", () => {
  it("renders the authoritative summary and an SPA editor deep link", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    queryClient.setQueryData(productAuthoringViewQueryKey(productId), view);

    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <ProductCatalogSummaryWidget
            data={{ id: productId } as AdminProduct}
          />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(markup).toContain("Catalog summary");
    expect(markup).toContain("Music release");
    expect(markup).toContain("Test Artist");
    expect(markup).toContain("Catalog completion");
    expect(markup).toContain("Customer availability");
    expect(markup).toContain("Managed media");
    expect(markup).toContain("Offerings");
    expect(markup).toContain('href="/catalog/products/prod_01"');
    expect(markup).not.toContain("/app/catalog/products");
  });
});
