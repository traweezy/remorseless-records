import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { ExecArgs, FileTypes } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"

import {
  buildManagedMediaFilename,
  calculateMediaRetryDelayMs,
  hashManagedMedia,
  inspectManagedImage,
  isBigCartelProductImageUrl,
  isRetryableMediaStatus,
  managedMediaUsagePlan,
  parseManagedMediaCommandOptions,
  parseRetryAfterMs,
  resolveDeduplicatedManagedUpload,
  selectBigCartelManagedMasterUrl,
  type ManagedMediaCommandOptions,
  type SupportedManagedImage,
} from "@/lib/catalog/managed-media"
import { readCatalogUploadedFile } from "@/lib/catalog/transaction-persistence-contracts"
import { readIsoTimestamp } from "@/lib/provider-boundary/primitives"
import { asUnknownRecord } from "@/lib/provider-boundary/records"
import {
  MANAGED_IMAGE_NORMALIZER_VERSION,
  normalizeManagedImageUpload,
} from "@/lib/uploads/image-normalization"
import { MAX_UPLOAD_BYTES } from "@/lib/uploads/constraints"
import type CatalogModuleService from "@/modules/catalog/service"
import type NewsModuleService from "@/modules/news/service"

type CatalogService = InstanceType<typeof CatalogModuleService>
type NewsService = InstanceType<typeof NewsModuleService>

type JsonObject = Record<string, unknown>

type ProductImageRecord = {
  id: string
  metadata?: JsonObject | null
  url: string
}

type ProductRecord = {
  id: string
  images?: ProductImageRecord[] | null
  thumbnail?: string | null
  title?: string | null
}

type ProductService = {
  listAndCountProducts: (
    filters?: Record<string, unknown>,
    config?: {
      relations?: string[]
      skip?: number
      take?: number
    }
  ) => Promise<[ProductRecord[], number]>
}

type CatalogMediaAssetRecord = {
  byte_size?: number | null
  content_sha256?: string | null
  derivative_status?: string | null
  derivatives?: JsonObject | null
  height?: number | null
  id: string
  metadata?: JsonObject | null
  original_filename?: string | null
  source_file_key?: string | null
  source_url: string
  version?: number | null
  width?: number | null
}

type CatalogVariantProfileRecord = {
  id: string
  image_url?: string | null
  metadata?: JsonObject | null
  version?: number | null
}

type CatalogArtistRecord = {
  id: string
  image_url?: string | null
  metadata?: JsonObject | null
}

type NewsEntryRecord = {
  cover_url?: string | null
  id: string
}

type ManagedMediaStateEntry = {
  byteSize: number
  completedAt: string
  fileKey: string
  height: number
  managedUrl: string
  mimeType: "image/webp"
  normalizerVersion: typeof MANAGED_IMAGE_NORMALIZER_VERSION
  originalUrls: string[]
  sha256: string
  sourceByteSize: number
  sourceMimeType: SupportedManagedImage["mimeType"]
  sourceSha256: string
  sourceUrl: string
  width: number
}

type ManagedMediaState = {
  createdAt: string
  entries: Record<string, ManagedMediaStateEntry>
  masterWidth: number
  schemaVersion: 2
  updatedAt: string
}

const MAXIMUM_MANAGED_MEDIA_STATE_ENTRIES = 100_000

type SourceUsage = {
  catalogAssetIds: Set<string>
  catalogArtistIds: Set<string>
  catalogVariantProfileIds: Set<string>
  newsEntryIds: Set<string>
  originalUrls: Set<string>
  productIds: Set<string>
}

type MediaInventory = {
  artists: CatalogArtistRecord[]
  assets: CatalogMediaAssetRecord[]
  newsEntries: NewsEntryRecord[]
  products: ProductRecord[]
  sources: Map<string, SourceUsage>
  variantProfiles: CatalogVariantProfileRecord[]
}

