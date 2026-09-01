import { readdirSync, readFileSync } from "node:fs"
import { extname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const sourceRoots = [
  join(root, "backend", "src"),
  join(root, "storefront", "src"),
]
const productionExtensions = new Set([".ts", ".tsx"])

const collectProductionFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return collectProductionFiles(path)
    }
    if (
      !entry.isFile() ||
      !productionExtensions.has(extname(entry.name)) ||
      /\.(?:test|spec)\.tsx?$/u.test(entry.name)
    ) {
      return []
    }
    return [path]
  })

const forbiddenPatterns = [
  {
    label: "asserted Response.json payload",
    pattern: /(?:await\s+)?response\.json\(\)\s*\)?\s+as\s/u,
  },
  {
    label: "asserted JSON.parse payload",
    pattern: /JSON\.parse\([^;]+?\)\s+as\s+(?:unknown|any)\b/su,
  },
  {
    label: "double assertion",
    pattern: /\bas\s+unknown\s+as\b/u,
  },
  {
    label: "explicit any assertion",
    pattern: /\bas\s+any\b/u,
  },
  {
    label: "explicit any annotation",
    pattern: /:\s*any\b/u,
  },
  {
    label: "direct Response.json decoder argument",
    pattern:
      /(?:safeParse|\.parse|asUnknownRecord|parse[A-Z][A-Za-z]*)\(\s*await\s+response\.json\(\)/u,
  },
  {
    label: "direct JSON.parse decoder argument",
    pattern:
      /(?:safeParse|\.parse|asUnknownRecord|read[A-Z][A-Za-z]*)\(\s*JSON\.parse\(/u,
  },
  {
    label: "unbounded parsed response return",
    pattern: /return\s+(?:await\s+response\.json\(\)|JSON\.parse\([^;]+?\))/su,
  },
]

const requiredContracts = new Map([
  [
    "storefront/src/lib/data/news.ts",
    ["parseNewsListResponse", "parseNewsEntryResponse"],
  ],
  ["storefront/src/components/news/news-feed.tsx", ["parseNewsListResponse"]],
  [
    "storefront/src/lib/data/discography.ts",
    ["discographyPageSchema.parse", "existingIds"],
  ],
  [
    "storefront/src/lib/data/bundles.ts",
    ["bundleCompositionResponseSchema.parse"],
  ],
  [
    "storefront/src/lib/cart/bundle-client.ts",
    ["bundleCompositionResponseSchema.safeParse"],
  ],
  ["storefront/src/lib/data/products.ts", ["readStoreProductListResponse"]],
  [
    "storefront/src/lib/products/response-contract.ts",
    ["readStoreProductListResponse", "readStoreProductDetailResponse"],
  ],
  ["storefront/src/lib/query/products.ts", ["readStoreProductDetailResponse"]],
  [
    "storefront/src/components/contact/contact-form.tsx",
    ["readPublicErrorMessage"],
  ],
])

const failures = []
const files = sourceRoots.flatMap(collectProductionFiles)
for (const path of files) {
  const source = readFileSync(path, "utf8")
  for (const { label, pattern } of forbiddenPatterns) {
    if (pattern.test(source)) {
      failures.push(
        `${relative(root, path)} contains forbidden boundary: ${label}`
      )
    }
  }
}

for (const [path, tokens] of requiredContracts) {
  const source = readFileSync(join(root, path), "utf8")
  for (const token of tokens) {
    if (!source.includes(token)) {
      failures.push(`${path} must retain ${token}`)
    }
  }
}

if (failures.length > 0) {
  throw new Error(
    `Storefront response boundary verification failed:\n- ${failures.join("\n- ")}`
  )
}

console.info(
  `Storefront response boundary verified across ${files.length} production TypeScript files.`
)
