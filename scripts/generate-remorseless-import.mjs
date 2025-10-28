#!/usr/bin/env node

import { readFile, writeFile, mkdir } from "node:fs/promises"
import crypto from "node:crypto"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = resolve(__dirname, "..")

const sourceJsonPath = resolve(projectRoot, "tmp", "remorseless_products.json")
const outputCsvPath = resolve(projectRoot, "tmp", "remorseless-products-import.csv")
const summaryOutputPath = resolve(projectRoot, "tmp", "remorseless-import-readme.md")

const csvHeaders = [
  "Product Id",
  "Product Handle",
  "Product Title",
  "Product Subtitle",
  "Product Description",
  "Product Status",
  "Product Thumbnail",
  "Product Weight",
  "Product Length",
  "Product Width",
  "Product Height",
  "Product HS Code",
  "Product Origin Country",
  "Product MID Code",
  "Product Material",
  "Product Collection Title",
  "Product Collection Handle",
  "Product Type",
  "Product Tags",
  "Product Discountable",
  "Product External Id",
  "Product Profile Name",
  "Product Profile Type",
  "Variant Id",
  "Variant Title",
  "Variant SKU",
  "Variant Barcode",
  "Variant Inventory Quantity",
  "Variant Allow Backorder",
  "Variant Manage Inventory",
  "Variant Weight",
  "Variant Length",
  "Variant Width",
  "Variant Height",
  "Variant HS Code",
  "Variant Origin Country",
  "Variant MID Code",
  "Variant Material",
  "Price EUR",
  "Price USD",
  "Option 1 Name",
  "Option 1 Value",
  "Image 1 Url",
  "Image 2 Url",
]

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

