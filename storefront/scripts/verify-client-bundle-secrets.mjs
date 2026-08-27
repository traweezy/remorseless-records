import fs from "node:fs"
import path from "node:path"
import { parseEnv } from "node:util"

const STATIC_DIRECTORY = path.resolve(".next/static")
const ENVIRONMENT_FILES = [
  ".env",
  ".env.production",
  ".env.local",
  ".env.production.local",
]
const SERVER_ONLY_NAMES = [
  "CART_COOKIE_SECRET",
  "CART_COOKIE_SECRET_PREVIOUS",
  "CHECKOUT_BFF_SECRET",
  "CHECKOUT_RECEIPT_SECRET",
  "CHECKOUT_RECEIPT_SECRET_PREVIOUS",
  "MEILISEARCH_API_KEY",
  "MEILISEARCH_HOST",
  "MEILISEARCH_SEARCH_KEY",
  "PUBLIC_FORM_BFF_SECRET",
  "REDIS_URL",
]
const FORBIDDEN_PUBLIC_SEARCH_NAMES = [
  "NEXT_PUBLIC_MEILI_HOST",
  "NEXT_PUBLIC_MEILI_SEARCH_KEY",
]

const environment = {}
for (const file of ENVIRONMENT_FILES) {
  if (fs.existsSync(file)) {
    Object.assign(environment, parseEnv(fs.readFileSync(file, "utf8")))
  }
}
Object.assign(environment, process.env)

if (!fs.statSync(STATIC_DIRECTORY, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error("Storefront client bundle is missing; run the build first")
}

const files = fs
  .readdirSync(STATIC_DIRECTORY, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.join(entry.parentPath, entry.name))

const findings = []
for (const file of files) {
  const content = fs.readFileSync(file)
  for (const name of FORBIDDEN_PUBLIC_SEARCH_NAMES) {
    if (content.includes(name)) {
      findings.push({ file: path.relative(STATIC_DIRECTORY, file), name })
    }
  }
  for (const name of SERVER_ONLY_NAMES) {
    const value = environment[name]?.trim()
    if (value && Buffer.byteLength(value, "utf8") >= 8 && content.includes(value)) {
      findings.push({ file: path.relative(STATIC_DIRECTORY, file), name })
    }
  }
}

if (findings.length) {
  const summary = findings
    .map(({ file, name }) => `${name} in ${file}`)
    .join(", ")
  throw new Error(`Server-only configuration leaked into client assets: ${summary}`)
}

console.log(
  `Client bundle verified: ${files.length} static assets contain no server-only secret or public Meilisearch input.`,
)
