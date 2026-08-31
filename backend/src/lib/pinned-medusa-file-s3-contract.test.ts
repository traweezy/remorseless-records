import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"

const fileS3Package = require.resolve("@medusajs/file-s3/package.json")
const fileS3Root = dirname(fileS3Package)
type FileInput = {
  access: "private" | "public"
  content: string
  filename: string
  mimeType: string
}
type FileS3Service = {
  delete: (input: unknown) => Promise<void>
  upload: (input: FileInput) => Promise<unknown>
}
const { S3FileService } = require(
  join(fileS3Root, "dist/services/s3-file.js")
) as {
  S3FileService: new (dependencies: unknown, options: unknown) => FileS3Service
}

const createService = (loggerError: jest.Mock) =>
  new S3FileService(
    { logger: { error: loggerError } } as never,
    {
      access_key_id: "test-access-key",
      acl: false,
      bucket: "test-bucket",
      endpoint: "http://storage.internal:9000",
      file_url: "https://media.example.test",
      region: "us-east-1",
      request_timeout_ms: 5_000,
      secret_access_key: "test-secret-key",
    } as never
  )

const replaceClient = (service: FileS3Service, send: jest.Mock): void => {
  const mutableService = service as unknown as {
    client_: { send: jest.Mock }
  }
  mutableService.client_ = { send }
}

describe("pinned Medusa S3 provider boundary", () => {
  it("retains the exact patched deadline and redaction contract", () => {
    const packageJson = JSON.parse(
      readFileSync(join(fileS3Root, "package.json"), "utf8")
    ) as { version?: unknown }
    const serviceSource = readFileSync(
      join(fileS3Root, "dist/services/s3-file.js"),
      "utf8"
    )

    expect(packageJson.version).toBe("2.18.0")
    expect(serviceSource).toContain("AbortSignal.timeout")
    expect(serviceSource).toContain("request_timeout_ms")
    expect(serviceSource).toContain("Object storage request failed.")
    expect(serviceSource).not.toContain("this.logger_.error(e)")
  })

  it("passes an abort signal to storage and returns a fixed failure", async () => {
    const loggerError = jest.fn()
    const leakedError = new Error(
      "http://access:secret@storage.internal/private-customer-key"
    )
    const send = jest.fn().mockRejectedValue(leakedError)
    const service = createService(loggerError)
    replaceClient(service, send)

    const upload = service.upload({
      access: "public",
      content: Buffer.from("safe image bytes").toString("base64"),
      filename: "cover.webp",
      mimeType: "image/webp",
    })

    await expect(upload).rejects.toThrow("Object storage request failed.")
    await expect(upload).rejects.not.toThrow("private-customer-key")
    expect(send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) })
    )
    expect(loggerError).toHaveBeenCalledWith("S3 file provider request failed.")
    expect(JSON.stringify(loggerError.mock.calls)).not.toContain(
      "private-customer-key"
    )
  })

  it("propagates a redacted deletion failure instead of swallowing it", async () => {
    const loggerError = jest.fn()
    const send = jest
      .fn()
      .mockRejectedValue(new Error("secret storage deletion response"))
    const service = createService(loggerError)
    replaceClient(service, send)

    await expect(
      service.delete({ fileKey: "managed-cover.webp" } as never)
    ).rejects.toThrow("Object storage request failed.")
    expect(loggerError).toHaveBeenCalledWith("S3 file provider request failed.")
  })
})
