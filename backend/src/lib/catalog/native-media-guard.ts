import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ILockingModule, Logger } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"

import type CatalogModuleService from "../../modules/catalog/service"
import { sendApiProblem } from "../http/correlation"
import { rejectCatalogHardDeletion } from "./hard-deletion"
import {
  asUnknownRecord,
  readProviderDataRecords,
  readRecordArray,
} from "../provider-boundary/records"

export type NativeMediaMutationRoute =
  | "product"
  | "products-batch"
  | "variant"
  | "variants-batch"
  | "variant-images"
  | "image-variants"

export type NativeMediaTarget = {
  productId: string
  variantIds: Set<string>
  imageIds: Set<string>
}

type CatalogService = Pick<
  InstanceType<typeof CatalogModuleService>,
  "listCatalogProductProfiles" | "listCatalogProductMediaItems"
>

type NativeQuery = {
  graph: (input: {
    entity: string
    fields: string[]
    filters: { id: string | string[]; product_id?: string }
    pagination: { take: number }
  }) => Promise<unknown>
}

const maximumTargets = 100
const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/u
const invalid: () => never = () => {
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    "The native artwork update has invalid or too many targets."
  )
}
const id = (value: unknown, prefix: string): string =>
  typeof value === "string" &&
  value.startsWith(prefix) &&
  identifier.test(value)
    ? value
    : invalid()

const mediaTargetCollector = (maximumMutations: number) => {
  if (!Number.isSafeInteger(maximumMutations) || maximumMutations < 1) invalid()
  const targets = new Map<string, NativeMediaTarget>()
  let mutationCount = 0
  const target = (productId: unknown): NativeMediaTarget => {
    if (++mutationCount > maximumMutations) invalid()
    const product = id(productId, "prod_")
    const existing = targets.get(product)
    if (existing) return existing
    const created = {
      productId: product,
      variantIds: new Set<string>(),
      imageIds: new Set<string>(),
    }
    targets.set(product, created)
    return created
  }
  const variant = (productId: unknown, variantId: unknown) => {
    target(productId).variantIds.add(id(variantId, "variant_"))
  }
  const variants = (productId: unknown, value: unknown) => {
    if (value === undefined) return
    for (const item of readRecordArray(value, { context: "Native variants" })) {
      if (!Object.hasOwn(item, "thumbnail")) continue
      // Native Product updates also upsert new Variants without an ID. Their
      // parent still owns managed artwork; existing IDs must bind that parent.
      if (item.id === undefined) target(productId)
      else variant(productId, item.id)
    }
  }
  const product = (productId: unknown, value: Record<string, unknown>) => {
    if (Object.hasOwn(value, "thumbnail")) target(productId)
    variants(productId, value.variants)
  }
  return {
    variant,
    variants,
    product,
    targets,
    result: () =>
      [...targets.values()].sort((a, b) =>
        a.productId.localeCompare(b.productId)
      ),
  }
}

// The native HTTP batch bound stays 100. Parsed CSV plans use their existing
// import-operation bound instead; neither path reconstructs a fake request.
export const nativeProductMediaMutationTargets = (
  updates: unknown,
  maximumMutations = maximumTargets
): NativeMediaTarget[] => {
  const collector = mediaTargetCollector(maximumMutations)
  for (const item of readRecordArray(updates, {
    context: "Native product updates",
  }))
    collector.product(item.id, item)
  return collector.result()
}

// Called after Medusa's native validator. Only thumbnail assignments and image
// removals can alter the thumbnail projection; other native edits are untouched.
export const nativeMediaMutationTargets = (
  req: Pick<MedusaRequest, "params" | "validatedBody">,
  route: NativeMediaMutationRoute
): NativeMediaTarget[] => {
  const body = asUnknownRecord(req.validatedBody) ?? invalid()
  const { variant, variants, product, targets, result } =
    mediaTargetCollector(maximumTargets)

  switch (route) {
    case "product":
      product(req.params.id, body)
      break
    case "products-batch":
      for (const item of readRecordArray(body.update ?? [], {
        context: "Native product updates",
      }))
        product(item.id, item)
      break
    case "variant":
      if (Object.hasOwn(body, "thumbnail")) {
        variant(req.params.id, req.params.variant_id)
      }
      break
    case "variants-batch":
      variants(req.params.id, body.update)
      break
    case "variant-images": {
      const removed = body.remove ?? []
      if (!Array.isArray(removed)) invalid()
      if (removed.length) {
        variant(req.params.id, req.params.variant_id)
        const item = targets.get(id(req.params.id, "prod_"))!
        for (const image of removed) {
          if (item.imageIds.size >= maximumTargets) invalid()
          item.imageIds.add(id(image, "img_"))
        }
      }
      break
    }
    case "image-variants": {
      const removed = body.remove ?? []
      if (!Array.isArray(removed)) invalid()
      for (const variantId of removed) variant(req.params.id, variantId)
      if (removed.length) {
        targets
          .get(id(req.params.id, "prod_"))!
          .imageIds.add(id(req.params.image_id, "img_"))
      }
      break
    }
  }
  return result()
}

