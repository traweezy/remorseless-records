#!/usr/bin/env node

import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = resolve(__dirname, "..")

const sourceJsonPath = resolve(projectRoot, "tmp", "remorseless_products.json")

const slugify = (value) => {
  if (!value) {
    return ""
  }

  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}

const parseArtistAndAlbum = (productName) => {
  const name = productName?.trim() ?? ""
  if (!name) {
    return { artist: "", album: "" }
  }

  let working = name
  const lastSeparator = name.lastIndexOf(" - ")

  if (lastSeparator !== -1) {
    const suffix = name.slice(lastSeparator + 3).trim()
    if (/^(cd|mc|lp|cassette|vinyl|2lp|3lp|7\"|tape|digital|bundle|box)/i.test(suffix)) {
      working = name.slice(0, lastSeparator).trim()
    }
  }

  const firstSeparator = working.indexOf(" - ")
  if (firstSeparator === -1) {
    return { artist: working, album: working }
  }

  const artist = working.slice(0, firstSeparator).trim()
  const album = working.slice(firstSeparator + 3).trim()

  return {
    artist: artist || working,
    album: album || working,
  }
}

const formatCategoryMap = new Map([
  ["cds", "cd"],
  ["vinyl", "vinyl"],
  ["cassettes", "cassette"],
])

const nonGenreCategories = new Set([
  "bundles/deals",
  "remorseless records",
  "misc.",
])

const classifyProductType = (product) => {
  const categories = Array.isArray(product?.categories)
    ? product.categories
        .map((category) => category?.name?.toLowerCase()?.trim())
        .filter(Boolean)
    : []

  const name = product?.name?.toLowerCase() ?? ""

  if (categories.some((category) => category.includes("bundle"))) {
    return "bundle"
  }
  if (/\bbundle\b|\bdeal\b|\bbox set\b|\bpack\b/.test(name)) {
    return "bundle"
  }

  const merchCategoryKeywords = ["misc", "merch"]
  const merchNameKeywords = ["shirt", "hoodie", "button", "pin", "zine", "issue", "sticker", "logo", "patch"]

  if (categories.some((category) => merchCategoryKeywords.some((keyword) => category.includes(keyword)))) {
    return "merch"
  }
  if (merchNameKeywords.some((keyword) => name.includes(keyword))) {
    return "merch"
  }

  return "music_release"
}

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options)
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Request failed ${response.status} ${response.statusText} -> ${body}`)
  }
  return response.json()
}

const login = async (baseUrl, email, password) => {
  const url = `${baseUrl}/auth/user/emailpass`
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Login failed ${response.status} ${response.statusText} -> ${body}`)
  }

  const json = await response.json()
  const token = json?.token || json?.access_token || json?.jwt
  if (!token) {
    throw new Error(`Login succeeded but no token found in response: ${JSON.stringify(json)}`)
  }
  return token
}

const fetchAll = async (baseUrl, token, resource, resultKey) => {
  const results = []
  const limit = 100
  let offset = 0

  while (true) {
    const url = new URL(`${baseUrl}${resource}`)
    url.searchParams.set("limit", String(limit))
    url.searchParams.set("offset", String(offset))

    const json = await fetchJson(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })
    const batch = json?.[resultKey] ?? []
    results.push(...batch)

    const count = json?.count ?? 0
    offset += batch.length
    if (offset >= count || batch.length === 0) {
      break
    }
  }

  return results
}

const createCollection = async (baseUrl, token, payload) => {
  const response = await fetch(`${baseUrl}/admin/collections`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Failed to create collection ${payload.title} -> ${response.status} ${response.statusText}: ${body}`,
    )
  }
}

const createTag = async (baseUrl, token, value) => {
  const response = await fetch(`${baseUrl}/admin/product-tags`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ value }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Failed to create tag ${value} -> ${response.status} ${response.statusText}: ${body}`,
    )
  }
}

