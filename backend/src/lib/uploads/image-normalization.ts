import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import path from "node:path"

import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import {
  IMAGE_PROCESSING_TIMEOUT_MS,
  IMAGE_SANDBOX_ADDRESS_SPACE_BYTES,
  IMAGE_SANDBOX_CPU_SECONDS,
  MANAGED_IMAGE_OUTPUT_MIME_TYPE,
  MAX_IMAGE_CHANNELS,
  MAX_IMAGE_FRAMES,
  MAX_IMAGE_INPUT_DIMENSION,
  MAX_IMAGE_OUTPUT_DIMENSION,
  MAX_NORMALIZED_IMAGE_BYTES,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_TOTAL_BYTES,
} from "./constraints"

const PRLIMIT_PATH = "/usr/bin/prlimit"
export const MANAGED_IMAGE_NORMALIZER_VERSION = "sharp-webp-v1" as const
const MAX_WORKER_OUTPUT_BYTES =
  Math.ceil((MAX_NORMALIZED_IMAGE_BYTES * 4) / 3) + 16_384
const MAX_WORKER_ERROR_BYTES = 32 * 1024
const localRequire = createRequire(__filename)

const workerSourceSchema = z
  .object({
    channels: z.number().int().min(1).max(MAX_IMAGE_CHANNELS),
    format: z.enum(["gif", "jpeg", "png", "webp"]),
    frames: z.number().int().min(1).max(MAX_IMAGE_FRAMES),
    height: z.number().int().min(1).max(MAX_IMAGE_INPUT_DIMENSION),
    width: z.number().int().min(1).max(MAX_IMAGE_INPUT_DIMENSION),
  })
  .strict()

const workerResultSchema = z
  .object({
    content: z.string().min(1).max(MAX_WORKER_OUTPUT_BYTES),
    height: z.number().int().min(1).max(MAX_IMAGE_OUTPUT_DIMENSION),
    mimeType: z.literal(MANAGED_IMAGE_OUTPUT_MIME_TYPE),
    size: z.number().int().min(1).max(MAX_NORMALIZED_IMAGE_BYTES),
    source: workerSourceSchema,
    width: z.number().int().min(1).max(MAX_IMAGE_OUTPUT_DIMENSION),
  })
  .strict()

const workerResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      result: workerResultSchema,
    })
    .strict(),
  z
    .object({
      code: z.enum([
        "image_limits_exceeded",
        "invalid_image",
        "invalid_request",
        "normalized_image_invalid",
        "normalized_image_limits_exceeded",
        "processing_failed",
      ]),
      ok: z.literal(false),
    })
    .strict(),
])

export type NormalizedManagedImage = {
  buffer: Buffer
  filename: string
  height: number
  mimeType: typeof MANAGED_IMAGE_OUTPUT_MIME_TYPE
  sha256: string
  size: number
  source: {
    channels: number
    filename: string
    format: "gif" | "jpeg" | "png" | "webp"
    frames: number
    height: number
    mimeType: string
    sha256: string
    size: number
    width: number
  }
  width: number
}

type ImageSandboxCommand = {
  args: string[]
  command: string
  env: NodeJS.ProcessEnv
}

const invalidImage = (message: string): MedusaError =>
  new MedusaError(MedusaError.Types.INVALID_DATA, message)

const unavailableSandbox = (): MedusaError =>
  new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "The managed image safety pipeline is unavailable."
  )

const dependencyRoot = (): string => {
  const sharpEntrypoint = localRequire.resolve("sharp")
  const marker = `${path.sep}node_modules${path.sep}`
  const markerIndex = sharpEntrypoint.indexOf(marker)
  if (markerIndex < 0) {
    throw unavailableSandbox()
  }
  return sharpEntrypoint.slice(0, markerIndex + marker.length - 1)
}

export const buildImageSandboxCommand = (): ImageSandboxCommand => {
  if (process.platform !== "linux") {
    throw unavailableSandbox()
  }
  const workerPath = path.join(__dirname, "image-sandbox-worker.js")
  const moduleRoot = dependencyRoot()
  const runtimeModuleRoot = path.resolve(__dirname, "../../..", "node_modules")
  const readableModuleRoots = Array.from(
    new Set([runtimeModuleRoot, moduleRoot])
  )
  return {
    args: [
      `--as=${IMAGE_SANDBOX_ADDRESS_SPACE_BYTES}:${IMAGE_SANDBOX_ADDRESS_SPACE_BYTES}`,
      `--cpu=${IMAGE_SANDBOX_CPU_SECONDS}:${IMAGE_SANDBOX_CPU_SECONDS}`,
      "--core=0:0",
      "--nofile=64:64",
      "--",
      process.execPath,
      "--permission",
      "--allow-addons",
      `--allow-fs-read=${__dirname}`,
      ...readableModuleRoots.map((root) => `--allow-fs-read=${root}`),
      "--max-old-space-size=192",
      workerPath,
    ],
    command: PRLIMIT_PATH,
    env: {
      MALLOC_ARENA_MAX: "2",
      NODE_ENV: "production",
      SHARP_IGNORE_GLOBAL_LIBVIPS: "1",
      TMPDIR: "/nonexistent",
      UV_THREADPOOL_SIZE: "1",
      VIPS_BLOCK_UNTRUSTED: "1",
      VIPS_CONCURRENCY: "1",
    },
  }
}

