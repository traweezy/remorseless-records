import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { Readable, type Writable } from "node:stream"
import type { S3ClientConfig } from "@aws-sdk/client-s3"

const fileS3Package = require.resolve("@medusajs/file-s3/package.json")
const fileS3Root = dirname(fileS3Package)
type StorageRequestHandler = Extract<
  NonNullable<S3ClientConfig["requestHandler"]>,
  { handle: unknown }
>
type StorageRequest = Parameters<StorageRequestHandler["handle"]>[0]
type StorageRequestOptions = Parameters<StorageRequestHandler["handle"]>[1]
type StorageResponse = Awaited<ReturnType<StorageRequestHandler["handle"]>>
type FileInput = {
  access: "private" | "public"
  content: string
  filename: string
  mimeType: string
}
type FileS3Service = {
  delete: (input: unknown) => Promise<void>
  getUploadStream: (input: Omit<FileInput, "content">) => Promise<{
    writeStream: Writable
    promise: Promise<{ url: string; key: string }>
  }>
  upload: (input: FileInput) => Promise<unknown>
}
const { S3FileService } = require(
  join(fileS3Root, "dist/services/s3-file.js")
) as {
  S3FileService: new (dependencies: unknown, options: unknown) => FileS3Service
}

const createService = (
  loggerError: jest.Mock,
  additionalClientConfig: S3ClientConfig = {},
  requestTimeoutMs = 5_000
) =>
  new S3FileService(
    { logger: { error: loggerError } } as never,
    {
      access_key_id: "test-access-key",
      additional_client_config: {
        forcePathStyle: true,
        maxAttempts: 2,
        ...additionalClientConfig,
      },
      acl: false,
      bucket: "test-bucket",
      endpoint: "http://storage.internal:9000",
      file_url: "https://media.example.test",
      region: "us-east-1",
      request_timeout_ms: requestTimeoutMs,
      secret_access_key: "test-secret-key",
    } as never
  )

const replaceClient = (service: FileS3Service, send: jest.Mock): void => {
  const mutableService = service as unknown as {
    client_: { send: jest.Mock }
  }
  mutableService.client_ = { send }
}

type Deferred<T> = {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T | PromiseLike<T>) => void
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: Deferred<T>["resolve"]
  let reject!: Deferred<T>["reject"]
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, reject, resolve }
}

const pendingStorageResponse = (options: StorageRequestOptions) => {
  const pending = deferred<StorageResponse>()
  const signal =
    options?.abortSignal instanceof AbortSignal
      ? options.abortSignal
      : undefined
  const aborted = deferred<void>()
  const abort = () => {
    aborted.resolve()
    pending.reject(
      new DOMException("secret storage transport aborted", "AbortError")
    )
  }
  if (signal?.aborted) abort()
  else signal?.addEventListener("abort", abort, { once: true })
  return {
    aborted: aborted.promise,
    complete: () =>
      pending.resolve({
        response: { statusCode: 200, headers: { etag: '"fixture-etag"' } },
      }),
    promise: pending.promise.finally(() =>
      signal?.removeEventListener("abort", abort)
    ),
    signal,
  }
}

