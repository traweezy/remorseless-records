import http from "node:http"
import { pathToFileURL } from "node:url"

export const defaultCiMedusaFixtureHost = "127.0.0.1"
export const defaultCiMedusaFixturePort = 4010
export const defaultCiMedusaPublishableKey = "pk_ci_storefront_fixture_20260831"

const fixtureProduct = {
  id: "prod_CIPATHOLOGIST",
  handle: "music-release-pathologist-pathological-decomposition",
  title: "Pathological Decomposition",
  subtitle: "Pathologist",
  description: "A deterministic release used by pre-deploy browser acceptance.",
  status: "published",
  created_at: "2026-08-31T00:00:00.000Z",
  updated_at: "2026-08-31T00:00:00.000Z",
  thumbnail: null,
  collection: null,
  categories: [
    { id: "pcat_CIMUSIC", handle: "music", name: "Music" },
    { id: "pcat_CIDEATH", handle: "death", name: "Death Metal" },
  ],
  images: [],
  metadata: {
    artist_names: ["Pathologist"],
    product_type: "music_release",
    tracklist: ["Exhumed Remains", "Pathological Decomposition"],
  },
  options: [
    {
      id: "opt_CIFORMAT",
      title: "Format",
      values: [{ id: "optval_CICD", value: "CD" }],
    },
  ],
  tags: [{ id: "ptag_CIGRIND", value: "Grind" }],
  variants: [
    {
      id: "variant_CIPATHOLOGISTCD",
      title: "CD",
      sku: "CI-PATH-CD",
      allow_backorder: false,
      manage_inventory: true,
      inventory_quantity: 10,
      calculated_price: {
        calculated_amount: 15,
        calculated_amount_with_tax: 15,
        currency_code: "usd",
        original_amount: 15,
      },
      metadata: { inventory_count_status: "verified" },
      options: [{ id: "optval_CICD", value: "CD" }],
    },
  ],
}

// An exact-handle-only product exercises gallery transitions without changing
// catalog, shelf, sitemap, or existing no-artwork acceptance fixtures.
const galleryRuntimeProduct = {
  ...fixtureProduct,
  id: "prod_CIGALLERYRUNTIME",
  handle: "music-release-ci-gallery-artwork",
  title: "Gallery Runtime Pressing",
  images: [
    "/remorseless-hero-logo.png",
    "/remorseless-header-logo.png",
    "/favicon.ico",
  ].map((url, index) => ({
    id: `img_CIGALLERY_${index}`,
    url,
  })),
}

// Exact-handle/collection fixtures keep the ordinary catalog and shelves
// unchanged while rendering real carousel cards with three artwork shapes.
const carouselRuntimeProduct = {
  ...fixtureProduct,
  id: "prod_CICAROUSELARTWORK",
  handle: "music-release-ci-carousel-artwork",
  title: "Carousel Artwork Pressing",
  collection_id: "pcol_CICAROUSELARTWORK",
}
const carouselArtworkProducts = ["square", "portrait", "landscape"].map(
  (shape) => ({
    ...fixtureProduct,
    id: `prod_CICAROUSEL_${shape.toUpperCase()}`,
    handle: `music-release-ci-carousel-${shape}`,
    title: `Carousel ${shape} artwork`,
    thumbnail: `/__e2e__/artwork-${shape}.svg`,
    images: [],
  })
)

const availabilityRuntimeProduct = {
  ...fixtureProduct,
  id: "prod_CICAROUSELAVAILABILITY",
  handle: "music-release-ci-carousel-availability",
  title: "Carousel Availability Pressing",
  collection_id: "pcol_CICAROUSELAVAILABILITY",
}
const availabilityProducts = ["available", "sold-out", "unavailable"].map(
  (state) => ({
    ...fixtureProduct,
    id: `prod_CIAVAILABILITY_${state.toUpperCase()}`,
    handle: `music-release-ci-availability-${state}`,
    title: `Carousel ${state} pressing`,
    thumbnail: "/remorseless-hero-logo.png",
    metadata: {
      ...fixtureProduct.metadata,
      artist_names: [`Fixture ${state} artist`],
    },
    variants: fixtureProduct.variants.map((variant) => ({
      ...variant,
      id: `variant_CIAVAILABILITY_${state.toUpperCase()}`,
      inventory_quantity: state === "sold-out" ? 0 : 10,
      calculated_price:
        state === "unavailable" ? null : variant.calculated_price,
    })),
  })
)

const numberedTracklistProduct = {
  ...galleryRuntimeProduct,
  id: "prod_CINUMBEREDTRACKLIST",
  handle: "music-release-ci-numbered-tracklist",
  title: "Authored Tracklist Pressing",
  metadata: {
    ...fixtureProduct.metadata,
    tracklist: ["1. Exhumed Remains", "2. Pathological Decomposition"],
  },
}

