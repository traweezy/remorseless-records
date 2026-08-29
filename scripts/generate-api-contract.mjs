import { readdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
export const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..")
export const GENERATED_CONTRACT_PATH = path.join(
  REPOSITORY_ROOT,
  "docs/openapi/custom-endpoints.generated.json"
)

const HTTP_METHODS = [
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
]

const ROUTE_ROOTS = [
  {
    directory: "backend/src/api",
    service: "backend",
  },
  {
    directory: "storefront/src/app",
    service: "storefront",
  },
]

const HEALTH_PATHS = new Set([
  "/api/health",
  "/api/healthcheck",
  "/health/scheduler",
  "/live",
  "/ready",
])

const STOREFRONT_PROVIDER_PATHS = [
  /^\/api\/cart(?:\/|$)/u,
  /^\/api\/catalog(?:\/|$)/u,
  /^\/api\/checkout(?:\/|$)/u,
  /^\/api\/contact$/u,
  /^\/api\/news$/u,
  /^\/api\/privacy-request$/u,
  /^\/api\/products(?:\/|$)/u,
  /^\/api\/search(?:\/|$)/u,
]

const normalizeRouteSegment = (segment) => {
  if (/^\(.+\)$/u.test(segment)) {
    return null
  }

  const optionalCatchAll = segment.match(/^\[\[\.\.\.(.+)\]\]$/u)
  if (optionalCatchAll) {
    return `{${optionalCatchAll[1]}}`
  }

  const catchAll = segment.match(/^\[\.\.\.(.+)\]$/u)
  if (catchAll) {
    return `{${catchAll[1]}}`
  }

  const dynamic = segment.match(/^\[(.+)\]$/u)
  return dynamic ? `{${dynamic[1]}}` : segment
}

export const routePathFromFile = (routeRoot, filename) => {
  const relative = path.relative(routeRoot, filename)
  const segments = path
    .dirname(relative)
    .split(path.sep)
    .map(normalizeRouteSegment)
    .filter((segment) => segment !== null && segment !== ".")

  return `/${segments.join("/")}`
}

export const extractRouteMethods = (source) => {
  const methods = new Set()
  const methodAlternation = HTTP_METHODS.join("|")
  const declarationPattern = new RegExp(
    `export\\s+(?:async\\s+)?(?:const|function)\\s+(${methodAlternation})\\b`,
    "gu"
  )
  const reexportPattern = /export\s*\{([^}]+)\}/gu

  for (const match of source.matchAll(declarationPattern)) {
    methods.add(match[1])
  }

  for (const match of source.matchAll(reexportPattern)) {
    const exports = match[1]
      .split(",")
      .map((entry) => entry.trim().split(/\s+as\s+/u).at(-1))
    exports.forEach((name) => {
      if (HTTP_METHODS.includes(name)) {
        methods.add(name)
      }
    })
  }

  return [...methods].sort(
    (left, right) => HTTP_METHODS.indexOf(left) - HTTP_METHODS.indexOf(right)
  )
}

const listRouteFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        return listRouteFiles(entryPath)
      }
      return entry.isFile() && entry.name === "route.ts" ? [entryPath] : []
    })
  )
  return files.flat().sort()
}

const errorEnvelopeFor = ({ routePath, service, source }) => {
  if (HEALTH_PATHS.has(routePath)) {
    return "health-json"
  }
  if (service === "storefront" || source.includes("sendApiProblem")) {
    return "api-problem"
  }
  return "native-medusa-error"
}

const providerBoundaryFor = ({ routePath, service }) =>
  service === "storefront" &&
  STOREFRONT_PROVIDER_PATHS.some((pattern) => pattern.test(routePath))
    ? "bounded"
    : "not-applicable"

export const inventoryRoutes = async (repositoryRoot = REPOSITORY_ROOT) => {
  const routeGroups = await Promise.all(
    ROUTE_ROOTS.map(async ({ directory, service }) => {
      const absoluteRoot = path.join(repositoryRoot, directory)
      const files = await listRouteFiles(absoluteRoot)
      return Promise.all(
        files.map(async (filename) => {
          const source = await readFile(filename, "utf8")
          const methods = extractRouteMethods(source)
          if (!methods.length) {
            throw new Error(`No HTTP method export found in ${filename}`)
          }

          const routePath = routePathFromFile(absoluteRoot, filename)
          const sourcePath = path.relative(repositoryRoot, filename)
          return {
            errorEnvelope: errorEnvelopeFor({ routePath, service, source }),
            methods,
            providerBoundary: providerBoundaryFor({ routePath, service }),
            routePath,
            service,
            sourcePath,
          }
        })
      )
    })
  )

  return routeGroups.flat().sort((left, right) =>
    `${left.routePath}:${left.service}:${left.sourcePath}`.localeCompare(
      `${right.routePath}:${right.service}:${right.sourcePath}`
    )
  )
}

const parameterFor = (name) => ({
  in: "path",
  name,
  required: true,
  schema: {
    maxLength: 256,
    minLength: 1,
    type: "string",
  },
})

