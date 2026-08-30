const fs = require("fs")

const NO_FOLLOW = fs.constants.O_NOFOLLOW ?? 0

const updateExistingRegularFile = (
  filePath,
  transform,
  { missingOkay = false } = {}
) => {
  let descriptor
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDWR | NO_FOLLOW)
  } catch (error) {
    if (missingOkay && error?.code === "ENOENT") {
      return false
    }
    throw error
  }

  try {
    const fileStatus = fs.fstatSync(descriptor)
    if (!fileStatus.isFile()) {
      throw new Error(`Refusing to update non-regular file: ${filePath}`)
    }

    const original = fs.readFileSync(descriptor, "utf-8")
    const updated = transform(original)
    if (typeof updated !== "string") {
      throw new TypeError(`File transform must return a string: ${filePath}`)
    }
    if (updated === original) {
      return true
    }

    const contents = Buffer.from(updated, "utf-8")
    let offset = 0
    while (offset < contents.length) {
      const written = fs.writeSync(
        descriptor,
        contents,
        offset,
        contents.length - offset,
        offset
      )
      if (written === 0) {
        throw new Error(`Unable to make progress while updating: ${filePath}`)
      }
      offset += written
    }
    fs.ftruncateSync(descriptor, contents.length)
    fs.fsyncSync(descriptor)
    return true
  } finally {
    fs.closeSync(descriptor)
  }
}

module.exports = { updateExistingRegularFile }
