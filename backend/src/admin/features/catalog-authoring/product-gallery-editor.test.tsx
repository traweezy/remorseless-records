import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderToStaticMarkup } from "react-dom/server"

import { adminPermissionKey } from "../../../lib/admin-permissions"
import {
  adminFeatureFlagsQueryKey,
  adminPermissionsQueryKey,
} from "../../lib/admin-permissions"
import {
  ProductGalleryEditor,
  ProductGalleryFeedback,
  ProductGalleryRows,
  productGalleryReadActions,
  productGalleryWriteActions,
} from "./product-gallery-editor"
import type { GalleryLink } from "./product-gallery-query"
import type { SavedGallery } from "./product-gallery-command-state"

const link = (
  id: string,
  variantId: string | null,
  primary = false
): GalleryLink => ({
  id,
  productId: "product_acceptance",
  variantId,
  productProfileId: "profile_acceptance",
  mediaAssetId: `asset_${id}`,
  role: primary ? "primary" : "gallery",
  sortOrder: primary ? 0 : 1,
  isPrimary: primary,
  metadata: {},
  asset: {
    id: `asset_${id}`,
    sourceUrl: `https://images.example.test/${id}.webp`,
    altText: `${id} artwork`,
    originalFilename: `${id}.webp`,
    lifecycleStatus: "active",
    version: 1,
  },
})
const renderEditor = (permissions?: readonly string[], pending = false) => {
  const client = new QueryClient()
  if (!pending) client.setQueryData(adminFeatureFlagsQueryKey, { rbac: true })
  if (permissions)
    client.setQueryData(adminPermissionsQueryKey, { permissions })
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ProductGalleryEditor
        productId="product_acceptance"
        profileId="profile_acceptance"
        variants={[]}
      />
    </QueryClientProvider>
  )
  client.clear()
  return markup
}

