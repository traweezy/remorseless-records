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
const categoryMapPath = resolve(projectRoot, "tmp", "category-map.json")

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
  "Product Category 1",
  "Product Category 2",
  "Product Category 3",
  "Product Category 4",
  "Product Category 5",
  "Product Category 6",
  "Product Category 7",
  "Product Category 8",
  "Product Category 9",
  "Product Category 10",
  "Product Sales Channel Id",
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

const defaultSalesChannelId =
  process.env.MEDUSA_DEFAULT_SALES_CHANNEL_ID ??
  process.env.DEFAULT_SALES_CHANNEL_ID ??
  ""

if (!defaultSalesChannelId) {
  throw new Error(
    "MEDUSA_DEFAULT_SALES_CHANNEL_ID (or DEFAULT_SALES_CHANNEL_ID) must be set to the default sales channel ID before running this script.",
  )
}

const METAL_GENRE_KEYWORDS = ["metal", "doom", "death", "thrash", "grind", "sludge", "gore", "core"]

const categoryMapRaw = await readFile(categoryMapPath, "utf8").catch(() => {
  throw new Error(
    `Category map file not found at ${categoryMapPath}. Run the category export script to generate it.`,
  )
})

const categoryMap = JSON.parse(categoryMapRaw)
const handleEntries = categoryMap.by_handle
  ? Object.entries(categoryMap.by_handle).map(([handle, info]) => [handle, info.id])
  : Object.entries(categoryMap.handles ?? {}).map(([handle, id]) => [handle, id])

const categoryHandleToId = new Map(handleEntries)
const CATEGORY_COLUMN_COUNT = 10

const hasHandle = (handle) => categoryHandleToId.has(handle)

const normalizeGenreName = (raw) => {
  const cleaned = raw.replace(/metal/gi, "").trim()
  return cleaned || raw.trim()
}