type DownloadedMedia = {
  buffer: Buffer
  image: SupportedManagedImage
  sha256: string
  source: {
    byteSize: number
    image: SupportedManagedImage
    sha256: string
  }
}

const STATE_FILENAME = "big-cartel-managed-media.json"
const REPORT_DIRECTORY = "reports"
const DOWNLOAD_ATTEMPTS = 5
const CUTOVER_BATCH_SIZE = 25

const sleep = async (milliseconds: number): Promise<void> =>
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })

const asJsonObject = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {}

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
    if (items.length === 0 || skip >= count) {
      return results
    }
  }
}

const createEmptyUsage = (): SourceUsage => ({
  catalogAssetIds: new Set(),
  catalogArtistIds: new Set(),
  catalogVariantProfileIds: new Set(),
  newsEntryIds: new Set(),
  originalUrls: new Set(),
  productIds: new Set(),
})

const addSourceUsage = (
  sources: Map<string, SourceUsage>,
  rawUrl: unknown,
  applyUsage: (usage: SourceUsage) => void
): void => {
  if (!isBigCartelProductImageUrl(rawUrl)) {
    return
  }
  const sourceUrl = selectBigCartelManagedMasterUrl(rawUrl)
  const usage = sources.get(sourceUrl) ?? createEmptyUsage()
  usage.originalUrls.add(rawUrl)
  applyUsage(usage)
  sources.set(sourceUrl, usage)
}

const inventoryMedia = async (
  productService: ProductService,
  catalogService: CatalogService,
  newsService: NewsService
): Promise<MediaInventory> => {
  const [products, assets, variantProfiles, artists, newsEntries] =
    await Promise.all([
      listAll<ProductRecord>((skip, take) =>
        productService.listAndCountProducts(
          {},
          { relations: ["images"], skip, take }
        )
      ),
      listAll<CatalogMediaAssetRecord>((skip, take) =>
        catalogService.listAndCountCatalogMediaAssets({}, { skip, take })
      ),
      listAll<CatalogVariantProfileRecord>((skip, take) =>
        catalogService.listAndCountCatalogVariantProfiles({}, { skip, take })
      ),
      listAll<CatalogArtistRecord>((skip, take) =>
        catalogService.listAndCountCatalogArtists({}, { skip, take })
      ),
      listAll<NewsEntryRecord>((skip, take) =>
        newsService.listAndCountNewsEntries({}, { skip, take })
      ),
    ])

  const sources = new Map<string, SourceUsage>()
  products.forEach((product) => {
    addSourceUsage(sources, product.thumbnail, (usage) => {
      usage.productIds.add(product.id)
    })
    product.images?.forEach((image) => {
      addSourceUsage(sources, image.url, (usage) => {
        usage.productIds.add(product.id)
      })
    })
  })
  assets.forEach((asset) => {
    addSourceUsage(sources, asset.source_url, (usage) => {
      usage.catalogAssetIds.add(asset.id)
    })
  })
  variantProfiles.forEach((profile) => {
    addSourceUsage(sources, profile.image_url, (usage) => {
      usage.catalogVariantProfileIds.add(profile.id)
    })
  })
  artists.forEach((artist) => {
    addSourceUsage(sources, artist.image_url, (usage) => {
      usage.catalogArtistIds.add(artist.id)
    })
  })
  newsEntries.forEach((entry) => {
    addSourceUsage(sources, entry.cover_url, (usage) => {
      usage.newsEntryIds.add(entry.id)
    })
  })

  return {
    artists,
    assets,
    newsEntries,
    products,
    sources,
    variantProfiles,
  }
}

class PoliteHostScheduler {
  private nextStartAt = 0
  private tail: Promise<void> = Promise.resolve()

  constructor(private readonly minDelayMs: number) {}

  async waitForTurn(): Promise<void> {
    let release = (): void => undefined
    const previous = this.tail
    this.tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      const remaining = Math.max(this.nextStartAt - Date.now(), 0)
      if (remaining > 0) {
        await sleep(remaining)
      }
      const jitter = Math.floor(Math.random() * 250)
      this.nextStartAt = Date.now() + this.minDelayMs + jitter
    } finally {
      release()
    }
  }
}

