import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import type DiscographyModuleService from "@/modules/discography/service"

type DiscographyService = InstanceType<typeof DiscographyModuleService>

type DiscographyEntryRecord = {
  id: string
  formats?: string[] | null
}

type DiscographyUpdatePayload = {
  id: string
  formats: string[]
}

const DISCOGRAPHY_FORMATS = [
  {
    label: "Vinyl",
    pattern:
      /(vinyl|lp|12"|12-inch|12 inch|10"|10-inch|10 inch|7"|7-inch|7 inch|record)/i,
  },
  { label: "CD", pattern: /(compact disc|\bcd\b)/i },
  { label: "Cassette", pattern: /(cassette|tape|k7)/i },
] as const

const normalizeFormats = (formats: string[] | null | undefined): string[] => {
  if (!formats?.length) {
    return []
  }

  const found = new Set<string>()

  formats.forEach((format) => {
    if (typeof format !== "string") {
      return
    }
    const trimmed = format.trim()
    if (!trimmed.length) {
      return
    }
    for (const entry of DISCOGRAPHY_FORMATS) {
      if (entry.pattern.test(trimmed)) {
        found.add(entry.label)
        break
      }
    }
  })

  return DISCOGRAPHY_FORMATS.map((entry) => entry.label).filter((label) => found.has(label))
}

const listAll = async <T>(
  fetchPage: (skip: number, take: number) => Promise<[T[], number]>
): Promise<T[]> => {
  const results: T[] = []
  const take = 200
  let skip = 0

  while (true) {
    const [items, count] = await fetchPage(skip, take)
    results.push(...items)
    skip += items.length
    if (!items.length || skip >= count) {
      break
    }
  }

  return results
}

const hasSameFormats = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) {
    return false
  }
  const sortedLeft = [...left].sort()
  const sortedRight = [...right].sort()
  return sortedLeft.every((value, index) => value === sortedRight[index])
}

export default async function normalizeDiscographyFormatsScript({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const discographyService = container.resolve("discography") as DiscographyService

  const entries = await listAll<DiscographyEntryRecord>((skip, take) =>
    discographyService.listAndCountDiscographyEntries({}, { skip, take })
  )

  const updates: DiscographyUpdatePayload[] = []

  entries.forEach((entry) => {
    const normalized = normalizeFormats(entry.formats ?? [])
    const current = (entry.formats ?? []).filter((value): value is string => typeof value === "string")
    if (!hasSameFormats(current, normalized)) {
      updates.push({ id: entry.id, formats: normalized })
    }
  })

  const batchSize = 50
  let updated = 0

  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize)
    if (!batch.length) {
      continue
    }
    await discographyService.updateDiscographyEntries(batch)
    updated += batch.length
  }

  logger.info(
    `[discography] Normalized formats for ${updated} entries (scanned ${entries.length}).`
  )
}
