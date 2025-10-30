#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const BASE_URL = "https://remorseless-records-admin-staging.up.railway.app"
const EMAIL = "tyschumacher@proton.me"
const PASSWORD = "admin"
const METAL_KEYWORDS = new Set(["metal", "doom", "death", "thrash", "grind", "sludge", "gore", "core"])

const slugify = (value) =>
  value
    ? value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+/, "")
        .replace(/-+$/, "")
    : ""

const fetchJson = async (url, options = {}) => {
  const res = await fetch(url, options)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Request failed ${res.status} ${res.statusText}: ${text}`)
  }
  return res.json()
}

const login = async () => {
  const res = await fetchJson(`${BASE_URL}/auth/user/emailpass`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  return res.token
}

const fetchAllCategories = async (token) => {
  const categories = []
  let offset = 0
  const limit = 200
  while (true) {
    const data = await fetchJson(`${BASE_URL}/admin/product-categories?limit=${limit}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    categories.push(...data.product_categories)
    if (categories.length >= data.count) {
      break
    }
    offset += limit
  }
  return categories
}

const deleteAllCategories = async (token) => {
  let categories = await fetchAllCategories(token)
  while (categories.length > 0) {
    const parentSet = new Set(categories.map((c) => c.parent_category_id).filter(Boolean))
    const leaves = categories.filter((c) => !parentSet.has(c.id))
    if (!leaves.length) {
      throw new Error("Unable to resolve category deletion order")
    }
    for (const leaf of leaves) {
      await fetchJson(`${BASE_URL}/admin/product-categories/${leaf.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
    }
    categories = categories.filter((c) => !leaves.some((leaf) => leaf.id === c.id))
  }
}

const createCategoryFactory = (token) => {
  const usedHandles = new Set()
  return async ({ name, handle, parentId }) => {
    const baseHandle = handle || slugify(name) || `category-${Date.now()}`
    let finalHandle = baseHandle
    let suffix = 1
    while (usedHandles.has(finalHandle)) {
      finalHandle = `${baseHandle}-${suffix++}`
    }
    const payload = {
      name,
      handle: finalHandle,
      is_active: true,
    }
    if (parentId) {
      payload.parent_category_id = parentId
    }
    const res = await fetchJson(`${BASE_URL}/admin/product-categories`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })
    const category = res.product_category
    usedHandles.add(category.handle)
    console.log(`Created category '${category.name}' (${category.handle})`)
    return category
  }
}

const parseArtist = (productName) => {
  const name = productName?.trim() ?? ""
  if (!name) {
    return ""
  }
  let working = name
  const lastSeparator = name.lastIndexOf(" - ")
  if (lastSeparator !== -1) {
    const suffix = name.slice(lastSeparator + 3).trim().toLowerCase()
    if (/^(cd|mc|lp|cassette|vinyl|2lp|3lp|7"|tape|digital|bundle|box)/.test(suffix)) {
      working = name.slice(0, lastSeparator).trim()
    }
  }
  const firstSeparator = working.indexOf(" - ")
  if (firstSeparator === -1) {
    return working.trim()
  }
  return working.slice(0, firstSeparator).trim()
}

const extractGenres = (product) => {
  const categoryNames = Array.isArray(product?.categories)
    ? product.categories.map((category) => category?.name?.trim()).filter(Boolean)
    : []
  const nonGenreCategories = new Set(["Bundles/Deals", "Remorseless Records", "Misc.", "CDs", "Vinyl", "Cassettes"])
  const results = []
  categoryNames.forEach((name) => {
    if (nonGenreCategories.has(name)) {
      return
    }
    const lower = name.toLowerCase()
    if (lower.includes("bundle") || lower.includes("deal") || lower.includes("merch") || lower.includes("misc")) {
      return
    }
    const parts = name
      .split(/[\/,&]/)
      .map((part) => part.replace(/\s+/g, " ").trim())
      .filter(Boolean)
    parts.forEach((part) => {
      const normalized = part.replace(/metal/gi, "").trim()
      const displayName = normalized || part.trim()
      if (!displayName) {
        return
      }
      const words = part.toLowerCase().split(/[^a-z0-9]+/)
      const isMetalRelated = words.some((word) => METAL_KEYWORDS.has(word))
      results.push({ name: displayName, isMetal: isMetalRelated })
    })
  })
  const unique = new Map()
  results.forEach(({ name, isMetal }) => {
    const existing = unique.get(name) ?? { name, isMetal: false }
    existing.isMetal = existing.isMetal || isMetal
    unique.set(name, existing)
  })
  return Array.from(unique.values())
}

const loadProducts = async () => {
  const raw = await readFile(resolve("tmp", "remorseless_products.json"), "utf8")
  return JSON.parse(raw)
}

const resetCategories = async () => {
  const token = await login()
  const existing = await fetchAllCategories(token)
  if (existing.length) {
    console.log(`Deleting ${existing.length} existing categories...`)
    await deleteAllCategories(token)
  }
  const products = await loadProducts()
  const artists = new Map()
  const genres = new Map()
  products.forEach((product) => {
    const artist = parseArtist(product.name)
    if (artist) {
      artists.set(artist, slugify(artist) || `artist-${artists.size}`)
    }
    extractGenres(product).forEach(({ name, isMetal }) => {
      const key = name
      const existing = genres.get(key) ?? { slug: slugify(name) || `genre-${genres.size}`, isMetal: false }
      existing.isMetal = existing.isMetal || isMetal
      genres.set(key, existing)
    })
  })
  const createCategory = createCategoryFactory(token)
  const registerHandles = new Map()
  const register = (cat) => {
    registerHandles.set(cat.handle, cat.id)
  }

  const musicRoot = await createCategory({ name: "Music", handle: "music" })
  register(musicRoot)
  const genresRoot = await createCategory({ name: "Genres", handle: "genres", parentId: musicRoot.id })
  register(genresRoot)
  const artistsRoot = await createCategory({ name: "Artists", handle: "artists", parentId: musicRoot.id })
  register(artistsRoot)
  const bundlesRoot = await createCategory({ name: "Bundles", handle: "bundles" })
  register(bundlesRoot)
  const merchRoot = await createCategory({ name: "Merch", handle: "merch" })
  register(merchRoot)

  let metalParent = null
  const metalGenres = []
  const otherGenres = []
  Array.from(genres.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([name, info]) => {
      const entry = { name, slug: info.slug }
      if (info.isMetal) {
        metalGenres.push(entry)
      } else {
        otherGenres.push(entry)
      }
    })

  if (metalGenres.length) {
    metalParent = await createCategory({ name: "Metal", handle: "metal", parentId: genresRoot.id })
    register(metalParent)
    for (const { name, slug } of metalGenres) {
      const cat = await createCategory({ name, handle: slug, parentId: metalParent.id })
      register(cat)
    }
  }

  for (const { name, slug } of otherGenres) {
    const cat = await createCategory({ name, handle: slug, parentId: genresRoot.id })
    register(cat)
  }

  const sortedArtists = Array.from(artists.entries()).sort(([a], [b]) => a.localeCompare(b))
  for (const [name, slug] of sortedArtists) {
    const cat = await createCategory({ name, handle: slug, parentId: artistsRoot.id })
    register(cat)
  }

  return registerHandles
}

const run = async () => {
  const handles = await resetCategories()
  const map = Object.fromEntries(handles)
  const outputPath = resolve("tmp", "category-map.json")
  await writeFile(outputPath, JSON.stringify({ generated_at: new Date().toISOString(), handles: map }, null, 2), "utf8")
  console.log(`Category map written to ${outputPath}`)
}

run().catch((err) => {
  console.error("Failed to reset categories:", err)
  process.exit(1)
})