class RetryableMediaError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number | null = null
  ) {
    super(message)
    this.name = "RetryableMediaError"
  }
}

const readResponseWithLimit = async (
  response: Response,
  maxBytes: number
): Promise<Buffer> => {
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(
      `Declared response length ${declaredLength} exceeds ${maxBytes} bytes.`
    )
  }
  if (!response.body) {
    throw new Error("Media response did not include a body.")
  }

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        return Buffer.concat(chunks, total)
      }
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel("managed-media-byte-limit")
        throw new Error(`Response exceeds the ${maxBytes}-byte safety limit.`)
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
}

const downloadMedia = async (
  sourceUrl: string,
  scheduler: PoliteHostScheduler,
  options: ManagedMediaCommandOptions
): Promise<DownloadedMedia> => {
  for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt += 1) {
    await scheduler.waitForTurn()
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      options.requestTimeoutMs
    )
    try {
      const response = await fetch(sourceUrl, {
        headers: {
          accept: "image/jpeg,image/png,image/webp;q=0.9,*/*;q=0.1",
          "user-agent": "RemorselessRecordsManagedMediaMigration/1.0",
        },
        redirect: "manual",
        signal: controller.signal,
      })
      if (response.status >= 300 && response.status < 400) {
        throw new Error(
          `Unexpected redirect from the allow-listed media source (${response.status}).`
        )
      }
      if (!response.ok) {
        if (isRetryableMediaStatus(response.status)) {
          throw new RetryableMediaError(
            `Big Cartel returned retryable status ${response.status}.`,
            parseRetryAfterMs(response.headers.get("retry-after"))
          )
        }
        throw new Error(`Big Cartel returned status ${response.status}.`)
      }

      const buffer = await readResponseWithLimit(
        response,
        Math.min(options.maxBytes, MAX_UPLOAD_BYTES)
      )
      const image = inspectManagedImage(
        buffer,
        response.headers.get("content-type")
      )
      const normalized = await normalizeManagedImageUpload({
        buffer,
        destination: "",
        encoding: "7bit",
        fieldname: "files",
        filename: "",
        mimetype: image.mimeType,
        originalname: path.basename(new URL(sourceUrl).pathname) || "image",
        path: "",
        size: buffer.length,
        stream: null as never,
      })
      return {
        buffer: normalized.buffer,
        image: {
          extension: ".webp",
          height: normalized.height,
          mimeType: normalized.mimeType,
          width: normalized.width,
        },
        sha256: normalized.sha256,
        source: {
          byteSize: buffer.length,
          image,
          sha256: hashManagedMedia(buffer),
        },
      }
    } catch (error: unknown) {
      const isLastAttempt = attempt === DOWNLOAD_ATTEMPTS - 1
      const retryable =
        error instanceof RetryableMediaError ||
        (error instanceof Error && error.name === "AbortError")
      if (!retryable || isLastAttempt) {
        throw error
      }
      const retryAfterMs =
        error instanceof RetryableMediaError ? error.retryAfterMs : null
      await sleep(calculateMediaRetryDelayMs(attempt, retryAfterMs))
    } finally {
      clearTimeout(timeout)
    }
  }
  throw new Error("Media download exhausted all retry attempts.")
}

const defaultStateDirectory = (): string =>
  path.join(
    os.homedir(),
    ".local",
    "share",
    "remorseless-records",
    "media-migration"
  )

const readStateText = (value: unknown, maximum: number): string | null =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maximum &&
  value === value.trim() &&
  !/[\u0000-\u001f\u007f]/u.test(value)
    ? value
    : null

const readStateUrl = (value: unknown): string | null => {
  const text = readStateText(value, 2_048)
  if (!text) {
    return null
  }
  try {
    const url = new URL(text)
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? text
      : null
  } catch {
    return null
  }
}

const readPositiveStateInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null

const readManagedMediaStateEntry = (
  value: unknown,
  sourceKey: string
): ManagedMediaStateEntry => {
  const record = asUnknownRecord(value)
  const byteSize = readPositiveStateInteger(record?.byteSize)
  const completedAt = readIsoTimestamp(record?.completedAt)
  const fileKey = readStateText(record?.fileKey, 1_024)
  const height = readPositiveStateInteger(record?.height)
  const managedUrl = readStateUrl(record?.managedUrl)
  const originalUrls = Array.isArray(record?.originalUrls)
    ? record.originalUrls.map(readStateUrl)
    : []
  const sourceByteSize = readPositiveStateInteger(record?.sourceByteSize)
  const sourceMimeType =
    record?.sourceMimeType === "image/jpeg" ||
    record?.sourceMimeType === "image/png" ||
    record?.sourceMimeType === "image/webp"
      ? record.sourceMimeType
      : null
  const sourceUrl = readStateUrl(record?.sourceUrl)
  const width = readPositiveStateInteger(record?.width)
  if (
    !record ||
    byteSize === null ||
    !completedAt ||
    !fileKey ||
    height === null ||
    !managedUrl ||
    record.mimeType !== "image/webp" ||
    record.normalizerVersion !== MANAGED_IMAGE_NORMALIZER_VERSION ||
    originalUrls.length > 100 ||
    originalUrls.some((url) => !url) ||
    new Set(originalUrls).size !== originalUrls.length ||
    typeof record.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(record.sha256) ||
    sourceByteSize === null ||
    !sourceMimeType ||
    typeof record.sourceSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(record.sourceSha256) ||
    !sourceUrl ||
    sourceUrl !== sourceKey ||
    width === null
  ) {
    throw new Error(`Managed-media state for ${sourceKey} is invalid.`)
  }
  return {
    byteSize,
    completedAt,
    fileKey,
    height,
    managedUrl,
    mimeType: "image/webp",
    normalizerVersion: MANAGED_IMAGE_NORMALIZER_VERSION,
    originalUrls: originalUrls.filter((url): url is string => Boolean(url)),
    sha256: record.sha256,
    sourceByteSize,
    sourceMimeType,
    sourceSha256: record.sourceSha256,
    sourceUrl,
    width,
  }
}

export const readManagedMediaState = (value: unknown): ManagedMediaState => {
  const record = asUnknownRecord(value)
  const entriesRecord = asUnknownRecord(record?.entries)
  const createdAt = readIsoTimestamp(record?.createdAt)
  const updatedAt = readIsoTimestamp(record?.updatedAt)
  if (
    !record ||
    record.schemaVersion !== 2 ||
    record.masterWidth !== managedMediaUsagePlan.masterWidth ||
    !entriesRecord ||
    Object.keys(entriesRecord).length > MAXIMUM_MANAGED_MEDIA_STATE_ENTRIES ||
    !createdAt ||
    !updatedAt
  ) {
    throw new Error("Managed-media state has an unsupported schema.")
  }
  const entries = Object.fromEntries(
    Object.entries(entriesRecord).map(([sourceUrl, entry]) => [
      sourceUrl,
      readManagedMediaStateEntry(entry, sourceUrl),
    ])
  )
  return {
    createdAt,
    entries,
    masterWidth: managedMediaUsagePlan.masterWidth,
    schemaVersion: 2,
    updatedAt,
  }
}

const loadState = async (statePath: string): Promise<ManagedMediaState> => {
  try {
    const raw = await fs.readFile(statePath, "utf8")
    return readManagedMediaState(JSON.parse(raw))
  } catch (error: unknown) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : null
    if (code !== "ENOENT") {
      throw error
    }
    const now = new Date().toISOString()
    return {
      createdAt: now,
      entries: {},
      masterWidth: managedMediaUsagePlan.masterWidth,
      schemaVersion: 2,
      updatedAt: now,
    }
  }
}

