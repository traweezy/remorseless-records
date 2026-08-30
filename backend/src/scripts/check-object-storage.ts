import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3"
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { resolveObjectStorageConfig } from "../lib/storage/config"

const STORAGE_CHECK_TIMEOUT_MS = 5_000

export default async function checkObjectStorage({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const config = resolveObjectStorageConfig({ required: true })
  if (!config) {
    throw new Error("[storage] Object storage configuration is required.")
  }

  const client = new S3Client({
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: config.endpoint,
    forcePathStyle: true,
    region: config.region,
  })

  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }), {
      abortSignal: AbortSignal.timeout(STORAGE_CHECK_TIMEOUT_MS),
    })
    logger.info(
      `[storage] Verified S3-compatible bucket '${config.bucket}' is reachable.`
    )
  } finally {
    client.destroy()
  }
}
