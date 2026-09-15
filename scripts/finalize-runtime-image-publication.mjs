import assert from "node:assert/strict"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createRecoveryScope } from "./lib/recovery-process.mjs"
import {
  decodeEvidence,
  evidenceDigest,
  runRuntimeEvidenceCommand,
  writeEvidenceFile,
} from "./lib/runtime-image-evidence.mjs"
import {
  validatePublishedDescriptor,
  validatePublishedManifest,
  validateRuntimeImageRecord,
  verifyRuntimeImageArtifacts,
} from "./verify-runtime-image-artifacts.mjs"

// Read-only registry inspection. Publication remains the workflow's explicit
// master-only step. Fetch raw bytes by the independently observed descriptor.
export const finalizeRuntimeImagePublication = async (
  recordPath,
  { environment = process.env, run = runRuntimeEvidenceCommand, signal } = {}
) => {
  const directory = dirname(resolve(recordPath))
  const scope = createRecoveryScope(120000)
  try {
    const local = await verifyRuntimeImageArtifacts(recordPath)
    assert.equal(local.publication, null)
    assert.ok(
      isAbsolute(environment.HOME) &&
        typeof environment.PATH === "string" &&
        environment.PATH.length > 0 &&
        environment.PATH.length <= 32768 &&
        !/[\u0000-\u001f\u007f]/u.test(environment.PATH)
    )
    const childEnvironment = {
      HOME: environment.HOME,
      PATH: environment.PATH,
      LANG: "C",
    }
    const activeSignal = signal
      ? AbortSignal.any([signal, scope.signal])
      : scope.signal
    const execute = (args) =>
      run("docker", ["buildx", "imagetools", "inspect", ...args], {
        environment: childEnvironment,
        signal: activeSignal,
      })
    const descriptorSource = await execute([
      "--format",
      "{{json .Manifest}}",
      local.image,
    ])
    const descriptor = decodeEvidence(descriptorSource)
    assert.match(descriptor.digest, /^sha256:[a-f0-9]{64}$/u)
    const source = await execute([
      "--raw",
      `${local.subject}@${descriptor.digest}`,
    ])
    validatePublishedDescriptor(descriptor, source, local)
    assert.deepEqual(await verifyRuntimeImageArtifacts(recordPath), local)
    const published = {
      ...local,
      digest: validatePublishedManifest(source, local),
      publication: {
        manifest: evidenceDigest(`${local.service}.manifest.json`, source),
        descriptor: evidenceDigest(
          `${local.service}.descriptor.json`,
          descriptorSource
        ),
      },
    }
    validateRuntimeImageRecord(published)
    activeSignal.throwIfAborted()
    await writeEvidenceFile(
      directory,
      published.publication.manifest.file,
      source
    )
    await writeEvidenceFile(
      directory,
      published.publication.descriptor.file,
      descriptorSource
    )
    await writeEvidenceFile(
      directory,
      `${local.service}.published.image.json`,
      `${JSON.stringify(published, null, 2)}\n`
    )
    await verifyRuntimeImageArtifacts(
      join(directory, `${local.service}.published.image.json`)
    )
    activeSignal.throwIfAborted()
    return published
  } catch (error) {
    try {
      await writeEvidenceFile(
        directory,
        "publication-failure.json",
        `${JSON.stringify({ event: "runtime.publication.failed" })}\n`
      )
    } catch {
      /* Preserve any existing evidence or replaced directory. */
    }
    throw error
  } finally {
    scope.close()
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    assert.equal(
      process.argv.length,
      3,
      "Usage: node scripts/finalize-runtime-image-publication.mjs <local-record.json>"
    )
    const record = await finalizeRuntimeImagePublication(process.argv[2])
    console.log(`digest=${record.digest}`)
  } catch {
    console.error("Runtime image publication evidence rejected.")
    process.exitCode = 1
  }
}