const unavailable: () => never = () => {
  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "The artwork ownership lookup returned invalid structured data."
  )
}

const verifyNativeIdentity = async (
  query: NativeQuery,
  target: NativeMediaTarget
) => {
  const verify = async (entity: string, ids: string[], parent: boolean) => {
    if (!ids.length) return
    const rows = readProviderDataRecords(
      await query.graph({
        entity,
        fields: parent ? ["id", "product_id"] : ["id"],
        filters: parent
          ? { id: ids, product_id: target.productId }
          : { id: ids },
        pagination: { take: ids.length + 1 },
      }),
      "Native artwork identity"
    )
    const expected = new Set(ids)
    for (const row of rows) {
      if (
        typeof row.id !== "string" ||
        !expected.delete(row.id) ||
        (parent && row.product_id !== target.productId)
      )
        unavailable()
    }
    if (expected.size) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "The artwork target was not found for this product."
      )
    }
  }
  await verify("product", [target.productId], false)
  await verify("variant", [...target.variantIds], true)
  await verify("product_image", [...target.imageIds], true)
}

const isManaged = async (catalog: CatalogService, productId: string) => {
  const profiles = readRecordArray(
    await catalog.listCatalogProductProfiles(
      { product_id: productId },
      { select: ["id", "product_id", "version"], take: 2 }
    ),
    { context: "Catalog artwork ownership" }
  )
  if (profiles.length > 1) unavailable()
  for (const row of profiles) {
    if (
      typeof row.id !== "string" ||
      !row.id.startsWith("cprof_") ||
      !identifier.test(row.id) ||
      row.product_id !== productId ||
      typeof row.version !== "number" ||
      !Number.isSafeInteger(row.version) ||
      row.version < 1
    )
      unavailable()
  }
  if (profiles.length) return true
  const media = readRecordArray(
    await catalog.listCatalogProductMediaItems(
      { product_id: productId },
      { select: ["id", "product_id"], take: 1 }
    ),
    { context: "Catalog artwork ownership" }
  )
  if (media.length > 1) unavailable()
  for (const row of media) {
    if (
      typeof row.id !== "string" ||
      !row.id.startsWith("cpmedia_") ||
      !identifier.test(row.id) ||
      row.product_id !== productId
    )
      unavailable()
  }
  return media.length > 0
}

export const checkNativeMediaOwnership = async (
  req: MedusaRequest<unknown, unknown>,
  res: MedusaResponse,
  targets: NativeMediaTarget[]
): Promise<boolean> => {
  const query = req.scope.resolve<NativeQuery>(ContainerRegistrationKeys.QUERY)
  const catalog = req.scope.resolve<CatalogService>("catalog")
  for (const target of targets) {
    await verifyNativeIdentity(query, target)
    if (await isManaged(catalog, target.productId)) {
      res.setHeader("Cache-Control", "private, no-store")
      // The shared problem helper does not consume the route's query type.
      sendApiProblem(req as MedusaRequest, res, {
        code: "catalog_media_authoring_required",
        title: "Artwork is managed in Catalog",
        status: 409,
        detail:
          "Edit this product’s artwork in Catalog. Native product and variant thumbnails are synchronized from managed media.",
        instance: req.path,
      })
      return false
    }
  }
  return true
}

export type NativeMediaOperationResult<Value> =
  | { executed: false }
  | { executed: true; value: Value }

const leaseSeconds = 120
const releaseDeadlineMs = 2_000

