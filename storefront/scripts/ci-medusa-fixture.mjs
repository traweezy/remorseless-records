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
      releaseDate: "2026-08-31",
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
    case "/store/catalog/shelves":
      return fixtureShelves
    case "/store/collections":
      return { collections: [], count: 0, offset: 0, limit: 1 }
    case "/store/discography":
      return fixtureDiscography
    case "/store/news":
      return {
        entries: [],
        count: 0,
        offset: Number(searchParams.get("offset") ?? 0),
        limit: Number(searchParams.get("limit") ?? 12),
      }
    case "/store/products": {
      const requestedHandle = searchParams.get("handle")
      const products =
        requestedHandle && requestedHandle !== fixtureProduct.handle
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
