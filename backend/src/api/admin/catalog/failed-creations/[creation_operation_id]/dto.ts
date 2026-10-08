import { z } from "zod"

import {
  failedCreationRepairCommandSchema,
  failedCreationRepairIdentitySchema,
} from "@/lib/catalog/failed-creation-repair"

const sha = z.string().regex(/^[a-f0-9]{40}$/u)
export const failedCreationPreviewQuerySchema =
  failedCreationRepairIdentitySchema
    .omit({ creationOperationId: true })
    .extend({ sha })
    .strict()
export const failedCreationApplyBodySchema = failedCreationRepairCommandSchema
  .omit({ creationOperationId: true })
  .extend({
    sha,
    expectedActorId: z.string().regex(/^user_[A-Za-z0-9_-]{1,248}$/u),
  })
  .strict()