describe("native protected existing-gallery UI", () => {
  it.each(["error", "preflight", "uncertain", "confirmed"] as const)(
    "announces the actual %s gallery state with its appropriate live role",
    (kind) => {
      const record: SavedGallery = {
        version: 1,
        context: {
          productId: "product_acceptance",
          backendOrigin: "https://admin.example.test",
        },
        body: {
          expectedActorId: "user_original",
          expectedVersion: 0,
          idempotencyKey: "79368c83-8dc1-443a-9b96-2a92a6e9b0cb",
          media: [],
        },
        status: kind === "confirmed" ? "confirmed" : "uncertain",
        projection:
          kind === "confirmed"
            ? { productId: "product_acceptance", version: 1, media: [] }
            : null,
      }
      const markup = renderToStaticMarkup(
        <ProductGalleryFeedback
          error={
            kind === "error"
              ? "Storage is unavailable. Nothing was sent."
              : null
          }
          preflight={
            kind === "preflight" ? "Choose one primary product image." : null
          }
          record={kind === "uncertain" || kind === "confirmed" ? record : null}
        />
      )
      expect(markup).toContain(
        `role="${kind === "confirmed" ? "status" : "alert"}"`
      )
      if (kind === "error") expect(markup).toContain("Nothing was sent")
      if (kind === "preflight") expect(markup).toContain("Choose one primary")
      if (kind === "uncertain") expect(markup).toContain("Keep this request")
      if (kind === "confirmed") expect(markup).toContain("Gallery saved")
    }
  )

  it.each(productGalleryReadActions)(
    "does not mount gallery content without read permission %#",
    (missing) => {
      const markup = renderEditor(
        productGalleryReadActions
          .filter((item) => item !== missing)
          .map(adminPermissionKey)
      )
      expect(markup).not.toContain("Save gallery")
      expect(markup).not.toContain("product-authoring-gallery")
      expect(markup).not.toContain("Refresh gallery")
    }
  )

  it("does not mount protected gallery controls while native permissions are pending", () => {
    const markup = renderEditor(undefined, true)
    expect(markup).toContain("Checking widget access")
    expect(markup).not.toContain("Save gallery")
    expect(markup).not.toContain("product-authoring-gallery")
  })

  it("allows read-only gallery access without mounting a save action", () => {
    const markup = renderEditor(
      productGalleryReadActions.map(adminPermissionKey)
    )
    expect(markup).toContain("product-authoring-gallery")
    expect(markup).toContain("cannot save gallery changes")
    expect(markup).not.toContain(">Save gallery</button>")
    expect(markup).toContain("Refresh gallery")
  })

  it.each(
    productGalleryWriteActions.filter(
      (action) =>
        !productGalleryReadActions.includes(
          action as (typeof productGalleryReadActions)[number]
        )
    )
  )("requires each additional write permission %#", (missing) => {
    const keys = [...productGalleryReadActions, ...productGalleryWriteActions]
      .filter((item) => item !== missing)
      .map(adminPermissionKey)
    const markup = renderEditor(keys)
    expect(markup).toContain("cannot save gallery changes")
    expect(markup).not.toContain(">Save gallery</button>")
  })

  it("uses a separate non-submit save action without wrapping the parent authoring form", () => {
    const markup = renderEditor(
      [...productGalleryReadActions, ...productGalleryWriteActions].map(
        adminPermissionKey
      )
    )
    expect(markup).toContain(">Save gallery</button>")
    expect(markup).not.toContain("<form")
    expect(markup).not.toContain('type="submit"')
    expect(markup).toContain("Gallery saves are separate")
  })

  it("renders distinct product and variant galleries with contained, unstretched image previews", () => {
    const markup = renderToStaticMarkup(
      <ProductGalleryRows
        disabled={false}
        media={[
          link("product_primary", null, true),
          link("product_second", null),
          link("variant_primary", "variant_a", true),
          link("variant_second", "variant_a"),
        ]}
        variants={[{ id: "variant_a", title: "Cassette" }]}
        onMove={jest.fn()}
        onPrimary={jest.fn()}
      />
    )
    expect(markup).toContain('aria-label="Product gallery"')
    expect(markup).toContain('aria-label="Variant gallery Cassette"')
    expect(markup).toContain("object-contain")
    expect(markup.match(/width="96"/gu)).toHaveLength(4)
    expect(markup.match(/height="96"/gu)).toHaveLength(4)
    expect(markup).toContain('aria-label="Make image 2 primary in Cassette"')
    expect(markup).toContain(
      'aria-label="Move image 2 earlier in product gallery"'
    )
    expect(markup).not.toContain('type="submit"')
  })

  it("disables every editing control while a saved request is unresolved", () => {
    const markup = renderToStaticMarkup(
      <ProductGalleryRows
        disabled
        media={[link("primary", null, true), link("second", null)]}
        variants={[]}
        onMove={jest.fn()}
        onPrimary={jest.fn()}
      />
    )
    expect(markup.match(/<button/gu)).toHaveLength(6)
    expect(markup.match(/disabled=""/gu)).toHaveLength(6)
  })

  it("permits choosing one primary when a legacy gallery contains conflicting primary flags", () => {
    const markup = renderToStaticMarkup(
      <ProductGalleryRows
        disabled={false}
        media={[
          link("first", null, true),
          { ...link("second", null, true), sortOrder: 1 },
        ]}
        variants={[]}
        onMove={jest.fn()}
        onPrimary={jest.fn()}
      />
    )
    expect(markup.match(/disabled=""/gu)).toHaveLength(2)
    expect(markup.match(/>Make primary<\/button>/gu)).toHaveLength(2)
  })

  it("names a missing managed file without stretching or presenting it as available", () => {
    const markup = renderToStaticMarkup(
      <ProductGalleryRows
        disabled={false}
        media={[{ ...link("missing", null), asset: null }]}
        variants={[]}
        onMove={jest.fn()}
        onPrimary={jest.fn()}
      />
    )
    expect(markup).toContain("File unavailable")
    expect(markup).toContain("Unavailable")
    expect(markup).toContain("No alt text")
    expect(markup).not.toContain("<img")
  })

  it("describes an empty gallery without adding upload or asset-edit mutations", () => {
    const markup = renderToStaticMarkup(
      <ProductGalleryRows
        disabled={false}
        media={[]}
        variants={[]}
        onMove={jest.fn()}
        onPrimary={jest.fn()}
      />
    )
    expect(markup).toContain("no managed gallery images")
    expect(markup).not.toContain("<button")
    expect(markup).not.toContain("<input")
  })
})
