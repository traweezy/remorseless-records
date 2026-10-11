import { constants } from "node:fs"
import { open, realpath } from "node:fs/promises"
import { resolve, sep } from "node:path"

const maximumBytes = 32 * 1_024 * 1_024
const unsafeOpenCodes = new Set([
  "ELOOP",
  "ENOENT",
  "ENOTDIR",
  "EISDIR",
  "ENXIO",
])

/** Read one Linux fixture descriptor without reopening a checked pathname. */
export const readPinnedNativeAsset = async (root, name) => {
  const filename = resolve(root, name)
  if (
    !filename.startsWith(`${root}${sep}`) ||
    filename.split(sep).includes("Default")
  )
    return null
  let handle
  try {
    // Reject a leaf symlink atomically; nonblocking open also bounds FIFO input.
    handle = await open(
      filename,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    const descriptorPath = `/proc/self/fd/${handle.fd}`
    const stat = await handle.stat()
    if (
      !stat.isFile() ||
      !Number.isSafeInteger(stat.size) ||
      stat.size > maximumBytes ||
      (await realpath(descriptorPath)) !== filename
    )
      return null
    // An extra byte detects growth without reading an unbounded changing file.
    const buffer = Buffer.alloc(stat.size + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        length
      )
      if (!bytesRead) break
      length += bytesRead
    }
    if (
      length !== stat.size ||
      (await handle.stat()).size !== stat.size ||
      (await realpath(descriptorPath)) !== filename
    )
      return null
    return buffer.subarray(0, length)
  } catch (error) {
    if (unsafeOpenCodes.has(error.code)) return null
    throw error
  } finally {
    await handle?.close()
  }
}
