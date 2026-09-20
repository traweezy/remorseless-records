const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const {
  readExistingRegularFile,
  updateExistingRegularFile,
} = require("./secure-file-operations")

const MAX_FILES = 2000
const MAX_FILE_BYTES = 1024 * 1024
const STATIC_ALIAS_CALL =
  /\b(require|import|jest\.(?:mock|requireActual))\(\s*(["'])@\/([^"'\\\r\n]+)\2(?=\s*(?:,|\)))/gu
const ALIAS_MARKER = /["'`]@\//u

const listCompiledFiles = (sourceRoot) => {
  const pending = [sourceRoot]
  const files = []
  let seen = 0
  while (pending.length) {
    const directory = pending.pop()
    const directoryStatus = fs.lstatSync(directory)
    assert.ok(
      directoryStatus.isDirectory() && !directoryStatus.isSymbolicLink()
    )
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      seen += 1
      assert.ok(seen <= MAX_FILES, "Compiled source tree exceeds bound.")
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) pending.push(entryPath)
      else if (entry.isFile() && entry.name.endsWith(".js"))
        files.push(entryPath)
      else if (entry.isSymbolicLink())
        throw new Error("Compiled source contains a symbolic link.")
    }
  }
  return files.sort()
}

const resolvedTarget = (sourceRoot, alias) => {
  const parts = alias.split("/")
  assert.ok(
    parts.length > 0 &&
      parts.every(
        (part) =>
          part !== "." && part !== ".." && /^[a-zA-Z0-9_\[\].-]+$/u.test(part)
      ),
    "Runtime alias has an invalid or traversing path."
  )
  const base = path.join(sourceRoot, ...parts)
  for (const candidate of [`${base}.js`, path.join(base, "index.js")]) {
    try {
      const metadata = fs.lstatSync(candidate)
      if (metadata.isFile() && !metadata.isSymbolicLink()) return candidate
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
  }
  throw new Error("Runtime alias has no compiled JavaScript target.")
}

const rewriteSource = (source, filePath, sourceRoot) => {
  let replacements = 0
  const updated = source.replace(
    STATIC_ALIAS_CALL,
    (_full, call, quote, alias) => {
      const target = resolvedTarget(sourceRoot, alias)
      const relative = path.relative(path.dirname(filePath), target)
      assert.ok(relative && !path.isAbsolute(relative))
      const specifier = relative.startsWith(".") ? relative : `./${relative}`
      replacements += 1
      return `${call}(${quote}${specifier.replaceAll(path.sep, "/")}${quote}`
    }
  )
  assert.ok(!ALIAS_MARKER.test(updated), "Dynamic or unresolved runtime alias.")
  return { updated, replacements }
}

const rewriteRuntimeAliases = (serverRoot) => {
  const sourceRoot = path.join(serverRoot, "src")
  const files = listCompiledFiles(sourceRoot)
  const plans = files.map((filePath) => {
    const metadata = fs.lstatSync(filePath)
    assert.ok(metadata.isFile() && !metadata.isSymbolicLink())
    assert.ok(metadata.size <= MAX_FILE_BYTES)
    const original = readExistingRegularFile(filePath, "utf8")
    const { updated, replacements } = rewriteSource(
      original,
      filePath,
      sourceRoot
    )
    return { filePath, original, updated, replacements }
  })
  let count = 0
  for (const plan of plans) {
    if (plan.replacements === 0) continue
    updateExistingRegularFile(plan.filePath, (current) => {
      assert.equal(
        current,
        plan.original,
        "Compiled file changed during rewrite."
      )
      return plan.updated
    })
    count += plan.replacements
  }
  return { files: files.length, aliases: count }
}

module.exports = { rewriteRuntimeAliases, rewriteSource }
