import fs from "node:fs/promises"
import path from "node:path"
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { importProductsAsChunksWorkflow } from "@medusajs/core-flows"

export default async function importProductsFromFile({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const fileModuleService = container.resolve(Modules.FILE) as {
    createFiles: (file: {
      filename: string
      mimeType: string
      content: Buffer | string
    }) => Promise<{ id: string }>
  }

  const [inputPath, providedName] = process.argv.slice(2)

  if (!inputPath) {
    logger.error(
      "No CSV path provided. Usage: medusa exec ./src/scripts/import-products-from-file.ts <csv-path> [display-name]"
    )
    return
  }

  const absolutePath = path.resolve(process.cwd(), inputPath)

  const csv = await fs.readFile(absolutePath)
  const filename = providedName ?? path.basename(absolutePath)

  logger.info(
    `[import-products] Uploading ${absolutePath} as '${filename}' (${csv.length} bytes)`
  )

  const uploaded = await fileModuleService.createFiles({
    filename,
    mimeType: "text/csv",
    content: csv,
  })

  const fileKey = uploaded.id

  logger.info(
    `[import-products] File stored with key '${fileKey}'. Starting import workflow…`
  )

  const { result, transaction } = await importProductsAsChunksWorkflow(
    container
  ).run({
    input: {
      filename,
      fileKey,
    },
  })

  logger.info(
    `[import-products] Workflow dispatched with transaction ${transaction.transactionId}`
  )
  logger.info(
    `[import-products] Summary: toCreate=${result.toCreate} toUpdate=${result.toUpdate}`
  )
}
