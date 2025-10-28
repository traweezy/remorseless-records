#!/usr/bin/env node

import { readFile, writeFile, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = resolve(__dirname, "..")

const sourceJsonPath = resolve(projectRoot, "tmp", "remorseless_products.json")
const outputCsvPath = resolve(
  projectRoot,
  "storefront",
  "remorseless-products-import.csv",
)

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

const buildCsvRows = (products) => {
  const rows = []

  for (const product of products) {
    const { artist, album } = parseArtistAndAlbum(product.name)
    const handleBase = `${artist} ${album}`.trim()
    const productHandle = slugify(handleBase)
    const collectionTitle = artist || "Various Artists"
    const collectionHandle = slugify(collectionTitle) || "various-artists"
    const description = (product.description ?? "").trim()
    const firstImage = product.images?.[0]?.url ?? ""
    const secondImage = product.images?.[1]?.url ?? ""

    const tags =
      Array.isArray(product.categories) && product.categories.length
        ? product.categories.map((category) => category.name).join("|")
        : ""

    const variants =
      Array.isArray(product.options) && product.options.length
        ? product.options
        : [
            {
              name: "Standard",
              price: product.price ?? 0,
            },
          ]

    for (const variant of variants) {
      const variantName = variant?.name?.trim() || "Standard"
      const variantPrice = Number.isFinite(variant?.price)
        ? Number(variant.price)
        : Number(product.price) || 0

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
        "Album",
        tags,
        "true",
        product.id ?? "",
        "default",
        "default",
        "", // Variant Id
        variantName,
        variantSku,
        "", // Variant Barcode
        "", // Variant Inventory Quantity
        "true", // Variant Allow Backorder
        "false", // Variant Manage Inventory
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
    }
  }

  return rows
}

const main = async () => {
  const raw = await readFile(sourceJsonPath, "utf8")
  const products = JSON.parse(raw)
  const rows = buildCsvRows(products)
  const output = [csvHeaders.join(";"), ...rows].join("\n")

  await mkdir(dirname(outputCsvPath), { recursive: true })
  await writeFile(outputCsvPath, `${output}\n`, "utf8")

  console.log(
    `Generated ${rows.length} rows from ${products.length} products -> ${outputCsvPath}`,
  )
}

main().catch((error) => {
  console.error("Failed to generate CSV:", error)
  process.exit(1)
})