const releaseNativeMediaLease = async (
  req: MedusaRequest<unknown, unknown>,
  locking: ILockingModule,
  keys: string[],
  ownerId: string,
  warnIfUnowned = true
): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  let released = false
  let cleanupFailed = false
  try {
    released = await Promise.race([
      locking.release(keys, { ownerId }).catch(() => {
        cleanupFailed = true
        return false
      }),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => {
          cleanupFailed = true
          resolve(false)
        }, releaseDeadlineMs)
      }),
    ])
  } catch {
    cleanupFailed = true
    // Preserve the operation's result or original error on transport failure.
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (cleanupFailed || (!released && warnIfUnowned)) {
    try {
      req.scope
        .resolve<Logger>(ContainerRegistrationKeys.LOGGER)
        .warn(
          "Native artwork lease cleanup failed or timed out; its 120-second lease will expire."
        )
    } catch {
      // Logging must not change a completed native mutation's outcome.
    }
  }
  return !cleanupFailed
}

const acquireNativeMediaLease = async (
  req: MedusaRequest<unknown, unknown>,
  locking: ILockingModule,
  keys: string[],
  ownerId: string
): Promise<void> => {
  let expired = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const retryController = new AbortController()
  const timeout = () =>
    new MedusaError(MedusaError.Types.CONFLICT, "Timed-out acquiring lock.")
  const acquire = async () => {
    let retryInterval = 20
    while (true) {
      try {
        // The installed public acquire API is immediate. Its private queued
        // mode has no cancellation; use sorted, bounded retries instead.
        for (const key of keys) {
          if (expired) throw timeout()
          // Medusa 2.18's Redis provider supports this option although the
          // module's narrower public type omits it. Pin its immediate mode.
          const options = { ownerId, expire: leaseSeconds, awaitQueue: false }
          await locking.acquire(key, options)
          if (expired) throw timeout()
        }
        return
      } catch (error) {
        // Also runs when an in-flight Redis command settles after the deadline.
        // A unique owner prevents this late cleanup from releasing a new writer.
        const cleanedUp = await releaseNativeMediaLease(
          req,
          locking,
          keys,
          ownerId,
          false
        )
        if (expired) throw timeout()
        // Never reuse this owner for another acquisition attempt while a late
        // cleanup could still delete its lease. Uncertain cleanup fails closed.
        if (!cleanedUp) throw error
        if (
          !(error instanceof MedusaError) ||
          error.type !== MedusaError.Types.CONFLICT
        )
          throw error
        try {
          await delay(retryInterval * (0.5 + Math.random() * 0.5), undefined, {
            signal: retryController.signal,
          })
        } catch (error) {
          if (expired) throw timeout()
          throw error
        }
        retryInterval = Math.min(retryInterval * 2, 1_000)
      }
    }
  }
  try {
    await Promise.race([
      acquire(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          expired = true
          retryController.abort()
          void releaseNativeMediaLease(req, locking, keys, ownerId, false)
          reject(timeout())
        }, leaseSeconds * 1_000)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const guardNativeMediaOperation = async <Value>(
  req: MedusaRequest<unknown, unknown>,
  res: MedusaResponse,
  targets: NativeMediaTarget[],
  operation: () => Promise<Value>
): Promise<NativeMediaOperationResult<Value>> => {
  if (!targets.length) {
    return { executed: true, value: await operation() }
  }
  const locking = req.scope.resolve<ILockingModule>(Modules.LOCKING)
  const keys = [
    ...new Set(
      targets.map(({ productId }) => `catalog:product-media:${productId}`)
    ),
  ].sort()
  const ownerId = randomUUID()
  await acquireNativeMediaLease(req, locking, keys, ownerId)
  // Same bounded lease as Catalog adoption/projection. Await the actual native
  // workflow, not response finish/close: a disconnected client can still write.
  try {
    if (!(await checkNativeMediaOwnership(req, res, targets)))
      return { executed: false }
    return { executed: true, value: await operation() }
  } finally {
    await releaseNativeMediaLease(req, locking, keys, ownerId)
  }
}

export const guardNativeMediaHandler =
  <
    Request extends MedusaRequest<unknown, unknown>,
    Response extends MedusaResponse,
  >(
    route: NativeMediaMutationRoute,
    nativeHandler: (req: Request, res: Response) => Promise<void>
  ) =>
  async (req: Request, res: Response): Promise<void> => {
    if (route === "products-batch" || route === "variants-batch") {
      const body = asUnknownRecord(req.validatedBody) ?? invalid()
      if (body.delete !== undefined) {
        if (!Array.isArray(body.delete)) invalid()
        if (body.delete.length) {
          rejectCatalogHardDeletion(
            req as MedusaRequest,
            res,
            route === "products-batch" ? "products" : "product variants"
          )
          return
        }
      }
    }
    const targets = nativeMediaMutationTargets(req, route)
    await guardNativeMediaOperation(req, res, targets, () =>
      nativeHandler(req, res)
    )
  }