const escapeCsv = (value) => {
  if (value === null || value === undefined) {
    return ""
  }

  const stringValue = String(value)
  if (stringValue.length === 0) {
    return ""
  }

  const sanitized = stringValue.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const normalized = sanitized.replace(/\n/g, "\\n")
  const needsQuoting =
    normalized.includes(";") ||
    normalized.includes('"') ||
    normalized.includes("\\")
  const quoted = normalized.replace(/"/g, '""')
  return needsQuoting ? `"${quoted}"` : quoted
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

const incrementCount = (map, key) => {
  if (!key) {
    return
  }
  const previous = map.get(key) ?? 0
  map.set(key, previous + 1)
}

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

const buildCsvRows = (products, summary) => {
  const rows = []

  const getRandomInt = (seed) => {
    const hash = crypto.createHash("sha256").update(seed).digest("hex")
    const numeric = parseInt(hash.slice(0, 12), 16)
    return numeric % 251
  }

  products.forEach((product, index) => {
    const { artist, album } = parseArtistAndAlbum(product.name)
    const handleBase = `${artist} ${album}`.trim()
    const productHandle = slugify(handleBase)
    const collectionTitle = artist || "Various Artists"
    const collectionHandle = slugify(collectionTitle) || "various-artists"
    const description = (product.description ?? "").trim()
    const firstImage = product.images?.[0]?.url ?? ""
    const secondImage = product.images?.[1]?.url ?? ""

    const categoryNames = Array.isArray(product.categories)
      ? product.categories
          .map((category) => category?.name)
          .filter((name) => typeof name === "string" && name.trim().length > 0)
      : []

    const tagsSet = new Set()
    const addTag = (tag) => {
      if (!tag) {
        return
      }
      const trimmed = tag.trim()
      if (!trimmed || !trimmed.includes(":")) {
        return
      }
      if (!tagsSet.has(trimmed)) {
        tagsSet.add(trimmed)
        incrementCount(summary.tags, trimmed)
      }
    }

    const productType = classifyProductType(product)

    summary.totalProducts += 1
    const existingCollection = summary.collections.get(collectionTitle) ?? {
      title: collectionTitle,
      handle: collectionHandle,
      count: 0,
    }
    existingCollection.count += 1
    existingCollection.handle = collectionHandle
    summary.collections.set(collectionTitle, existingCollection)

    addTag(`type:${productType}`)
    incrementCount(summary.productTypes, productType)

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
      if (!summary.collections.has("Staff Picks")) {
        summary.collections.set("Staff Picks", { title: "Staff Picks", handle: "staff-picks", count: 0 })
      }
      const staffCollection = summary.collections.get("Staff Picks")
      staffCollection.count += 1
      summary.collections.set("Staff Picks", staffCollection)
    }

    if (index % 25 === 0) {
      addTag("flag:featured")
      if (!summary.collections.has("Featured Releases")) {
        summary.collections.set("Featured Releases", { title: "Featured Releases", handle: "featured-releases", count: 0 })
      }
      const featuredCollection = summary.collections.get("Featured Releases")
      featuredCollection.count += 1
      summary.collections.set("Featured Releases", featuredCollection)
    }

    const variants =
      Array.isArray(product.options) && product.options.length
        ? product.options
        : [
            {
              name: "Standard",
              price: product.price ?? 0,
            },
          ]

    variants.forEach((variant, variantIndex) => {
      const variantName = variant?.name?.trim() || "Standard"
      const variantPrice = Number.isFinite(variant?.price)
        ? Number(variant.price)
        : Number(product.price) || 0

      const randomSeed = `${product.id ?? product.name ?? index}-${variantName}-${variantIndex}`
      const rawStock = getRandomInt(randomSeed)
      const randomStock = rawStock < 5 ? 0 : rawStock
      if (randomStock === 0) {
        summary.inventory.zero += 1
      } else if (randomStock < 25) {
        summary.inventory.low += 1
      } else {
        summary.inventory.inStock += 1
      }

      const priceUsd =
        Number.isFinite(variantPrice) && variantPrice > 0
          ? Math.round(variantPrice * 100)
          : ""

      const variantSkuBase = `${handleBase} ${variantName}`.trim()
      const variantSku = variantSkuBase
        ? slugify(variantSkuBase).toUpperCase()
        : ""

      const row = [
        "", // Product Id
        productHandle,
        album || product.name || "Untitled Release",
        artist,
        description,
        "published",
        firstImage,
        "", // Product Weight
        "", // Product Length
        "", // Product Width
        "", // Product Height
        "", // Product HS Code
        "", // Product Origin Country
        "", // Product MID Code
        "", // Product Material
        collectionTitle,
        collectionHandle,
        productType,
        Array.from(tagsSet).join("|"),
        "true",
        product.id ?? "",
        "default",
        "default",
        "", // Variant Id
        variantName,
        variantSku,
        "", // Variant Barcode
        String(randomStock), // Variant Inventory Quantity
        randomStock === 0 ? "false" : "true", // Variant Allow Backorder
        "true", // Variant Manage Inventory
        "", // Variant Weight
        "", // Variant Length
        "", // Variant Width
        "", // Variant Height
        "", // Variant HS Code
        "", // Variant Origin Country
        "", // Variant MID Code
        "", // Variant Material
        "", // Price EUR
        priceUsd,
        "Format",
        variantName,
        firstImage,
        secondImage,
      ]

      rows.push(row.map(escapeCsv).join(";"))
    })
  })

  return rows
}

const buildSummary = (summary) => {
  const collectionEntries = Array.from(summary.collections.entries())
    .map(([title, data]) => ({
      title,
      handle: data.handle,
      count: data.count,
    }))
    .sort((a, b) => a.title.localeCompare(b.title))

  const tagEntries = Array.from(summary.tags.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag))

  const preferredTypeOrder = ["music_release", "bundle", "merch"]
  const productTypeEntries = preferredTypeOrder
    .filter((type) => summary.productTypes.has(type))
    .map((type) => ({ type, count: summary.productTypes.get(type) }))
    .concat(
      Array.from(summary.productTypes.entries())
        .filter(([type]) => !preferredTypeOrder.includes(type))
        .map(([type, count]) => ({ type, count })),
    )

  const summaryLines = [
    "# Remorseless Catalog Import – Collections & Tags",
    "",
    `Generated from ${summary.totalProducts} products (${new Date().toISOString()})`,
    "",
    "## Collections (create before import)",
    "",
  ]

  if (collectionEntries.length === 0) {
    summaryLines.push("- _No collections detected_")
  } else {
    collectionEntries.forEach(({ title, handle, count }) => {
      summaryLines.push(`- **${title}** — handle \`${handle}\` (${count} products)`)
    })
  }

  summaryLines.push("", "## Product types", "")
  if (productTypeEntries.length === 0) {
    summaryLines.push("- _No product types detected_")
  } else {
    productTypeEntries.forEach(({ type, count }) => {
      summaryLines.push(`- \`${type}\`: ${count}`)
    })
  }

  summaryLines.push("", "## Inventory distribution (variants)", "")
  summaryLines.push(`- Out of stock (0): ${summary.inventory.zero}`)
  summaryLines.push(`- Low stock (<25): ${summary.inventory.low}`)
  summaryLines.push(`- In stock (≥25): ${summary.inventory.inStock}`)

  summaryLines.push("", "## Tags (Medusa product tags)", "")
  if (tagEntries.length === 0) {
    summaryLines.push("- _No tags detected_")
  } else {
    tagEntries.forEach(({ tag, count }) => {
      summaryLines.push(`- \`${tag}\` — ${count}`)
    })
  }

  summaryLines.push(
    "",
    "## Notes",
    "",
    "- Collections are derived from artist names; create each collection before running the CSV import.",
    "- Tags originate from the Big Cartel catalog categories and power storefront filtering.",
    "- Product types follow this contract:",
    "  - `music_release` – standard releases (default).",
    "  - `bundle` – multi-product bundles or deals.",
    "  - `merch` – non-music items (zines, buttons, apparel, etc.).",
  )

  return `${summaryLines.join("\n")}\n`
}

const main = async () => {
  const raw = await readFile(sourceJsonPath, "utf8")
  const products = JSON.parse(raw)

  const summary = {
    totalProducts: 0,
    collections: new Map(),
    tags: new Map(),
    productTypes: new Map(),
    inventory: {
      zero: 0,
      low: 0,
      inStock: 0,
    },
  }

  const rows = buildCsvRows(products, summary)
  const output = [csvHeaders.join(";"), ...rows].join("\n")

  await mkdir(dirname(outputCsvPath), { recursive: true })
  await writeFile(outputCsvPath, `${output}\n`, "utf8")

  const summaryContent = buildSummary(summary)
  await mkdir(dirname(summaryOutputPath), { recursive: true })
  await writeFile(summaryOutputPath, summaryContent, "utf8")

  console.log(
    `Generated ${rows.length} rows from ${products.length} source products -> ${outputCsvPath}`,
  )
  console.log(`Summary written to ${summaryOutputPath}`)
}

main().catch((error) => {
  console.error("Failed to generate CSV:", error)
  process.exit(1)
})