const writeJsonAtomically = async (
  destination: string,
  value: unknown
): Promise<void> => {
  const temporary = `${destination}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  })
  await fs.rename(temporary, destination)
}

const validateStateEntry = (entry: ManagedMediaStateEntry): void => {
  let managedUrlIsAllowed = false
  try {
    const managedUrl = new URL(entry.managedUrl)
    managedUrlIsAllowed =
      managedUrl.protocol === "https:" ||
      (managedUrl.protocol === "http:" &&
        (managedUrl.hostname === "localhost" ||
          managedUrl.hostname === "127.0.0.1"))
  } catch {
    managedUrlIsAllowed = false
  }
  if (
    !entry.fileKey ||
    !managedUrlIsAllowed ||
    !/^[0-9a-f]{64}$/.test(entry.sha256) ||
    !/^[0-9a-f]{64}$/.test(entry.sourceSha256) ||
    entry.mimeType !== "image/webp" ||
    entry.normalizerVersion !== MANAGED_IMAGE_NORMALIZER_VERSION ||
    entry.byteSize < 1 ||
    entry.sourceByteSize < 1 ||
    entry.width < 1 ||
    entry.height < 1
  ) {
    throw new Error(`Managed-media state for ${entry.sourceUrl} is invalid.`)
  }
}

const stageManagedMedia = async (
  sources: Map<string, SourceUsage>,
  state: ManagedMediaState,
  statePath: string,
  fileModuleService: FileTypes.IFileModuleService,
  options: ManagedMediaCommandOptions,
  onProgress: (completed: number, total: number) => void
): Promise<void> => {
  const sourceUrls = Array.from(sources.keys()).sort()
  const stateBySha = new Map<string, ManagedMediaStateEntry>()
  Object.values(state.entries).forEach((entry) => {
    validateStateEntry(entry)
    stateBySha.set(entry.sha256, entry)
  })
  const uploadsBySha = new Map<string, Promise<{ id: string; url: string }>>()
  const scheduler = new PoliteHostScheduler(options.minDelayMs)
  let cursor = 0
  let completed = 0
  let stateWriteTail: Promise<void> = Promise.resolve()
  const persistState = async (): Promise<void> => {
    stateWriteTail = stateWriteTail.then(async () => {
      await writeJsonAtomically(statePath, state)
    })
    await stateWriteTail
  }

  const worker = async (): Promise<void> => {
    while (cursor < sourceUrls.length) {
      const index = cursor
      cursor += 1
      const sourceUrl = sourceUrls[index]
      if (!sourceUrl) {
        continue
      }
      const usage = sources.get(sourceUrl)
      if (!usage) {
        throw new Error(`Source usage disappeared for ${sourceUrl}.`)
      }

      const existing = state.entries[sourceUrl]
      if (existing) {
        existing.originalUrls = Array.from(
          new Set([...existing.originalUrls, ...usage.originalUrls])
        ).sort()
        validateStateEntry(existing)
      } else {
        const downloaded = await downloadMedia(sourceUrl, scheduler, options)
        const duplicate = stateBySha.get(downloaded.sha256)
        const uploaded = duplicate
          ? {
              id: duplicate.fileKey,
              url: duplicate.managedUrl,
            }
          : await resolveDeduplicatedManagedUpload(
              uploadsBySha,
              downloaded.sha256,
              async () =>
                readCatalogUploadedFile(
                  await fileModuleService.createFiles({
                    access: "public",
                    content: downloaded.buffer.toString("base64"),
                    filename: buildManagedMediaFilename(sourceUrl, ".webp"),
                    mimeType: downloaded.image.mimeType,
                  })
                )
            )
        const entry: ManagedMediaStateEntry = {
          byteSize: downloaded.buffer.length,
          completedAt: new Date().toISOString(),
          fileKey: uploaded.id,
          height: downloaded.image.height,
          managedUrl: uploaded.url,
          mimeType: "image/webp",
          normalizerVersion: MANAGED_IMAGE_NORMALIZER_VERSION,
          originalUrls: Array.from(usage.originalUrls).sort(),
          sha256: downloaded.sha256,
          sourceByteSize: downloaded.source.byteSize,
          sourceMimeType: downloaded.source.image.mimeType,
          sourceSha256: downloaded.source.sha256,
          sourceUrl,
          width: downloaded.image.width,
        }
        validateStateEntry(entry)
        state.entries[sourceUrl] = entry
        stateBySha.set(entry.sha256, entry)
      }

      state.updatedAt = new Date().toISOString()
      await persistState()
      completed += 1
      onProgress(completed, sourceUrls.length)
    }
  }

  await Promise.all([worker(), worker()])
}

const mappedEntry = (
  rawUrl: string | null | undefined,
  state: ManagedMediaState
): ManagedMediaStateEntry | null => {
  if (!isBigCartelProductImageUrl(rawUrl)) {
    return null
  }
  const sourceUrl = selectBigCartelManagedMasterUrl(rawUrl)
  const entry = state.entries[sourceUrl]
  if (!entry) {
    throw new Error(`No staged managed media exists for ${sourceUrl}.`)
  }
  validateStateEntry(entry)
  return entry
}

const updateNativeProducts = async (
  container: ExecArgs["container"],
  inventory: MediaInventory,
  state: ManagedMediaState
): Promise<number> => {
  const updates = inventory.products.flatMap((product) => {
    const thumbnailEntry = mappedEntry(product.thumbnail, state)
    const imageEntries =
      product.images?.map((image) => ({
        image,
        managed: mappedEntry(image.url, state),
      })) ?? []
    if (!thumbnailEntry && imageEntries.every(({ managed }) => !managed)) {
      return []
    }

    return [
      {
        id: product.id,
        ...(thumbnailEntry ? { thumbnail: thumbnailEntry.managedUrl } : {}),
        images: imageEntries.map(({ image, managed }) => ({
          id: image.id,
          metadata: {
            ...asJsonObject(image.metadata),
            ...(managed
              ? {
                  managed_media: {
                    original_url: image.url,
                    sha256: managed.sha256,
                    source_sha256: managed.sourceSha256,
                  },
                }
              : {}),
          },
          url: managed?.managedUrl ?? image.url,
        })),
      },
    ]
  })

  for (let index = 0; index < updates.length; index += CUTOVER_BATCH_SIZE) {
    await updateProductsWorkflow(container).run({
      input: { products: updates.slice(index, index + CUTOVER_BATCH_SIZE) },
    })
  }
  return updates.length
}

const updateCatalogMedia = async (
  catalogService: CatalogService,
  inventory: MediaInventory,
  state: ManagedMediaState
): Promise<{ artists: number; assets: number; variantProfiles: number }> => {
  const assetUpdates = inventory.assets.flatMap((asset) => {
    const managed = mappedEntry(asset.source_url, state)
    if (!managed) {
      return []
    }
    return [
      {
        id: asset.id,
        byte_size: managed.byteSize,
        content_sha256: managed.sha256,
        derivative_status: "source_only" as const,
        derivatives: {
          ...asJsonObject(asset.derivatives),
          responsive: {
            ...managedMediaUsagePlan,
            responsiveWidths: [...managedMediaUsagePlan.responsiveWidths],
          },
        },
        height: managed.height,
        metadata: {
          ...asJsonObject(asset.metadata),
          managed_media: {
            migrated_at: new Date().toISOString(),
            original_url: asset.source_url,
            source: "big_cartel",
          },
          safety_pipeline: {
            normalized_format: "webp",
            normalized_sha256: managed.sha256,
            status: "passed",
            validation: "strict-decode-reencode",
            version: managed.normalizerVersion,
          },
          source: {
            mime_type: managed.sourceMimeType,
            sha256: managed.sourceSha256,
            size: managed.sourceByteSize,
          },
        },
        mime_type: managed.mimeType,
        original_filename: buildManagedMediaFilename(
          managed.sourceUrl,
          ".webp"
        ),
        source_file_key: managed.fileKey,
        source_url: managed.managedUrl,
        version: (asset.version ?? 1) + 1,
        width: managed.width,
      },
    ]
  })
  const variantUpdates = inventory.variantProfiles.flatMap((profile) => {
    const managed = mappedEntry(profile.image_url, state)
    return managed
      ? [
          {
            id: profile.id,
            image_url: managed.managedUrl,
            metadata: {
              ...asJsonObject(profile.metadata),
              managed_media_original_url: profile.image_url,
            },
            version: (profile.version ?? 1) + 1,
          },
        ]
      : []
  })
  const artistUpdates = inventory.artists.flatMap((artist) => {
    const managed = mappedEntry(artist.image_url, state)
    return managed
      ? [
          {
            id: artist.id,
            image_url: managed.managedUrl,
            metadata: {
              ...asJsonObject(artist.metadata),
              managed_media_original_url: artist.image_url,
            },
          },
        ]
      : []
  })

  await catalogService.runCatalogTransaction(async (sharedContext) => {
    if (assetUpdates.length) {
      await catalogService.updateCatalogMediaAssets(assetUpdates, sharedContext)
    }
    if (variantUpdates.length) {
      await catalogService.updateCatalogVariantProfiles(
        variantUpdates,
        sharedContext
      )
    }
    if (artistUpdates.length) {
      await catalogService.updateCatalogArtists(artistUpdates, sharedContext)
    }
  })

  return {
    artists: artistUpdates.length,
    assets: assetUpdates.length,
    variantProfiles: variantUpdates.length,
  }
}

const updateEditorialMedia = async (
  newsService: NewsService,
  inventory: MediaInventory,
  state: ManagedMediaState
): Promise<{ news: number }> => {
  const newsUpdates = inventory.newsEntries.flatMap((entry) => {
    const managed = mappedEntry(entry.cover_url, state)
    return managed ? [{ id: entry.id, cover_url: managed.managedUrl }] : []
  })
  if (newsUpdates.length) {
    await newsService.updateNewsEntries(newsUpdates)
  }
  return { news: newsUpdates.length }
}

const buildInventoryReport = (inventory: MediaInventory): JsonObject => {
  const usages = Array.from(inventory.sources.entries()).map(
    ([sourceUrl, usage]) => ({
      catalogAssetCount: usage.catalogAssetIds.size,
      catalogArtistCount: usage.catalogArtistIds.size,
      catalogVariantProfileCount: usage.catalogVariantProfileIds.size,
      newsEntryCount: usage.newsEntryIds.size,
      originalUrls: Array.from(usage.originalUrls).sort(),
      productCount: usage.productIds.size,
      sourceUrl,
    })
  )
  return {
    generatedAt: new Date().toISOString(),
    masterDecision: managedMediaUsagePlan,
    sourceCount: inventory.sources.size,
    usages,
  }
}

const sourceFingerprint = (sources: Iterable<string>): string =>
  createHash("sha256")
    .update(Array.from(sources).sort().join("\n"))
    .digest("hex")

export default async function migrateBigCartelMedia({
  args = [],
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const options = parseManagedMediaCommandOptions([
    ...args,
    ...process.argv.slice(2),
  ])
  const productService = container.resolve<ProductService>(Modules.PRODUCT)
  const fileModuleService = container.resolve<FileTypes.IFileModuleService>(
    Modules.FILE
  )
  const catalogService = container.resolve<CatalogService>("catalog")
  const newsService = container.resolve<NewsService>("news")

  const stateDirectory = path.resolve(
    options.stateDirectory ?? defaultStateDirectory()
  )
  const reportDirectory = path.join(stateDirectory, REPORT_DIRECTORY)
  const statePath = path.join(stateDirectory, STATE_FILENAME)
  await fs.mkdir(reportDirectory, { mode: 0o700, recursive: true })

  const inventory = await inventoryMedia(
    productService,
    catalogService,
    newsService
  )
  const fingerprint = sourceFingerprint(inventory.sources.keys())
  const inventoryReport = buildInventoryReport(inventory)
  const inventoryPath = path.join(
    reportDirectory,
    `inventory-${fingerprint.slice(0, 12)}.json`
  )
  await writeJsonAtomically(inventoryPath, inventoryReport)
  const mode = options.apply ? "apply" : options.stage ? "stage" : "dry-run"
  logger.info(
    `[managed-media] mode=${mode} sources=${inventory.sources.size} master=${managedMediaUsagePlan.masterWidth}px report=${inventoryPath}`
  )

  if (!options.apply && !options.stage) {
    const probeSources = Array.from(inventory.sources.keys())
      .sort()
      .slice(0, Math.min(options.probeCount, options.maxAssets ?? Infinity))
    if (probeSources.length) {
      const scheduler = new PoliteHostScheduler(options.minDelayMs)
      for (const [index, sourceUrl] of probeSources.entries()) {
        const downloaded = await downloadMedia(sourceUrl, scheduler, options)
        logger.info(
          `[managed-media] probe ${index + 1}/${probeSources.length} source=${downloaded.source.image.width}x${downloaded.source.image.height}/${downloaded.source.byteSize}B/${downloaded.source.image.mimeType} normalized=${downloaded.image.width}x${downloaded.image.height}/${downloaded.buffer.length}B/${downloaded.image.mimeType}`
        )
      }
    }
    logger.info(
      `[managed-media] Dry run complete. No files or database records were changed.`
    )
    return
  }

  const state = await loadState(statePath)
  const selectedSources = options.stage
    ? new Map(
        Array.from(inventory.sources.entries())
          .sort(([left], [right]) => left.localeCompare(right))
          .slice(0, options.maxAssets ?? Infinity)
      )
    : inventory.sources
  await stageManagedMedia(
    selectedSources,
    state,
    statePath,
    fileModuleService,
    options,
    (completed, total) => {
      if (completed === total || completed % 25 === 0) {
        logger.info(`[managed-media] staged ${completed}/${total}`)
      }
    }
  )
  if (options.stage) {
    logger.info(
      `[managed-media] Staging complete for ${selectedSources.size} source(s). No database references were changed. state=${statePath}`
    )
    return
  }

  const missing = Array.from(inventory.sources.keys()).filter(
    (sourceUrl) => !state.entries[sourceUrl]
  )
  if (missing.length) {
    throw new Error(
      `${missing.length} required source(s) are not staged; refusing cutover.`
    )
  }

  const productCount = await updateNativeProducts(container, inventory, state)
  const catalogCounts = await updateCatalogMedia(
    catalogService,
    inventory,
    state
  )
  const editorialCounts = await updateEditorialMedia(
    newsService,
    inventory,
    state
  )

  const parityInventory = await inventoryMedia(
    productService,
    catalogService,
    newsService
  )
  const report = {
    catalog: catalogCounts,
    completedAt: new Date().toISOString(),
    editorial: editorialCounts,
    fingerprint,
    managedSourceCount: inventory.sources.size,
    nativeProductsUpdated: productCount,
    unresolvedBigCartelSourceCount: parityInventory.sources.size,
    unresolvedSources: Array.from(parityInventory.sources.keys()).sort(),
  }
  const reportPath = path.join(
    reportDirectory,
    `cutover-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  )
  await writeJsonAtomically(reportPath, report)
  if (parityInventory.sources.size) {
    throw new Error(
      `Cutover left ${parityInventory.sources.size} Big Cartel source(s). See ${reportPath}.`
    )
  }
  logger.info(
    `[managed-media] Cutover complete with zero Big Cartel runtime references. report=${reportPath}`
  )
}