const isMetalGenre = (raw) => {
  const words = raw.toLowerCase().split(/[^a-z0-9]+/)
  return METAL_GENRE_KEYWORDS.some((keyword) => words.includes(keyword))
}

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
    const productType = classifyProductType(product)
    const categoryHandles = new Set()

    if ((productType === "music_release" || productType === "bundle") && hasHandle("music")) {
      categoryHandles.add("music")
    }
    if (productType === "bundle" && hasHandle("bundles")) {
      categoryHandles.add("bundles")
    }
    if (productType === "merch" && hasHandle("merch")) {
      categoryHandles.add("merch")
    }

    const makeHandle = () => {
      const albumSlug = slugify(album)
      const artistSlug = slugify(artist)
      const nameSlug = slugify(product.name)

      if (productType === "music_release" || productType === "bundle") {
        const segments = [artistSlug, albumSlug || nameSlug].filter(Boolean)
        return segments.length ? segments.join("-") : nameSlug
      }

      return nameSlug || albumSlug || artistSlug
    }

    const productHandle = makeHandle() || slugify(`product-${index + 1}`)
    const artistHandle = slugify(artist)
    const description = (product.description ?? "").trim()
    const firstImage = product.images?.[0]?.url ?? ""
    const secondImage = product.images?.[1]?.url ?? ""

    if (artistHandle && hasHandle(artistHandle)) {
      categoryHandles.add(artistHandle)
    }

    const categoryNames = Array.isArray(product.categories)
      ? product.categories
          .map((category) => category?.name)
          .filter((name) => typeof name === "string" && name.trim().length > 0)
      : []

    summary.totalProducts += 1

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
        const normalizedGenre = normalizeGenreName(part)
        const genreHandle = slugify(normalizedGenre)
        if (genreHandle && hasHandle(genreHandle)) {
          categoryHandles.add(genreHandle)
        }
        if (isMetalGenre(part) && hasHandle("metal")) {
          categoryHandles.add("metal")
        }
      })
    })

    const isPreorder = /pre[- ]?order/.test(description.toLowerCase())
    if (isPreorder) {
      summary.preorders += 1
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

    const normalizeVariantName = (variantName) => {
      const trimmed = (variantName ?? "").trim()
      if (!trimmed) {
        return "Standard"
      }

      const lower = trimmed.toLowerCase()
      const baseFormat = (() => {
        if (/\bvinyl\b/.test(lower) || /\blp\b/.test(lower) || /\b12"/.test(lower) || /\b7"/.test(lower)) {
          return "LP"
        }
        if (/\bcd\b/.test(lower)) {
          return "CD"
        }
        if (/\bcassette\b/.test(lower) || /\btape\b/.test(lower) || /\bmc\b/.test(lower)) {
          return "Cassette"
        }
        return null
      })()

      if (!baseFormat) {
        return trimmed
      }

      const comparableValues = [
        (product.name ?? "").toLowerCase(),
        artist.toLowerCase(),
        album.toLowerCase(),
      ].filter(Boolean)

      const redundant =
        comparableValues.some((value) => lower.includes(value)) ||
        trimmed
          .split(" - ")
          .slice(-1)
          .some((segment) => {
            const part = segment.toLowerCase()
            if (baseFormat === "LP") {
              return /\blp\b/.test(part) || /\bvinyl\b/.test(part)
            }
            if (baseFormat === "CD") {
              return /\bcd\b/.test(part)
            }
            if (baseFormat === "Cassette") {
              return /\bcassette\b/.test(part) || /\btape\b/.test(part) || /\bmc\b/.test(part)
            }
            return false
          })

      return redundant ? baseFormat : trimmed
    }

    variants.forEach((variant, variantIndex) => {
      const originalVariantName = variant?.name?.trim() || "Standard"
      const normalizedVariantName = normalizeVariantName(originalVariantName)
      const variantPrice = Number.isFinite(variant?.price)
        ? Number(variant.price)
        : Number(product.price) || 0

      const randomSeed = `${product.id ?? product.name ?? index}-${normalizedVariantName}-${variantIndex}`
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

      const variantSkuBase = `${productHandle} ${normalizedVariantName}`.trim()
      const variantSku = variantSkuBase
        ? slugify(variantSkuBase).toUpperCase()
        : ""

      const categoryIds = Array.from(categoryHandles).map((handle) => {
        const id = categoryHandleToId.get(handle)
        if (!id) {
          throw new Error(
            `Missing category mapping for handle '${handle}' while processing product '${product.name}'`,
          )
        }
        return id
      })

      if (categoryIds.length > CATEGORY_COLUMN_COUNT) {
        throw new Error(
          `Product '${product.name}' is assigned to ${categoryIds.length} categories which exceeds the supported limit (${CATEGORY_COLUMN_COUNT}).`,
        )
      }

      const categoryCells = [
        ...categoryIds,
        ...Array(CATEGORY_COLUMN_COUNT - categoryIds.length).fill(""),
      ]

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
        "",
        "",
        productType,
        "",
        ...categoryCells,
        defaultSalesChannelId,
        "true",
        product.id ?? "",
        "default",
        "default",
        "", // Variant Id
        normalizedVariantName,
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
        normalizedVariantName,
        firstImage,
        secondImage,
      ]

      rows.push(row.map(escapeCsv).join(";"))
    })
  })

  return rows
}

const buildSummary = (summary) => {
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
    "# Remorseless Catalog Import – Category Snapshot",
    "",
    `Generated from ${summary.totalProducts} products (${new Date().toISOString()})`,
    "",
    "## Product types",
    "",
  ]

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

  summaryLines.push("", `Preorders detected: ${summary.preorders}`, "")

  summaryLines.push(
    "",
    "## Notes",
    "",
    "- Category IDs are populated for Music, Bundles/Merch where relevant, artist buckets, genres, and the Metal parent node.",
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
    productTypes: new Map(),
    preorders: 0,
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