// An editor-authored product deliberately has no native artwork or prefixed
// handle. Its only display content comes from the public catalog projection.
const presentedRuntimeProduct = {
  ...fixtureProduct,
  id: "prod_CIPRESENTATION",
  handle: "ci-editor-shirt",
  title: "Editor Authored Shirt",
  description: "Stale native description",
  images: [],
  thumbnail: null,
  metadata: {},
}
const presentedRuntimeRow = {
  productId: presentedRuntimeProduct.id,
  managedMedia: true,
  profile: {
    productType: "merch",
    label: "Remorseless Records",
    artists: [],
    genres: [],
    descriptionHtml:
      "<p>Canonical <strong>cotton</strong> shirt &amp; original artwork.</p>",
    tracklist: [],
    credits: null,
    pressingNotes: null,
    merch: {
      material: "Cotton",
      fit: "Regular",
      sizeGuide: "S: 18 inches\nM: 20 inches",
      care: "Cold wash",
    },
  },
  images: [
    {
      id: "cpmedia_CISHIRT",
      url: "/remorseless-header-logo.png",
      alt: "Original landscape shirt artwork",
      width: 1200,
      height: 600,
    },
  ],
}

const richTextNews = {
  id: "news_CIRICHTEXT",
  title: "Rich text navigation dispatch",
  slug: "ci-rich-text",
  excerpt: "A local article for client navigation acceptance.",
  content:
    '<h2>Studio notes</h2><p>Pressing <strong>vinyl</strong> &amp; keeping &lt;script&gt; as text.</p><ul><li>First pressing</li><li>Second pressing</li></ul><p><a href="javascript:alert(1)">Unsafe link</a></p>',
  author: "CI Editor",
  status: "published",
  publishedAt: "2026-08-31T00:00:00.000Z",
  tags: [],
  coverUrl: null,
  seoTitle: null,
  seoDescription: null,
}

const fixtureShelves = {
  shelves: [
    {
      shelf: {
        handle: "featured",
        title: "Featured Picks",
        description: "Client-curated selections.",
        showRibbon: true,
        ribbonLabel: "Featured",
        ribbonPriority: 20,
      },
      productIds: [fixtureProduct.id],
    },
    {
      shelf: {
        handle: "new-releases",
        title: "New in Store",
        description: "The latest and greatest, available now.",
        showRibbon: true,
        ribbonLabel: "New",
        ribbonPriority: 10,
      },
      productIds: [fixtureProduct.id],
    },
    {
      shelf: {
        handle: "staff-picks",
        title: "Staff Signals",
        description: "Staff selections.",
        showRibbon: false,
        ribbonLabel: null,
        ribbonPriority: 30,
      },
      productIds: [],
    },
  ],
}

const fixtureDiscography = {
  entries: [
    {
      id: "disc_CIPATHOLOGIST",
      title: fixtureProduct.title,
      artist: "Pathologist",
      album: fixtureProduct.title,
      productHandle: fixtureProduct.handle,
      sourceMode: "catalog_product",
      linkHealth: "healthy",
      collectionTitle: null,
      catalogNumber: "RR-CI-001",
      releaseDate: "2026-08-31T00:00:00.000Z",
      releaseYear: 2026,
      formats: ["CD"],
      genres: ["Death Metal", "Grind"],
      tags: ["CI fixture"],
      availability: "in_print",
      coverUrl: null,
      coverAltText: null,
    },
  ],
  count: 1,
  offset: 0,
  limit: 200,
}

const jsonHeaders = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
}

const writeJson = (request, response, status, payload) => {
  response.writeHead(status, jsonHeaders)
  response.end(request.method === "HEAD" ? undefined : JSON.stringify(payload))
}