const responseReferenceFor = (envelope) =>
  envelope === "api-problem"
    ? "./api-problems.yaml#/components/responses/ApiProblemResponse"
    : "./api-problems.yaml#/components/responses/NativeMedusaErrorResponse"

const successResponse = {
  content: {
    "application/json": {
      schema: {},
    },
  },
  description: "A successful custom-route response.",
  headers: {
    "X-Request-Id": {
      $ref: "./api-problems.yaml#/components/headers/RequestId",
    },
    traceparent: {
      $ref: "./api-problems.yaml#/components/headers/Traceparent",
    },
  },
}

const operationIdFor = (services, method, routePath) =>
  `${services.join("_")}_${method.toLowerCase()}_${routePath}`
    .replace(/\{([^}]+)\}/gu, "by_$1")
    .replace(/[^a-zA-Z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .toLowerCase()

const buildOperation = (entries, method) => {
  const services = [...new Set(entries.map((entry) => entry.service))].sort()
  const sources = entries.map((entry) => entry.sourcePath).sort()
  const routePath = entries[0].routePath
  const envelopes = [...new Set(entries.map((entry) => entry.errorEnvelope))]
  const providerBoundaries = [
    ...new Set(entries.map((entry) => entry.providerBoundary)),
  ]

  if (entries.length > 1 && !HEALTH_PATHS.has(routePath)) {
    throw new Error(`Duplicate ${method} ${routePath}: ${sources.join(", ")}`)
  }
  if (envelopes.length !== 1 || providerBoundaries.length !== 1) {
    throw new Error(`Conflicting route contracts for ${method} ${routePath}`)
  }

  const envelope = envelopes[0]
  const providerBoundary = providerBoundaries[0]
  const pathParameters = [...routePath.matchAll(/\{([^}]+)\}/gu)].map(
    (match) => parameterFor(match[1])
  )
  const responses = {
    "2XX": successResponse,
  }

  if (envelope === "health-json") {
    responses["5XX"] = {
      description: "The service is not ready or healthy.",
    }
  } else {
    const responseReference = responseReferenceFor(envelope)
    responses["4XX"] = { $ref: responseReference }
    responses["5XX"] = { $ref: responseReference }
  }

  return {
    operationId: operationIdFor(services, method, routePath),
    summary: `${method} ${routePath}`,
    tags: services.map((service) => `${service} custom routes`),
    ...(pathParameters.length ? { parameters: pathParameters } : {}),
    responses,
    "x-error-contract": {
      envelope,
      providerFailure:
        providerBoundary === "bounded"
          ? {
              timeoutStatus: 504,
              unavailableStatus: 502,
            }
          : "not-applicable",
      unexpectedStatus: 500,
    },
    "x-route-files": sources,
    "x-services": services,
  }
}

export const buildContract = (inventory) => {
  const operationGroups = new Map()
  inventory.forEach((entry) => {
    entry.methods.forEach((method) => {
      const key = `${method} ${entry.routePath}`
      const group = operationGroups.get(key) ?? []
      group.push(entry)
      operationGroups.set(key, group)
    })
  })

  const paths = {}
  ;[...operationGroups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([key, entries]) => {
      const [method] = key.split(" ", 1)
      const routePath = entries[0].routePath
      paths[routePath] ??= {}
      paths[routePath][method.toLowerCase()] = buildOperation(entries, method)
    })

  const routeFileCounts = Object.fromEntries(
    ROUTE_ROOTS.map(({ service }) => [
      service,
      inventory.filter((entry) => entry.service === service).length,
    ])
  )
  const routeOperationCount = inventory.reduce(
    (count, entry) => count + entry.methods.length,
    0
  )

  return {
    openapi: "3.1.0",
    info: {
      description:
        "Generated inventory of every repository-owned Backend and Storefront route. Detailed schemas for security-sensitive public boundaries remain in api-problems.yaml.",
      title: "Remorseless Records custom endpoint inventory",
      version: "1.0.0",
    },
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    paths,
    "x-inventory": {
      routeFileCount: inventory.length,
      routeFileCounts,
      routeOperationCount,
      uniqueOperationCount: operationGroups.size,
    },
  }
}

export const serializeContract = (contract) =>
  `${JSON.stringify(contract, null, 2)}\n`

const run = async () => {
  const mode = process.argv[2]
  if (mode !== "--check" && mode !== "--write") {
    throw new Error("Usage: node scripts/generate-api-contract.mjs --check|--write")
  }

  const serialized = serializeContract(
    buildContract(await inventoryRoutes(REPOSITORY_ROOT))
  )
  if (mode === "--check") {
    const existing = await readFile(GENERATED_CONTRACT_PATH, "utf8").catch(
      () => ""
    )
    if (existing !== serialized) {
      throw new Error(
        "Generated API contract is stale; run pnpm run api:contract:generate"
      )
    }
    return
  }

  const temporaryPath = `${GENERATED_CONTRACT_PATH}.tmp`
  await writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o644 })
  await rename(temporaryPath, GENERATED_CONTRACT_PATH)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run()
}
