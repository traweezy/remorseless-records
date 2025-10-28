import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { importProductsAsChunksWorkflow } from "@medusajs/core-flows"

export default async function importProductsFromFile({
  container,
  args = [],
}: ExecArgs): Promise<void> {
  console.log("[import-products] received args", args)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const fileModuleService = container.resolve(Modules.FILE) as {
    createFiles: (file: {
      filename: string
      mimeType: string
      content: Buffer | string
    }) => Promise<{ id: string }>
    getAsBuffer: (id: string) => Promise<Buffer>
  }

  const rawArgs = Array.isArray(args) ? args : []
  const sanitizedArgs = rawArgs.filter((arg) => {
    if (typeof arg !== "string") {
      return false
    }
    const trimmed = arg.trim()
    if (!trimmed.length) {
      return false
    }
    return !(
      trimmed === "./exec" ||
      trimmed === "exec" ||
      trimmed.endsWith("/exec")
    )
  })
  logger.info(
    `[import-products] cli argv ${JSON.stringify(rawArgs)}, sanitized ${JSON.stringify(
      sanitizedArgs
    )}`
  )
  const [inputPath, providedName] = sanitizedArgs

  if (!inputPath) {
    logger.error(
      "No CSV path provided. Usage: medusa exec ./src/scripts/import-products-from-file.ts <csv-path> [display-name]"
    )
    return
  }

  const absolutePath = path.resolve(process.cwd(), inputPath)
  let csv: Buffer
  let filename = providedName ?? path.basename(inputPath)

  if (existsSync(absolutePath)) {
    csv = await fs.readFile(absolutePath)
    filename = providedName ?? path.basename(absolutePath)
  } else {
    logger.info(
      `[import-products] Input path ${inputPath} not found on disk, attempting to read from file provider`
    )

    csv = await fileModuleService.getAsBuffer(inputPath)
    logger.info(`[import-products] Retrieved ${inputPath} from file provider (${csv.length} bytes)`)
    filename = providedName ?? inputPath
  }

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
