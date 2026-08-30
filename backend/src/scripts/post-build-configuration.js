const fs = require("fs")
const path = require("path")

const assertCanonicalPathInside = (rootPath, candidatePath) => {
  const canonicalRoot = fs.realpathSync.native(rootPath)
  const canonicalCandidate = fs.realpathSync.native(candidatePath)
  const relativeCandidate = path.relative(canonicalRoot, canonicalCandidate)
  if (
    relativeCandidate === ".." ||
    relativeCandidate.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeCandidate)
  ) {
    throw new Error("Path escapes the reviewed workspace.")
  }
}

const yamlScalar = (value) => {
  const scalar = JSON.stringify(value)
  if (scalar === undefined) {
    throw new TypeError(
      "pnpm workspace configuration contains an invalid value."
    )
  }
  return scalar
}

const sortedEntries = (mapping) =>
  Object.entries(mapping).sort(([left], [right]) => left.localeCompare(right))

const appendYamlMapping = (lines, mapping, indent = 0) => {
  const prefix = " ".repeat(indent)

  for (const [key, value] of sortedEntries(mapping)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      lines.push(`${prefix}${yamlScalar(key)}:`)
      appendYamlMapping(lines, value, indent + 2)
      continue
    }

    lines.push(`${prefix}${yamlScalar(key)}: ${yamlScalar(value)}`)
  }
}

const rewriteLockfile = (source, importerKey) => {
  if (typeof source !== "string" || typeof importerKey !== "string") {
    throw new TypeError("Lockfile source and importer key must be strings.")
  }

  const lines = source.split(/\r?\n/)
  const importersIndex = lines.findIndex((line) => line.trim() === "importers:")
  if (importersIndex === -1) {
    throw new Error("pnpm lockfile has no importers section.")
  }

  let endIndex = lines.length
  for (let index = importersIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim().length === 0) {
      continue
    }
    if (/^[^\s].*:$/.test(line)) {
      endIndex = index
      break
    }
  }

  let importerIndent = null
  for (let index = importersIndex + 1; index < endIndex; index += 1) {
    const line = lines[index]
    if (line.trim().length === 0) {
      continue
    }
    const match = line.match(/^(\s+)\S.*:$/)
    if (match) {
      importerIndent = match[1]
      break
    }
  }

  if (!importerIndent) {
    throw new Error("pnpm lockfile has no readable importer entries.")
  }

  const importerPattern = new RegExp(`^${importerIndent}(\\S.*):$`)
  const blocks = new Map()
  let currentKey = null
  let blockLines = []

  for (let index = importersIndex + 1; index < endIndex; index += 1) {
    const line = lines[index]
    const match = line.match(importerPattern)
    if (match) {
      if (currentKey) {
        if (blocks.has(currentKey)) {
          throw new Error(`Duplicate pnpm importer: ${currentKey}`)
        }
        blocks.set(currentKey, blockLines)
      }
      currentKey = match[1].trim()
      blockLines = [line]
      continue
    }
    if (currentKey) {
      blockLines.push(line)
    }
  }

  if (currentKey) {
    if (blocks.has(currentKey)) {
      throw new Error(`Duplicate pnpm importer: ${currentKey}`)
    }
    blocks.set(currentKey, blockLines)
  }

  const importerBlock = blocks.get(importerKey)
  if (!importerBlock) {
    throw new Error(`Required pnpm importer not found: ${importerKey}`)
  }

  const normalizedBlock = importerBlock.slice()
  normalizedBlock[0] = `${importerIndent}.:`

  return [
    ...lines.slice(0, importersIndex + 1),
    "",
    ...normalizedBlock,
    "",
    ...lines.slice(endIndex),
  ].join("\n")
}

const renderPnpmWorkspaceConfig = ({
  allowBuilds,
  hoistPattern,
  minimumReleaseAgeExclude,
  overrides,
  packageExtensions,
  resolvePeersFromWorkspaceRoot,
  patchedDependencies,
}) => {
  const lines = ["packages:", '  - "."']

  if (hoistPattern.length > 0) {
    lines.push("", "hoistPattern:")
    for (const pattern of hoistPattern) {
      lines.push(`  - ${yamlScalar(pattern)}`)
    }
  }

  lines.push(
    "",
    `resolvePeersFromWorkspaceRoot: ${yamlScalar(resolvePeersFromWorkspaceRoot)}`
  )

  if (packageExtensions && Object.keys(packageExtensions).length > 0) {
    lines.push("", "packageExtensions:")
    appendYamlMapping(lines, packageExtensions, 2)
  }

  if (Object.keys(allowBuilds).length > 0) {
    lines.push("", "allowBuilds:")
    for (const [dependency, approved] of sortedEntries(allowBuilds)) {
      if (typeof approved !== "boolean") {
        throw new TypeError(`Invalid build approval for ${dependency}.`)
      }
      lines.push(`  ${yamlScalar(dependency)}: ${yamlScalar(approved)}`)
    }
  }

  if (overrides && Object.keys(overrides).length > 0) {
    lines.push("", "overrides:")
    for (const [dependency, version] of sortedEntries(overrides)) {
      lines.push(`  ${yamlScalar(dependency)}: ${yamlScalar(version)}`)
    }
  }

  if (minimumReleaseAgeExclude.length > 0) {
    lines.push("", "minimumReleaseAgeExclude:")
    for (const dependency of [...minimumReleaseAgeExclude].sort()) {
      lines.push(`  - ${yamlScalar(dependency)}`)
    }
  }

  if (patchedDependencies && Object.keys(patchedDependencies).length > 0) {
    lines.push("", "patchedDependencies:")
    for (const [dependency, patchPath] of sortedEntries(patchedDependencies)) {
      lines.push(`  ${yamlScalar(dependency)}: ${yamlScalar(patchPath)}`)
    }
  }

  return `${lines.join("\n")}\n`
}

module.exports = {
  assertCanonicalPathInside,
  renderPnpmWorkspaceConfig,
  rewriteLockfile,
}
