const fs = require("fs")

const NO_FOLLOW = fs.constants.O_NOFOLLOW ?? 0

const writeAll = (descriptor, contents, filePath) => {
  const buffer = Buffer.isBuffer(contents)
    ? contents
    : Buffer.from(contents, "utf-8")
  let offset = 0
  while (offset < buffer.length) {
    const written = fs.writeSync(
      descriptor,
      buffer,
      offset,
      buffer.length - offset,
      offset
    )
    if (written === 0) {
      throw new Error(`Unable to make progress while writing: ${filePath}`)
    }
    offset += written
  }
}

const createNewRegularFile = (filePath, contents, mode = 0o600) => {
  const descriptor = fs.openSync(
    filePath,
    fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      NO_FOLLOW,
    mode
  )

  try {
    const fileStatus = fs.fstatSync(descriptor)
    if (!fileStatus.isFile()) {
      throw new Error(`Refusing to create non-regular file: ${filePath}`)
    }
    writeAll(descriptor, contents, filePath)
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

const copyNewRegularFile = (sourcePath, targetPath, mode = 0o600) => {
  const sourceDescriptor = fs.openSync(
    sourcePath,
    fs.constants.O_RDONLY | NO_FOLLOW
  )
  try {
    const sourceStatus = fs.fstatSync(sourceDescriptor)
    if (!sourceStatus.isFile()) {
      throw new Error(`Refusing to copy non-regular file: ${sourcePath}`)
    }
    const contents = fs.readFileSync(sourceDescriptor)
    createNewRegularFile(targetPath, contents, mode)
  } finally {
    fs.closeSync(sourceDescriptor)
  }
}

/**
 * @param {string} filePath
 * @param {BufferEncoding | null} [encoding]
 * @returns {Buffer | string}
 */
const readExistingRegularFile = (filePath, encoding = null) => {
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | NO_FOLLOW)
  try {
    const fileStatus = fs.fstatSync(descriptor)
    if (!fileStatus.isFile()) {
      throw new Error(`Refusing to read non-regular file: ${filePath}`)
    }
    return encoding
      ? fs.readFileSync(descriptor, { encoding })
      : fs.readFileSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

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
    writeAll(descriptor, contents, filePath)
    fs.ftruncateSync(descriptor, contents.length)
    fs.fsyncSync(descriptor)
    return true
  } finally {
    fs.closeSync(descriptor)
  }
}

module.exports = {
  copyNewRegularFile,
  createNewRegularFile,
  readExistingRegularFile,
  updateExistingRegularFile,
}
