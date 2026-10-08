import { z } from "zod"

import {
  AdminRequestError,
  requestAdminJson,
  type AdminSdkClient,
} from "../../../lib/admin-request"

const id = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_-]{1,248}$`, "u"))
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const unique = (values: readonly string[]): boolean =>
  new Set(values).size === values.length
const ids = (prefix: string, minimum = 0) =>
  z.array(id(prefix)).min(minimum).max(100).refine(unique)

export const repairContextSchema = z
  .object({
    backendOrigin: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value)
        return /^(https?:)$/u.test(url.protocol) && url.origin === value
      }),
    creationOperationId: id("catop"),
    productId: id("prod"),
    sha: z.string().regex(/^[a-f0-9]{40}$/u),
  })
  .strict()

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    creationOperationId: id("catop"),
    productId: id("prod"),
    nativeProductAbsent: z.literal(true),
    nativeVariantsAbsent: ids("variant", 1),
    creation: z
      .object({
        id: id("catop"),
        status: z.literal("compensated"),
        rowSha256: digest,
      })
      .strict(),
    profile: z
      .object({ id: id("cprof"), version: z.literal(1), rowSha256: digest })
      .strict(),
    variants: z
      .array(
        z
          .object({
            id: id("cvprof"),
            variantId: id("variant"),
            version: z.literal(1),
            rowSha256: digest,
          })
          .strict()
      )
      .min(1)
      .max(100),
    media: z
      .array(
        z
          .object({
            id: id("cpmedia"),
            assetId: id("cmedia"),
            rowSha256: digest,
          })
          .strict()
      )
      .min(1)
      .max(100),
    assets: z
      .array(
        z
          .object({
            id: id("cmedia"),
            version: z.number().int().positive(),
            rowSha256: digest,
          })
          .strict()
      )
      .min(1)
      .max(100),
    children: z
      .array(
        z
          .object({
            id: id("catop"),
            command: z.enum([
              "catalog.product-profile.upsert",
              "catalog.variant-profile.upsert",
              "catalog.product-media.replace",
            ]),
            status: z.literal("succeeded"),
            rowSha256: digest,
          })
          .strict()
      )
      .min(3)
      .max(102),
  })
  .strict()
  .refine(
    (manifest) =>
      manifest.creation.id === manifest.creationOperationId &&
      unique(manifest.variants.map((row) => row.id)) &&
      unique(manifest.variants.map((row) => row.variantId)) &&
      unique(manifest.media.map((row) => row.id)) &&
      unique(manifest.assets.map((row) => row.id)) &&
      unique(manifest.children.map((row) => row.id)) &&
      sameIds(
        manifest.nativeVariantsAbsent,
        manifest.variants.map((row) => row.variantId)
      ) &&
      sameIds(
        [...new Set(manifest.media.map((row) => row.assetId))],
        manifest.assets.map((row) => row.id)
      ) &&
      manifest.children.length === manifest.variants.length + 2 &&
      manifest.children.every(
        (row) => row.id !== manifest.creationOperationId
      ) &&
      manifest.children.filter(
        (row) => row.command === "catalog.product-profile.upsert"
      ).length === 1 &&
      manifest.children.filter(
        (row) => row.command === "catalog.product-media.replace"
      ).length === 1 &&
      manifest.children.filter(
        (row) => row.command === "catalog.variant-profile.upsert"
      ).length === manifest.variants.length
  )

export const repairPreviewSchema = z
  .object({
    actorId: id("user"),
    manifestSha256: digest,
    manifest: manifestSchema,
  })
  .strict()

export const repairBodySchema = z
  .object({
    productId: id("prod"),
    sha: z.string().regex(/^[a-f0-9]{40}$/u),
    expectedActorId: id("user"),
    expectedManifestSha256: digest,
    idempotencyKey: z.uuid(),
  })
  .strict()

export const repairResultSchema = z
  .object({
    operationId: id("catop"),
    replayed: z.boolean(),
    result: z
      .object({
        creationOperationId: id("catop"),
        productId: id("prod"),
        manifestSha256: digest,
        profileId: id("cprof"),
        variantProfileIds: ids("cvprof", 1),
        mediaLinkIds: ids("cpmedia", 1),
        retainedAssetIds: ids("cmedia", 1),
      })
      .strict(),
  })
  .strict()

export type RepairContext = z.infer<typeof repairContextSchema>
export type RepairPreview = z.infer<typeof repairPreviewSchema>
export type RepairBody = z.infer<typeof repairBodySchema>
export type RepairResult = z.infer<typeof repairResultSchema>
export type RepairRequestOptions = {
  client?: AdminSdkClient
  signal?: AbortSignal
  isCurrent?: () => boolean
}

export const sameIds = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  [...left].sort().every((value, index) => value === [...right].sort()[index])

export const assertCurrentRepairResponse = (
  options: RepairRequestOptions
): void => {
  if (options.signal?.aborted || options.isCurrent?.() === false)
    throw new AdminRequestError("The repair context changed.", "cancelled")
}

export const fetchRepairActor = async (
  options: RepairRequestOptions = {}
): Promise<string> => {
  const response = await requestAdminJson({
    path: "/admin/users/me",
    schema: z.object({ user: z.object({ id: id("user") }) }),
    ...(options.client ? { client: options.client } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  })
  assertCurrentRepairResponse(options)
  return response.user.id
}

export const fetchRepairPreview = async (
  context: RepairContext,
  options: RepairRequestOptions = {}
): Promise<RepairPreview> => {
  const parsed = repairContextSchema.parse(context)
  const actorId = await fetchRepairActor(options)
  const preview = await requestAdminJson({
    path: `/admin/catalog/failed-creations/${parsed.creationOperationId}`,
    query: { productId: parsed.productId, sha: parsed.sha },
    schema: repairPreviewSchema,
    ...(options.client ? { client: options.client } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  })
  assertCurrentRepairResponse(options)
  if (
    preview.actorId !== actorId ||
    preview.manifest.creationOperationId !== parsed.creationOperationId ||
    preview.manifest.productId !== parsed.productId
  )
    throw new AdminRequestError(
      "The signed-in administrator or repair target changed. Preview again.",
      "invalid-response"
    )
  return preview
}

export const postRepair = async (
  context: RepairContext,
  body: RepairBody,
  options: RepairRequestOptions = {}
): Promise<RepairResult> => {
  const parsed = repairContextSchema.parse(context)
  const request = repairBodySchema.parse(body)
  if (request.productId !== parsed.productId || request.sha !== parsed.sha)
    throw new Error("The repair request does not match its reviewed target.")
  assertCurrentRepairResponse(options)
  return requestAdminJson({
    path: `/admin/catalog/failed-creations/${parsed.creationOperationId}`,
    method: "POST",
    body: request,
    schema: repairResultSchema,
    ...(options.client ? { client: options.client } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  })
}
