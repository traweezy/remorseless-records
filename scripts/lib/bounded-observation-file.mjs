import { constants } from "node:fs"
import { open } from "node:fs/promises"

const unavailable = () => new Error("Observation input unavailable.")
const maximumInputBytes = 128 * 1024

export const readBoundedObservationFile = async (
  path,
  maxBytes,
  { openFile = open } = {}
) => {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > maximumInputBytes ||
    !Number.isInteger(constants.O_NOFOLLOW) ||
    !Number.isInteger(constants.O_NONBLOCK)
  )
    throw unavailable()

  let handle
  try {
    // The descriptor, rather than a prior path check, owns both the size and
    // the bytes. NONBLOCK prevents a substituted special file from hanging open.
    handle = await openFile(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || before.size > BigInt(maxBytes)) throw unavailable()

    const buffer = Buffer.allocUnsafe(Math.min(16 * 1024, maxBytes + 1))
    const chunks = []
    let total = 0
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      total += bytesRead
      if (total > maxBytes) throw unavailable()
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
    }

    const after = await handle.stat({ bigint: true })
    if (
      !after.isFile() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      BigInt(total) !== after.size
    )
      throw unavailable()
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, total)
    )
  } catch {
    throw unavailable()
  } finally {
    await handle?.close()
  }
}