const routePayload = (pathname, searchParams) => {
  switch (pathname) {
    case "/store/catalog/presentation":
      return {
        presentations: (searchParams.get("product_ids") ?? "")
          .split(",")
          .filter((id) =>
            [
              fixtureProduct.id,
              galleryRuntimeProduct.id,
              carouselRuntimeProduct.id,
              ...carouselArtworkProducts.map((product) => product.id),
              availabilityRuntimeProduct.id,
              ...availabilityProducts.map((product) => product.id),
              numberedTracklistProduct.id,
              presentedRuntimeProduct.id,
            ].includes(id)
          )
          .map((productId) =>
            productId === presentedRuntimeProduct.id
              ? presentedRuntimeRow
              : {
                  productId,
                  profile: null,
                  managedMedia: false,
                  images: [],
                }
          ),
      }
    case "/store/catalog/shelves":
      return fixtureShelves
    case "/store/collections":
      return { collections: [], count: 0, offset: 0, limit: 1 }
    case "/store/discography":
      return fixtureDiscography
    case "/store/news":
      return {
        entries:
          Number(searchParams.get("offset") ?? 0) === 0 ? [richTextNews] : [],
        count: 1,
        offset: Number(searchParams.get("offset") ?? 0),
        limit: Number(searchParams.get("limit") ?? 12),
      }
    case "/store/news/ci-rich-text":
      return { entry: richTextNews }
    case "/store/products": {
      const requestedHandle = searchParams.get("handle")
      const carouselArtwork = carouselArtworkProducts.find(
        (product) => product.handle === requestedHandle
      )
      const availability = availabilityProducts.find(
        (product) => product.handle === requestedHandle
      )
      const products =
        searchParams.get("collection_id") ===
        availabilityRuntimeProduct.collection_id
          ? availabilityProducts
          : requestedHandle === availabilityRuntimeProduct.handle
            ? [availabilityRuntimeProduct]
            : availability
              ? [availability]
              : searchParams.get("collection_id") ===
                  carouselRuntimeProduct.collection_id
                ? carouselArtworkProducts
                : requestedHandle === carouselRuntimeProduct.handle
                  ? [carouselRuntimeProduct]
                  : carouselArtwork
                    ? [carouselArtwork]
                    : requestedHandle === presentedRuntimeProduct.handle
                      ? [presentedRuntimeProduct]
                      : requestedHandle === numberedTracklistProduct.handle
                        ? [numberedTracklistProduct]
                        : requestedHandle === galleryRuntimeProduct.handle
                          ? [galleryRuntimeProduct]
                          : requestedHandle &&
                              requestedHandle !== fixtureProduct.handle
                            ? []
                            : [fixtureProduct]
      return {
        products,
        count: products.length,
        offset: Number(searchParams.get("offset") ?? 0),
        limit: Number(searchParams.get("limit") ?? products.length),
      }
    }
    case "/store/products/handles":
      return {
        handles: [
          {
            id: fixtureProduct.id,
            handle: fixtureProduct.handle,
            created_at: fixtureProduct.created_at,
            updated_at: fixtureProduct.updated_at,
          },
        ],
        next_cursor: null,
      }
    case "/store/regions":
      return {
        regions: [
          {
            id: "reg_CIUS",
            currency_code: "usd",
            countries: [{ iso_2: "us" }],
          },
        ],
        count: 1,
        offset: 0,
        limit: 100,
      }
    default:
      return null
  }
}

export const createCiMedusaFixtureServer = ({
  host = defaultCiMedusaFixtureHost,
  port = defaultCiMedusaFixturePort,
  publishableKey = defaultCiMedusaPublishableKey,
} = {}) => {
  if (host !== defaultCiMedusaFixtureHost) {
    throw new RangeError("The CI Medusa fixture must bind to loopback")
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError("The CI Medusa fixture port is invalid")
  }
  if (!publishableKey.trim()) {
    throw new RangeError("The CI Medusa fixture publishable key is required")
  }

  const server = http.createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("allow", "GET, HEAD")
      writeJson(request, response, 405, { code: "method_not_allowed" })
      return
    }

    const url = new URL(request.url ?? "/", `http://${host}`)
    if (url.pathname === "/live") {
      writeJson(request, response, 200, { status: "ok" })
      return
    }
    if (request.headers["x-publishable-api-key"] !== publishableKey) {
      writeJson(request, response, 401, { code: "invalid_publishable_key" })
      return
    }

    const payload = routePayload(url.pathname, url.searchParams)
    if (payload === null) {
      writeJson(request, response, 404, { code: "fixture_route_not_found" })
      return
    }
    writeJson(request, response, 200, payload)
  })

  server.headersTimeout = 5_000
  server.keepAliveTimeout = 1_000
  server.requestTimeout = 5_000
  server.maxRequestsPerSocket = 100

  return {
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(port, host, () => {
          server.off("error", reject)
          const address = server.address()
          if (!address || typeof address === "string") {
            reject(new Error("The CI Medusa fixture address is unavailable"))
            return
          }
          resolve(`http://${host}:${address.port}`)
        })
      }),
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const parsedPort = Number(
    process.env.CI_MEDUSA_FIXTURE_PORT ?? defaultCiMedusaFixturePort
  )
  const fixture = createCiMedusaFixtureServer({
    port: parsedPort,
    publishableKey:
      process.env.CI_MEDUSA_PUBLISHABLE_KEY ?? defaultCiMedusaPublishableKey,
  })
  const baseUrl = await fixture.listen()
  process.stdout.write(`CI Medusa fixture listening at ${baseUrl}\n`)

  let closing = false
  const close = () => {
    if (closing) {
      return
    }
    closing = true
    void fixture.close().then(
      () => process.exit(0),
      () => process.exit(1)
    )
  }
  process.once("SIGINT", close)
  process.once("SIGTERM", close)
}
