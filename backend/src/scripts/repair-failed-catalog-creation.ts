import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"

import { verifyFailedCreationRepairTarget } from "@/lib/catalog/failed-creation-repair-target"

export { verifyFailedCreationRepairTarget } from "@/lib/catalog/failed-creation-repair-target"

import {
  inspectFailedCatalogCreation,
  repairFailedCatalogCreation,
} from "@/lib/catalog/failed-creation-repair"

const optionsSchema = z
  .object({
    sha: z.string().regex(/^[a-f0-9]{40}$/u),
    creationOperationId: z.string().regex(/^catop_[A-Za-z0-9_-]{1,248}$/u),
    productId: z.string().regex(/^prod_[A-Za-z0-9_-]{1,248}$/u),
    expectedManifestSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    idempotencyKey: z.uuid().optional(),
    apply: z.boolean(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.apply !==
        Boolean(input.expectedManifestSha256 && input.idempotencyKey) ||
      (!input.apply && (input.expectedManifestSha256 || input.idempotencyKey))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Apply requires the reviewed manifest and a new idempotency key; preview accepts neither.",
      })
    }
  })

export const parseFailedCreationRepairArguments = (args: string[]) => {
  const names = new Map([
    ["--sha", "sha"],
    ["--creation-operation-id", "creationOperationId"],
    ["--product-id", "productId"],
    ["--manifest-sha256", "expectedManifestSha256"],
    ["--idempotency-key", "idempotencyKey"],
  ])
  const options: Record<string, unknown> = { apply: false }
  for (const argument of args) {
    if (argument === "--apply" && options.apply === false) {
      options.apply = true
      continue
    }
    const separator = argument.indexOf("=")
    const name = names.get(argument.slice(0, separator))
    if (separator < 0 || !name || name in options)
      throw new Error("Unknown or duplicate repair argument.")
    options[name] = argument.slice(separator + 1)
  }
  return optionsSchema.parse(options)
}

export default async function repairFailedCreation({
  container,
  args,
}: ExecArgs): Promise<void> {
  const options = parseFailedCreationRepairArguments(args)
  verifyFailedCreationRepairTarget(process.env, options.sha)
  const identity = {
    creationOperationId: options.creationOperationId,
    productId: options.productId,
  }
  const result = options.apply
    ? await repairFailedCatalogCreation(container, {
        ...identity,
        expectedManifestSha256: options.expectedManifestSha256!,
        idempotencyKey: options.idempotencyKey!,
      })
    : await inspectFailedCatalogCreation(container, identity)
  container.resolve(ContainerRegistrationKeys.LOGGER).info(
    JSON.stringify({
      action: "catalog.failed-creation.repair",
      mode: options.apply ? "apply" : "preview",
      sha: options.sha,
      ...result,
    })
  )
}