const normalizeFilename = (filename: string): string => {
  const extension = path.extname(filename)
  const basename = path
    .basename(filename, extension)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^[.-]+|[.-]+$/gu, "")
    .slice(0, 120)
  return `${basename || "image"}.webp`
}

const runImageSandbox = async (
  file: Express.Multer.File
): Promise<z.infer<typeof workerResultSchema>> => {
  const sandbox = buildImageSandboxCommand()
  const request = JSON.stringify({
    content: file.buffer.toString("base64"),
    declaredMimeType: file.mimetype,
    sourceSize: file.size,
  })

  return new Promise((resolve, reject) => {
    const child = spawn(sandbox.command, sandbox.args, {
      cwd: "/",
      env: sandbox.env,
      stdio: ["pipe", "pipe", "pipe"],
    })
    const stdout: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let timedOut = false

    const rejectOnce = (error: Error): void => {
      if (settled) {
        return
      }
      settled = true
      reject(error)
    }
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, IMAGE_PROCESSING_TIMEOUT_MS)

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_WORKER_OUTPUT_BYTES) {
        child.kill("SIGKILL")
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > MAX_WORKER_ERROR_BYTES) {
        child.kill("SIGKILL")
      }
    })
    child.once("error", () => {
      clearTimeout(timeout)
      rejectOnce(unavailableSandbox())
    })
    child.once("close", (code) => {
      clearTimeout(timeout)
      if (settled) {
        return
      }
      if (timedOut) {
        rejectOnce(
          invalidImage("Image processing exceeded the safe time limit.")
        )
        return
      }
      if (
        code !== 0 ||
        stdoutBytes > MAX_WORKER_OUTPUT_BYTES ||
        stderrBytes > MAX_WORKER_ERROR_BYTES
      ) {
        rejectOnce(unavailableSandbox())
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(Buffer.concat(stdout, stdoutBytes).toString("utf8"))
      } catch {
        rejectOnce(unavailableSandbox())
        return
      }
      const response = workerResponseSchema.safeParse(parsed)
      if (!response.success) {
        rejectOnce(unavailableSandbox())
        return
      }
      if (!response.data.ok) {
        rejectOnce(
          invalidImage(
            response.data.code.includes("limits")
              ? "The image exceeds the safe dimension, pixel, frame, memory, or output limit."
              : "The image could not be decoded and normalized safely."
          )
        )
        return
      }
      settled = true
      resolve(response.data.result)
    })
    child.stdin.on("error", () => {
      // The close/error handlers return the stable boundary error.
    })
    child.stdin.end(request)
  })
}

export const normalizeManagedImageUpload = async (
  file: Express.Multer.File
): Promise<NormalizedManagedImage> => {
  if (
    file.size !== file.buffer.length ||
    file.size < 1 ||
    file.size > MAX_UPLOAD_BYTES
  ) {
    throw invalidImage("The uploaded image is empty, incomplete, or too large.")
  }
  const result = await runImageSandbox(file)
  const buffer = Buffer.from(result.content, "base64")
  if (buffer.length !== result.size) {
    throw unavailableSandbox()
  }
  const sourceSha256 = createHash("sha256").update(file.buffer).digest("hex")
  return {
    buffer,
    filename: normalizeFilename(file.originalname),
    height: result.height,
    mimeType: result.mimeType,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    size: buffer.length,
    source: {
      ...result.source,
      filename: file.originalname,
      mimeType: file.mimetype,
      sha256: sourceSha256,
      size: file.size,
    },
    width: result.width,
  }
}

export const normalizeManagedImageUploads = async (
  files: Express.Multer.File[]
): Promise<NormalizedManagedImage[]> => {
  const normalized: NormalizedManagedImage[] = []
  let totalBytes = 0
  for (const file of files) {
    const image = await normalizeManagedImageUpload(file)
    totalBytes += image.size
    if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
      throw invalidImage(
        "The normalized images exceed the combined safe output limit."
      )
    }
    normalized.push(image)
  }
  return normalized
}