const withinFixtureDeadline = async <T>(promise: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Storage fixture did not settle")),
          1_500
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
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

  it.each([{}, { Errors: [] }])(
    "accepts successful quiet bulk deletion without deleting extra keys (%j)",
    async (response) => {
      const loggerError = jest.fn()
      const send = jest.fn().mockResolvedValue(response)
      const service = createService(loggerError)
      replaceClient(service, send)

      await expect(
        service.delete([{ fileKey: "managed-cover.webp" }])
      ).resolves.toBeUndefined()
      expect(send).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {
            Bucket: "test-bucket",
            Delete: { Objects: [{ Key: "managed-cover.webp" }], Quiet: true },
          },
        }),
        expect.objectContaining({ abortSignal: expect.any(AbortSignal) })
      )
      expect(loggerError).not.toHaveBeenCalled()
    }
  )

  it("rejects a real HTTP 200 partial-delete response without retrying or exposing keys", async () => {
    const loggerError = jest.fn()
    const requests: { method: string; path: string; body: unknown }[] = []
    const service = createService(loggerError, {
      requestHandler: {
        handle: async (request: StorageRequest) => {
          requests.push({
            method: request.method,
            path: request.path,
            body: request.body,
          })
          return {
            response: {
              statusCode: 200,
              headers: { "content-type": "application/xml" },
              body: Readable.from([
                '<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
                  "<Deleted><Key>managed-cover.webp</Key></Deleted>" +
                  "<Error><Key>private-customer-key</Key><Code>AccessDenied</Code>" +
                  "<Message>secret provider failure</Message></Error></DeleteResult>",
              ]),
            },
          }
        },
      },
    })

    const deletion = service.delete([
      { fileKey: "managed-cover.webp" },
      { fileKey: "private-customer-key" },
    ])

    await expect(deletion).rejects.toThrow("Object storage request failed.")
    await expect(deletion).rejects.not.toThrow("private-customer-key")
    expect(requests).toHaveLength(1)
    expect(requests[0]).toEqual({
      method: "POST",
      path: "/test-bucket/",
      body: expect.stringContaining("<Quiet>true</Quiet>"),
    })
    expect(loggerError.mock.calls).toEqual([
      ["S3 file provider request failed."],
    ])
  })

  it("expires the real SDK request within the provider deadline without hidden retries", async () => {
    const loggerError = jest.fn()
    const aborted = jest.fn()
    const attempted = jest.fn()
    const service = createService(
      loggerError,
      {
        requestHandler: {
          handle: async (
            _request: StorageRequest,
            options: StorageRequestOptions
          ) => {
            attempted()
            const signal = options?.abortSignal
            if (!(signal instanceof AbortSignal)) {
              throw new Error("Expected a native provider abort signal")
            }
            return new Promise((_resolve, reject) => {
              const abort = () => {
                aborted()
                reject(
                  new DOMException("secret provider deadline", "AbortError")
                )
              }
              if (signal.aborted) abort()
              else signal.addEventListener("abort", abort, { once: true })
            })
          },
        },
      },
      25
    )
    const started = performance.now()

    await expect(
      service.delete({ fileKey: "private-customer-key" })
    ).rejects.toThrow("Object storage request failed.")

    expect(performance.now() - started).toBeLessThan(1_000)
    expect(attempted).toHaveBeenCalledTimes(1)
    expect(aborted).toHaveBeenCalledTimes(1)
    expect(loggerError.mock.calls).toEqual([
      ["S3 file provider request failed."],
    ])
  })

  it("stops an unfinished streaming upload and releases the producer at the deadline", async () => {
    const loggerError = jest.fn()
    const attempted = jest.fn()
    const service = createService(
      loggerError,
      {
        requestHandler: {
          handle: async () => {
            attempted()
            throw new Error("Unexpected storage request")
          },
        },
      },
      25
    )
    const stream = await service.getUploadStream({
      access: "public",
      filename: "cover.webp",
      mimeType: "image/webp",
    })
    stream.writeStream.write(Buffer.from("unfinished image"))

    try {
      await expect(stream.promise).rejects.toThrow(
        "Object storage request failed."
      )
      expect(stream.writeStream.destroyed).toBe(true)
      expect(attempted).not.toHaveBeenCalled()
      expect(loggerError.mock.calls).toEqual([
        ["S3 file provider request failed."],
      ])
    } finally {
      stream.writeStream.destroy()
    }
  })

  it("completes a real streaming upload without ACLs and clears its deadline", async () => {
    const loggerError = jest.fn()
    const requestHeaders: Record<string, string>[] = []
    const timeout = jest.spyOn(global, "setTimeout")
    const clear = jest.spyOn(global, "clearTimeout")
    try {
      const service = createService(loggerError, {
        requestHandler: {
          handle: async (request: StorageRequest) => {
            requestHeaders.push(request.headers)
            return {
              response: { statusCode: 200, headers: { etag: '"test-etag"' } },
            }
          },
        },
      })
      const stream = await service.getUploadStream({
        access: "public",
        filename: "cover.webp",
        mimeType: "image/webp",
      })
      const timerIndex = timeout.mock.calls.findIndex(
        (call) => call[1] === 5_000
      )
      const deadline = timeout.mock.results[timerIndex]?.value
      stream.writeStream.end(Buffer.from("complete image"))

      await expect(stream.promise).resolves.toEqual({
        key: expect.stringMatching(/^cover-.+\.webp$/),
        url: expect.stringMatching(
          /^https:\/\/media\.example\.test\/cover-.+\.webp$/
        ),
      })
      expect(deadline).toBeDefined()
      expect(clear).toHaveBeenCalledWith(deadline)
      expect(requestHeaders).toHaveLength(1)
      expect(requestHeaders[0]).not.toHaveProperty("x-amz-acl")
      expect(loggerError).not.toHaveBeenCalled()
    } finally {
      timeout.mockRestore()
      clear.mockRestore()
    }
  })

  it("cancels an in-flight streaming PutObject after its producer has finished", async () => {
    const loggerError = jest.fn()
    const started = deferred<ReturnType<typeof pendingStorageResponse>>()
    let pending: ReturnType<typeof pendingStorageResponse> | undefined
    const service = createService(
      loggerError,
      {
        requestHandler: {
          handle: async (
            _request: StorageRequest,
            options: StorageRequestOptions
          ) => {
            pending = pendingStorageResponse(options)
            started.resolve(pending)
            return pending.promise
          },
        },
      },
      150
    )
    const stream = await service.getUploadStream({
      access: "public",
      filename: "cover.webp",
      mimeType: "image/webp",
    })
    const result = stream.promise.catch((error: unknown) => error)
    stream.writeStream.end(Buffer.from("finished producer"))

    try {
      const transport = await withinFixtureDeadline(started.promise)
      const error = await withinFixtureDeadline(result)
      expect(error).toMatchObject({ message: "Object storage request failed." })
      expect(transport.signal).toBeInstanceOf(AbortSignal)
      expect(transport.signal?.aborted).toBe(true)
      expect(stream.writeStream.destroyed).toBe(true)
      expect(loggerError.mock.calls).toEqual([
        ["S3 file provider request failed."],
      ])
    } finally {
      pending?.complete()
      stream.writeStream.destroy()
      await result
    }
  })

  it("isolates cancellation between simultaneous uploads sharing one provider client", async () => {
    const loggerError = jest.fn()
    const signals: (AbortSignal | undefined)[] = []
    let pending: ReturnType<typeof pendingStorageResponse> | undefined
    const service = createService(
      loggerError,
      {
        requestHandler: {
          handle: async (
            request: StorageRequest,
            options: StorageRequestOptions
          ) => {
            const signal =
              options?.abortSignal instanceof AbortSignal
                ? options.abortSignal
                : undefined
            signals.push(signal)
            if (request.path.includes("stalled-")) {
              pending = pendingStorageResponse(options)
              return pending.promise
            }
            return {
              response: {
                statusCode: 200,
                headers: { etag: '"fixture-etag"' },
              },
            }
          },
        },
      },
      150
    )
    const sharedClient = (service as unknown as { client_: { send: unknown } })
      .client_
    const sharedSend = sharedClient.send
    const stalled = await service.getUploadStream({
      access: "public",
      filename: "stalled.webp",
      mimeType: "image/webp",
    })
    const successful = await service.getUploadStream({
      access: "public",
      filename: "successful.webp",
      mimeType: "image/webp",
    })
    const stalledResult = stalled.promise.catch((error: unknown) => error)
    const successfulResult = successful.promise.catch((error: unknown) => error)
    stalled.writeStream.end(Buffer.from("stalled image"))
    successful.writeStream.end(Buffer.from("successful image"))

    try {
      const [failure, success] = await withinFixtureDeadline(
        Promise.all([stalledResult, successfulResult])
      )
      expect(failure).toMatchObject({
        message: "Object storage request failed.",
      })
      expect(success).toMatchObject({
        key: expect.stringMatching(/^successful-.+\.webp$/),
      })
      expect(signals).toHaveLength(2)
      expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(
        true
      )
      expect(new Set(signals).size).toBe(2)
      expect(signals.filter((signal) => signal?.aborted)).toHaveLength(1)
      expect((service as unknown as { client_: unknown }).client_).toBe(
        sharedClient
      )
      expect(sharedClient.send).toBe(sharedSend)
      expect(loggerError.mock.calls).toEqual([
        ["S3 file provider request failed."],
      ])
    } finally {
      pending?.complete()
      stalled.writeStream.destroy()
      successful.writeStream.destroy()
      await Promise.all([stalledResult, successfulResult])
    }
  })

  it.each(["part", "completion"])(
    "cancels multipart %s and bounds cleanup with an independent live signal",
    async (stalledPhase) => {
      const cleanupLogged = deferred<void>()
      const loggerError = jest.fn((message: string) => {
        if (message === "S3 multipart cleanup failed.") cleanupLogged.resolve()
      })
      const operations: string[] = []
      const uploadSignals: (AbortSignal | undefined)[] = []
      const pendingRequests: ReturnType<typeof pendingStorageResponse>[] = []
      const cleanupStarted =
        deferred<ReturnType<typeof pendingStorageResponse>>()
      let cleanupInitiallyAborted: boolean | undefined
      const service = createService(
        loggerError,
        {
          requestHandler: {
            handle: async (
              request: StorageRequest,
              options: StorageRequestOptions
            ) => {
              if (request.method === "DELETE") {
                operations.push("cleanup")
                const cleanup = pendingStorageResponse(options)
                pendingRequests.push(cleanup)
                cleanupInitiallyAborted = cleanup.signal?.aborted
                cleanupStarted.resolve(cleanup)
                return cleanup.promise
              }
              uploadSignals.push(
                options?.abortSignal instanceof AbortSignal
                  ? options.abortSignal
                  : undefined
              )
              if (request.method === "POST" && "uploads" in request.query) {
                operations.push("create")
                return {
                  response: {
                    statusCode: 200,
                    headers: { "content-type": "application/xml" },
                    body: Readable.from([
                      '<InitiateMultipartUploadResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><UploadId>fixture-upload</UploadId></InitiateMultipartUploadResult>',
                    ]),
                  },
                }
              }
              const phase = request.method === "PUT" ? "part" : "completion"
              operations.push(phase)
              if (phase === stalledPhase) {
                const pending = pendingStorageResponse(options)
                pendingRequests.push(pending)
                return pending.promise
              }
              return {
                response: {
                  statusCode: 200,
                  headers: { etag: '"fixture-etag"' },
                },
              }
            },
          },
        },
        150
      )
      const stream = await service.getUploadStream({
        access: "public",
        filename: "multipart.webp",
        mimeType: "image/webp",
      })
      const result = stream.promise.catch((error: unknown) => error)
      stream.writeStream.end(Buffer.alloc(5 * 1024 * 1024 + 1, 1))

      try {
        expect(await withinFixtureDeadline(result)).toMatchObject({
          message: "Object storage request failed.",
        })
        const cleanup = await withinFixtureDeadline(cleanupStarted.promise)
        expect(
          uploadSignals.every(
            (signal) => signal instanceof AbortSignal && signal.aborted
          )
        ).toBe(true)
        expect(new Set(uploadSignals).size).toBe(1)
        expect(cleanup.signal).toBeInstanceOf(AbortSignal)
        expect(cleanup.signal).not.toBe(uploadSignals[0])
        expect(cleanupInitiallyAborted).toBe(false)
        await withinFixtureDeadline(cleanup.aborted)
        await withinFixtureDeadline(cleanupLogged.promise)
        expect(cleanup.signal?.aborted).toBe(true)
        expect(operations[0]).toBe("create")
        expect(operations).toContain(stalledPhase)
        expect(
          operations.filter((operation) => operation === "cleanup")
        ).toHaveLength(1)
        expect(stream.writeStream.destroyed).toBe(true)
        expect(loggerError.mock.calls).toEqual([
          ["S3 file provider request failed."],
          ["S3 multipart cleanup failed."],
        ])
      } finally {
        for (const pending of pendingRequests) pending.complete()
        stream.writeStream.destroy()
        await result
        // Also settle background SDK cleanup when running the pre-fix baseline.
        await withinFixtureDeadline(cleanupStarted.promise).then(
          (cleanup) => cleanup.complete(),
          () => undefined
        )
      }
    }
  )
})
