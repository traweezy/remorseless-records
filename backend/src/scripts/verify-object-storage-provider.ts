import { deleteFilesWorkflow, uploadFilesWorkflow } from "@medusajs/core-flows"
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const CONFIRMATION = "upload-and-delete-canary"
const CANARY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
)
const DELETE_VERIFICATION_ATTEMPTS = 5

const wait = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })

export default async function verifyObjectStorageProvider({
  container,
}: ExecArgs): Promise<void> {
  if (process.env.OBJECT_STORAGE_WRITE_CHECK_CONFIRM !== CONFIRMATION) {
    throw new Error(
      `Set OBJECT_STORAGE_WRITE_CHECK_CONFIRM=${CONFIRMATION} to run the reversible write check.`
    )
  }

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  let fileId: string | null = null
  let fileUrl: string | null = null
  try {
    const { result } = await uploadFilesWorkflow(container).run({
      input: {
        files: [
          {
            access: "public",
            content: CANARY_PNG.toString("base64"),
            filename: "object-storage-canary.png",
            mimeType: "image/png",
          },
        ],
      },
    })
    const file = result[0]
    if (!file) {
      throw new Error("[storage] Canary upload returned no file.")
    }
    fileId = file.id
    fileUrl = file.url

    const uploaded = await fetch(file.url, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    })
    if (!uploaded.ok) {
      throw new Error("[storage] Canary object was not publicly readable.")
    }
    const content = Buffer.from(await uploaded.arrayBuffer())
    if (!content.equals(CANARY_PNG)) {
      throw new Error("[storage] Canary object content did not round-trip.")
    }
  } finally {
    if (fileId) {
      await deleteFilesWorkflow(container).run({ input: { ids: [fileId] } })
    }
  }

  if (!fileUrl) {
    throw new Error("[storage] Canary URL was unavailable for cleanup check.")
  }
  for (let attempt = 1; attempt <= DELETE_VERIFICATION_ATTEMPTS; attempt += 1) {
    const deleted = await fetch(fileUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    })
    if (deleted.status === 404) {
      logger.info(
        "[storage] Official provider upload/read/delete canary passed."
      )
      return
    }
    await wait(attempt * 200)
  }
  throw new Error(
    "[storage] Canary object still exists after provider deletion."
  )
}