const main = async () => {
  const raw = await readFile(sourceJsonPath, "utf8")
  const products = JSON.parse(raw)

  const collections = new Map()
  const tags = new Set()

  products.forEach((product, index) => {
    const { artist } = parseArtistAndAlbum(product.name)
    const title = artist || "Various Artists"
    const handle = slugify(title) || "various-artists"

    if (!collections.has(handle)) {
      collections.set(handle, { title, handle })
    }

    const categoryNames = Array.isArray(product.categories)
      ? product.categories
          .map((category) => category?.name)
          .filter((name) => typeof name === "string" && name.trim().length > 0)
      : []

    const tagSet = new Set()
    const addTag = (tag) => {
      if (!tag) {
        return
      }
      const trimmed = tag.trim()
      if (!trimmed || !trimmed.includes(":")) {
        return
      }
      if (!tagSet.has(trimmed)) {
        tagSet.add(trimmed)
        tags.add(trimmed)
      }
    }

    const productType = classifyProductType(product)
    addTag(`type:${productType}`)

    categoryNames.forEach((category) => {
      const lower = category.toLowerCase()
      if (formatCategoryMap.has(lower)) {
        addTag(`format:${formatCategoryMap.get(lower)}`)
        return
      }

      if (nonGenreCategories.has(lower)) {
        return
      }

      const parts = category
        .split(/[\/,&]/)
        .map((part) => part.replace(/\s+/g, " ").trim())
        .filter(Boolean)

      if (parts.length === 0) {
        return
      }

      parts.forEach((part) => {
        addTag(`genre:${slugify(part)}`)
      })
    })
    if (index % 18 === 0) {
      addTag("flag:staff-pick")
      if (!collections.has("staff-picks")) {
        collections.set("staff-picks", { title: "Staff Picks", handle: "staff-picks" })
      }
    }

    if (index % 25 === 0) {
      addTag("flag:featured")
      if (!collections.has("featured-releases")) {
        collections.set("featured-releases", { title: "Featured Releases", handle: "featured-releases" })
      }
    }
  })

  const baseUrl =
    (process.env.BACKEND_PUBLIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN_VALUE || "").replace(
      /\/$/,
      "",
    ) || "http://localhost:9000"
  const adminEmail = process.env.MEDUSA_ADMIN_EMAIL
  const adminPassword = process.env.MEDUSA_ADMIN_PASSWORD

  if (!adminEmail || !adminPassword) {
    throw new Error("MEDUSA_ADMIN_EMAIL and MEDUSA_ADMIN_PASSWORD must be set.")
  }

  console.log(`[setup] Authenticating against ${baseUrl}`)
  const token = await login(baseUrl, adminEmail, adminPassword)
  console.log(`[setup] Authenticated. Fetching existing collections & tags...`)

  const existingCollections = await fetchAll(
    baseUrl,
    token,
    "/admin/collections",
    "collections",
  )
  const existingCollectionHandles = new Set(
    existingCollections.map((collection) => collection.handle),
  )

  const existingTags = await fetchAll(baseUrl, token, "/admin/product-tags", "product_tags")
  const existingTagValues = new Set(existingTags.map((tag) => tag.value))

  let createdCollections = 0
  for (const { title, handle } of collections.values()) {
    if (existingCollectionHandles.has(handle)) {
      continue
    }
    await createCollection(baseUrl, token, { title, handle })
    createdCollections += 1
    console.log(`[setup] Created collection "${title}" (${handle})`)
  }

  let createdTags = 0
  for (const value of tags) {
    if (existingTagValues.has(value)) {
      continue
    }
    await createTag(baseUrl, token, value)
    createdTags += 1
    console.log(`[setup] Created tag "${value}"`)
  }

  console.log(
    `[setup] Complete. Collections created: ${createdCollections}. Tags created: ${createdTags}.`,
  )
}

main().catch((error) => {
  console.error("[setup] Failed:", error)
  process.exit(1)
})
