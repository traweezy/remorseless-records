import { randomUUID } from "node:crypto"
import { mkdir, open, realpath, rename, unlink } from "node:fs/promises"
import { basename, isAbsolute, relative, resolve, sep } from "node:path"

type PrivateJsonArtifactInput = {
  baseDirectory: string
  fileName: string
  relativeDirectory: string
  value: unknown
}

const assertContainedPath = (basePath: string, candidatePath: string): void => {
  const relativePath = relative(basePath, candidatePath)
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Artifact directory must be a child of its trusted base.")
  }
}

const assertFileName = (fileName: string): void => {
  if (
    !fileName ||
    fileName === "." ||
    fileName === ".." ||
    basename(fileName) !== fileName
  ) {
    throw new Error(
      "Artifact filename must be a single non-empty path segment."
    )
  }
}

export const writePrivateJsonArtifact = async ({
  baseDirectory,
  fileName,
  relativeDirectory,
  value,
}: PrivateJsonArtifactInput): Promise<string> => {
  assertFileName(fileName)
  if (!relativeDirectory) {
    throw new Error("Artifact directory must be a non-empty relative path.")
  }

  const canonicalBase = await realpath(baseDirectory)
  const artifactDirectory = resolve(canonicalBase, relativeDirectory)
  assertContainedPath(canonicalBase, artifactDirectory)
  await mkdir(artifactDirectory, { mode: 0o700, recursive: true })

  const canonicalArtifactDirectory = await realpath(artifactDirectory)
  if (canonicalArtifactDirectory !== artifactDirectory) {
    throw new Error("Artifact directory must not contain symbolic links.")
  }

  const serialized = JSON.stringify(value, null, 2)
  if (serialized === undefined) {
    throw new Error("Artifact value must be JSON serializable.")
  }

  const artifactPath = resolve(canonicalArtifactDirectory, fileName)
  assertContainedPath(canonicalArtifactDirectory, artifactPath)
  const temporaryPath = resolve(
    canonicalArtifactDirectory,
    `.${fileName}.${randomUUID()}.tmp`
  )
  let temporaryFile: Awaited<ReturnType<typeof open>> | undefined

  try {
    temporaryFile = await open(temporaryPath, "wx", 0o600)
    await temporaryFile.writeFile(`${serialized}\n`, "utf8")
    await temporaryFile.sync()
    await temporaryFile.close()
    temporaryFile = undefined
    await rename(temporaryPath, artifactPath)
  } catch (error) {
    await temporaryFile?.close().catch(() => undefined)
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }

  return artifactPath
}
