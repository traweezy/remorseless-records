import { createHash } from "node:crypto"

import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  homepageShelfCopy,
  planHomepageShelfCopy,
  type HomepageShelfCopyChange,
  type HomepageShelfCopyHandle,
  type HomepageShelfCopyRecord,
} from "@/lib/catalog/homepage-shelf-copy"
import type CatalogModuleService from "@/modules/catalog/service"

type CatalogService = InstanceType<typeof CatalogModuleService>
type CatalogServiceMethod = (...args: unknown[]) => Promise<unknown>
type CatalogServiceMethods = Record<string, CatalogServiceMethod | undefined>

type ReconciliationArguments = {
  apply: boolean
  expectedCount: number | null
  expectedManifestSha256: string | null
}

const expectedCountPrefix = "--expected-count="
const expectedManifestPrefix = "--expected-manifest-sha256="
const sha256Pattern = /^[a-f0-9]{64}$/

const readOption = (args: string[], prefix: string): string | null =>
  args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null

export const parseHomepageShelfCopyArguments = (args: string[]): ReconciliationArguments => {
  const apply = args.includes("--apply")
  const countValue = readOption(args, expectedCountPrefix)
  const manifestValue = readOption(args, expectedManifestPrefix)
  const expectedCount = countValue === null ? null : Number(countValue)
  const expectedManifestSha256 = manifestValue?.toLowerCase() ?? null

  if (countValue !== null && (!Number.isInteger(expectedCount) || (expectedCount ?? -1) < 0)) {
    throw new Error("--expected-count must be a non-negative integer.")
  }
  if (expectedManifestSha256 !== null && !sha256Pattern.test(expectedManifestSha256)) {
    throw new Error("--expected-manifest-sha256 must be a lowercase SHA-256 digest.")
  }
  if (apply && (expectedCount === null || expectedManifestSha256 === null)) {
    throw new Error(
      "Apply mode requires --expected-count and --expected-manifest-sha256 from the reviewed preview."
    )
  }

  return { apply, expectedCount, expectedManifestSha256 }
}

export const buildHomepageShelfCopyManifest = (
  changes: HomepageShelfCopyChange[]
): { version: 1; changes: HomepageShelfCopyChange[] } => ({
  version: 1,
  changes,
})

export const hashHomepageShelfCopyManifest = (
  manifest: ReturnType<typeof buildHomepageShelfCopyManifest>
): string => createHash("sha256").update(JSON.stringify(manifest)).digest("hex")

const callCatalogService = async <T>(
  catalogService: CatalogService,
  candidates: readonly string[],
  args: unknown[]
): Promise<T> => {
  const methods = catalogService as unknown as CatalogServiceMethods
  const methodName = candidates.find((candidate) => typeof methods[candidate] === "function")
  const method = methodName ? methods[methodName] : undefined
  if (!method) {
    throw new Error(`Catalog service is missing ${candidates.join(" or ")}`)
  }
  return (await method.apply(catalogService, args)) as T
}

const copyHandles = Object.keys(homepageShelfCopy) as HomepageShelfCopyHandle[]

const loadHomepageShelves = async (
  catalogService: CatalogService
): Promise<HomepageShelfCopyRecord[]> => {
  const shelves = await Promise.all(
    copyHandles.map(async (handle) => {
      const matches = await callCatalogService<HomepageShelfCopyRecord[]>(
        catalogService,
        ["listCatalogShelves", "listCatalogShelfs"],
        [{ handle }]
      )
      if (matches.length !== 1) {
        throw new Error(
          `[homepage-shelves] Expected one '${handle}' shelf; received ${matches.length}.`
        )
      }
      return matches[0]!
    })
  )
  return shelves
}

export default async function reconcileHomepageShelfCopy({ container }: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const catalogService = container.resolve("catalog") as CatalogService
  const options = parseHomepageShelfCopyArguments(process.argv.slice(2))
  const current = await loadHomepageShelves(catalogService)
  const changes = planHomepageShelfCopy(current)
  const manifest = buildHomepageShelfCopyManifest(changes)
  const manifestSha256 = hashHomepageShelfCopyManifest(manifest)

  logger.info(
    `[homepage-shelves] mode=${options.apply ? "apply" : "preview"} changes=${changes.length} manifest_sha256=${manifestSha256}`
  )
  changes.forEach((change) => {
    logger.info(
      `[homepage-shelves] ${change.handle}: '${change.before.title}' -> '${change.after.title}'`
    )
  })

  if (!options.apply) {
    logger.info(
      "[homepage-shelves] Preview only. Apply with the reviewed count and manifest SHA-256."
    )
    return
  }
  if (options.expectedCount !== changes.length) {
    throw new Error(
      `[homepage-shelves] Expected ${options.expectedCount} change(s), but current state requires ${changes.length}.`
    )
  }
  if (options.expectedManifestSha256 !== manifestSha256) {
    throw new Error(
      "[homepage-shelves] Current shelf state differs from the reviewed manifest. Run preview again."
    )
  }
  if (!changes.length) {
    logger.info("[homepage-shelves] Copy is already current; nothing to update.")
    return
  }

  await callCatalogService(
    catalogService,
    ["updateCatalogShelves", "updateCatalogShelfs"],
    [
      changes.map((change) => ({
        id: change.id,
        title: change.after.title,
        description: change.after.description,
      })),
    ]
  )

  const remaining = planHomepageShelfCopy(await loadHomepageShelves(catalogService))
  if (remaining.length) {
    throw new Error(
      `[homepage-shelves] Verification failed for ${remaining.length} shelf change(s).`
    )
  }

  logger.info(`[homepage-shelves] Applied and verified ${changes.length} shelf copy change(s).`)
}
