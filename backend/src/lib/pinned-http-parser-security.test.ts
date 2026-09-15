import { execFileSync } from "node:child_process"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import multer from "multer"

import { MAX_UPLOAD_BYTES } from "./uploads/constraints"
import { managedUploadLimits, parseManagedUpload } from "./uploads/multipart"

type MultipartPart = {
  name: string
  content: string | Buffer
  filename?: string
}

const boundary = "rr-parser-security-fixture"
const multipart = (parts: MultipartPart[]): Buffer =>
  Buffer.concat([
    ...parts.flatMap(({ name, content, filename }) => [
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"${filename ? `; filename="${filename}"` : ""}\r\n${filename ? "Content-Type: text/csv\r\n" : ""}\r\n`
      ),
      Buffer.from(content),
      Buffer.from("\r\n"),
    ]),
    Buffer.from(`--${boundary}--\r\n`),
  ])

const uploadRequest = (body: Buffer) =>
  Object.assign(new PassThrough(), {
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": String(body.length),
    },
    method: "POST",
    path: "/admin/catalog/media/uploads",
  })

const startManagedUpload = (body: Buffer) => {
  const req = uploadRequest(body)
  const headers: Record<string, unknown> = {}
  const res = {
    locals: {},
    setHeader: jest.fn((name: string, value: unknown) => {
      headers[name] = value
    }),
    status: jest.fn(),
    type: jest.fn(),
    json: jest.fn(),
  }
  res.status.mockReturnValue(res)
  res.type.mockReturnValue(res)
  const next = jest.fn()
  const result = new Promise<{
    request: MedusaRequest
    response: typeof res
    headers: typeof headers
    next: typeof next
  }>((resolve, reject) => {
    const timer = setTimeout(() => {
      req.destroy()
      reject(new Error("Upload fixture timed out"))
    }, 2000)
    const finish = () => {
      clearTimeout(timer)
      resolve({
        request: req as unknown as MedusaRequest,
        response: res,
        headers,
        next,
      })
    }
    res.json.mockImplementation(finish)
    parseManagedUpload(
      req as unknown as MedusaRequest,
      res as unknown as MedusaResponse,
      (error: unknown) => {
        next(error)
        finish()
      }
    )
  })
  return { requestStream: req, result }
}

const submitManagedUpload = (body: Buffer) => {
  const upload = startManagedUpload(body)
  upload.requestStream.end(body)
  return upload.result
}

const startUploadWithCompletedFile = async () => {
  const body = multipart([
    { name: "idempotencyKey", content: "00000000-0000-4000-8000-000000000001" },
    { name: "files", filename: "accepted.csv", content: "accepted bytes" },
    {
      name: "private-second",
      filename: "rejected.csv",
      content: "rejected bytes",
    },
  ])
  const upload = startManagedUpload(body)
  const secondHeader = body.indexOf(
    'Content-Disposition: form-data; name="private-second"'
  )
  expect(secondHeader).toBeGreaterThan(0)
  upload.requestStream.write(body.subarray(0, secondHeader))
  await new Promise<void>((resolve) => setImmediate(resolve))
  const request = upload.requestStream as unknown as MedusaRequest
  const files = request.files
  expect(Array.isArray(files)).toBe(true)
  if (!Array.isArray(files) || !files[0])
    throw new Error("Expected a completed first file")
  const file = files[0]
  expect(file.buffer.toString()).toBe("accepted bytes")
  expect(request.body).toHaveProperty("idempotencyKey")
  return { ...upload, body, secondHeader, file, files }
}

// An older Multer can crash or hang on these names. Keep regression failures
// inside a child with a hard deadline and heap cap, never the Jest worker.
const isolatedMulter = (parts: MultipartPart[], limits: object): unknown => {
  const script = `
    const { PassThrough } = require('node:stream');
    const multer = require(process.argv[1]);
    const body = require('node:fs').readFileSync(0);
    const req = Object.assign(new PassThrough(), {
      headers: {'content-type': 'multipart/form-data; boundary=${boundary}', 'content-length': String(body.length)}
    });
    multer({limits: JSON.parse(process.argv[2]), storage: multer.memoryStorage()}).none()(req, {}, (error) => {
      process.stdout.write(JSON.stringify({code: error ? error.code : null}));
    });
    req.end(body);
  `
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--max-old-space-size=128",
        "-e",
        script,
        require.resolve("multer"),
        JSON.stringify(limits),
      ],
      {
        input: multipart(parts),
        timeout: 3000,
        maxBuffer: 4096,
        encoding: "utf8",
      }
    )
  )
}

describe("pinned multipart parser security", () => {
  it("rejects a maximum-length array followed by append without crashing", () => {
    expect(
      isolatedMulter(
        [
          { name: "entry[4294967294]", content: "value" },
          { name: "entry[]", content: "overflow" },
        ],
        {}
      )
    ).toEqual({ code: "INVALID_FIELD_NAME" })
  })

  it("rejects sparse-array conversion before unbounded iteration", () => {
    expect(
      isolatedMulter(
        [
          { name: "entry[4294967294]", content: "value" },
          { name: "entry[label]", content: "conversion" },
        ],
        { fieldArrayIndexLimit: managedUploadLimits.fieldArrayIndexLimit }
      )
    ).toEqual({ code: "LIMIT_FIELD_ARRAY_INDEX" })
  })

  it("removes a disk upload whose asynchronous filename resolves after abort", () => {
    const directory = mkdtempSync(join(tmpdir(), "rr-multer-abort-"))
    chmodSync(directory, 0o700)
    const body = multipart([
      {
        name: "files",
        filename: "synthetic.csv",
        content: "synthetic upload bytes",
      },
      { name: "pending", content: "not sent" },
    ])
    // Test the installed disk adapter even though managed routes use memory.
    // Defer filename assignment until after abort cleanup has committed its
    // removal list: the vulnerable version leaves a late write orphaned.
    const script = `
      const fs = require('node:fs');
      const { PassThrough } = require('node:stream');
      const multer = require(process.argv[1]);
      const directory = process.argv[2];
      const body = fs.readFileSync(0);
      const req = Object.assign(new PassThrough(), {
        headers: {'content-type': 'multipart/form-data; boundary=${boundary}', 'content-length': String(body.length)}
      });
      let releaseFilename;
      let filenameEntered;
      let storageCompleted = false;
      let nextCalls = 0;
      const ready = new Promise((resolve) => { filenameEntered = resolve; });
      const storage = multer.diskStorage({
        destination: directory,
        filename: (_req, _file, callback) => {
          releaseFilename = () => callback(null, 'synthetic.csv');
          filenameEntered();
        }
      });
      const originalHandle = storage._handleFile.bind(storage);
      storage._handleFile = (request, file, callback) => originalHandle(request, file, (error, info) => {
        callback(error, info);
        storageCompleted = true;
      });
      const aborted = new Promise((resolve) => {
        multer({storage}).array('files')(req, {}, (error) => {
          nextCalls++;
          resolve(Boolean(error));
        });
      });
      (async () => {
        req.write(body.subarray(0, body.indexOf('Content-Disposition: form-data; name="pending"')));
        await ready;
        await new Promise((resolve) => setImmediate(resolve));
        req.destroy(new Error('Synthetic request abort'));
        const rejected = await aborted;
        releaseFilename();
        const deadline = Date.now() + 1000;
        while ((!storageCompleted || fs.readdirSync(directory).length > 0) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        process.stdout.write(JSON.stringify({rejected, nextCalls, storageCompleted, orphanCount: fs.readdirSync(directory).length}));
      })().catch(() => { process.exitCode = 1; });
    `
    try {
      const result: unknown = JSON.parse(
        execFileSync(
          process.execPath,
          [
            "--max-old-space-size=128",
            "-e",
            script,
            require.resolve("multer"),
            directory,
          ],
          { input: body, timeout: 3000, maxBuffer: 4096, encoding: "utf8" }
        )
      )
      expect(result).toEqual({
        rejected: true,
        nextCalls: 1,
        storageCompleted: true,
        orphanCount: 0,
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("retains normal files and scalar idempotency metadata", async () => {
    const body = Buffer.from("Product Title\nRelease\n")
    const result = await submitManagedUpload(
      multipart([
        {
          name: "idempotencyKey",
          content: "00000000-0000-4000-8000-000000000001",
        },
        { name: "files", filename: "catalog.csv", content: body },
      ])
    )
    expect(result.next).toHaveBeenCalledWith(undefined)
    expect(result.response.json).not.toHaveBeenCalled()
    expect(result.request.body).toEqual({
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
    })
    expect(result.request.files).toEqual([
      expect.objectContaining({
        buffer: body,
        size: body.length,
        originalname: "catalog.csv",
      }),
    ])
  })

  it("accepts the documented exact 12 MiB per-file boundary", async () => {
    const result = await submitManagedUpload(
      multipart([
        {
          name: "files",
          filename: "catalog.csv",
          content: Buffer.alloc(MAX_UPLOAD_BYTES, 65),
        },
      ])
    )
    expect(result.next).toHaveBeenCalledWith(undefined)
    expect(result.request.files).toEqual([
      expect.objectContaining({ size: MAX_UPLOAD_BYTES }),
    ])
  })

  it("rejects one byte over the file bound and releases its buffer", async () => {
    const result = await submitManagedUpload(
      multipart([
        {
          name: "files",
          filename: "private-name.csv",
          content: Buffer.alloc(MAX_UPLOAD_BYTES + 1, 65),
        },
      ])
    )
    expect(result.response.status).toHaveBeenCalledWith(413)
    expect(result.response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "upload_limit_exceeded", status: 413 })
    )
    expect(result.request.files).toEqual([])
    expect(result.next).not.toHaveBeenCalled()
    expect(JSON.stringify(result.response.json.mock.calls)).not.toContain(
      "private-name"
    )
  })

  it.each([
    "metadata[4294967294]",
    "metadata[00001]",
    "metadata[nested][field]",
    "x".repeat(101),
  ])("returns a correlated bounded problem for %s", async (name) => {
    const result = await submitManagedUpload(
      multipart([{ name, content: "private-value" }])
    )
    expect(result.response.status).toHaveBeenCalledWith(413)
    expect(result.response.type).toHaveBeenCalledWith(
      "application/problem+json"
    )
    expect(result.headers["X-Request-Id"]).toEqual(expect.any(String))
    expect(result.response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: result.headers["X-Request-Id"],
        trace_id: expect.any(String),
      })
    )
    expect(JSON.stringify(result.response.json.mock.calls)).not.toContain(
      "private-value"
    )
    expect(JSON.stringify(result.response.json.mock.calls)).not.toContain(name)
    expect(result.next).not.toHaveBeenCalled()
  })

  it("rejects unexpected file fields with a fixed 400 problem", async () => {
    const result = await submitManagedUpload(
      multipart([
        { name: "private-field", filename: "file.csv", content: "data" },
      ])
    )
    expect(result.response.status).toHaveBeenCalledWith(400)
    expect(result.response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "invalid_upload" })
    )
    expect(JSON.stringify(result.response.json.mock.calls)).not.toContain(
      "private-field"
    )
  })

  it("releases a completed first file when a later file is rejected", async () => {
    const upload = await startUploadWithCompletedFile()
    const bytes = upload.file.buffer
    upload.requestStream.end(upload.body.subarray(upload.secondHeader))
    const result = await upload.result
    expect(result.response.status).toHaveBeenCalledWith(400)
    expect(Object.hasOwn(upload.file, "buffer")).toBe(false)
    expect(upload.files).toEqual([])
    expect(result.request.files).toEqual([])
    expect(result.request.body).toEqual({})
    // Releasing request references makes buffers eligible for collection;
    // it does not promise physical erasure of separately retained bytes.
    expect(bytes.toString()).toBe("accepted bytes")
  })

  it("releases a completed first file and metadata when the request aborts", async () => {
    const upload = await startUploadWithCompletedFile()
    const error = new Error("Synthetic abort after completed file")
    upload.requestStream.destroy(error)
    const result = await upload.result
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(result.next).toHaveBeenCalledTimes(1)
    expect(result.next).toHaveBeenCalledWith(error)
    expect(Object.hasOwn(upload.file, "buffer")).toBe(false)
    expect(upload.files).toEqual([])
    expect(result.request.files).toEqual([])
    expect(result.request.body).toEqual({})
    expect(result.response.json).not.toHaveBeenCalled()
  })

  it("preserves native handling for an ordinary truncated-body error", async () => {
    const body = multipart([
      { name: "files", filename: "file.csv", content: "incomplete bytes" },
    ])
    const result = await submitManagedUpload(body.subarray(0, body.length - 40))
    expect(result.next).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Unexpected end of form" })
    )
    expect(result.response.json).not.toHaveBeenCalled()
    expect(result.request.files).toEqual([])
    expect(result.request.body).toEqual({})
  })

  it("keeps size rejection when an asynchronous filter accepts later", async () => {
    const body = multipart([
      { name: "files", filename: "file.csv", content: Buffer.alloc(33) },
    ])
    const req = uploadRequest(body)
    const parser = multer({
      limits: { fileSize: 32 },
      storage: multer.memoryStorage(),
      fileFilter: (_req, _file, callback) => {
        setImmediate(() => callback(null, true))
      },
    }).array("files")
    const result = new Promise<unknown>((resolve) => {
      parser(req as unknown as MedusaRequest, {} as MedusaResponse, resolve)
    })
    req.end(body)
    await expect(result).resolves.toMatchObject({ code: "LIMIT_FILE_SIZE" })
  })

  it("settles an aborted memory upload once without accepting partial files", async () => {
    const body = multipart([
      { name: "files", filename: "file.csv", content: Buffer.alloc(256) },
    ])
    const req = uploadRequest(body)
    const next = jest.fn()
    const result = new Promise<unknown>((resolve) => {
      parseManagedUpload(
        req as unknown as MedusaRequest,
        {} as MedusaResponse,
        (error: unknown) => {
          next(error)
          resolve(error)
        }
      )
    })
    req.write(body.subarray(0, body.length - 100))
    req.destroy(new Error("Synthetic aborted upload"))
    await expect(result).resolves.toMatchObject({
      message: "Synthetic aborted upload",
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(next).toHaveBeenCalledTimes(1)
    const files: unknown = (req as unknown as MedusaRequest).files
    expect(
      Array.isArray(files) &&
        files.every((file: object) => !Object.hasOwn(file, "buffer"))
    ).toBe(true)
  })
})

type MorganFactory = (
  format: string,
  options: { immediate: boolean; stream: { write: (line: string) => void } }
) => (req: object, res: object, next: () => void) => void

describe("pinned framework HTTP log escaping", () => {
  const frameworkRequire = createRequire(
    require.resolve("@medusajs/framework/http")
  )
  const morgan = frameworkRequire("morgan") as MorganFactory

  it.each(["\u0085", "\u2028", "\u2029", "\n", "\r", "\u001b"])(
    "escapes the attacker-controlled %j log separator",
    (separator) => {
      const write = jest.fn()
      const middleware = morgan(
        ":method :url :referrer :user-agent :remote-user",
        { immediate: true, stream: { write } }
      )
      middleware(
        {
          method: "GET",
          url: `/catalog/${separator}forged`,
          headers: {
            referer: `https://example.invalid/${separator}forged`,
            "user-agent": `agent${separator}forged`,
            authorization: `Basic ${Buffer.from(`user${separator}forged:synthetic`).toString("base64")}`,
          },
        },
        {},
        jest.fn()
      )
      expect(write).toHaveBeenCalledTimes(1)
      const line: unknown = write.mock.calls[0]?.[0]
      expect(typeof line).toBe("string")
      if (typeof line !== "string") throw new Error("Expected a log line")
      expect(line.slice(0, -1)).not.toContain(separator)
      expect(line.split("\n")).toHaveLength(2)
      expect(line).toContain("forged")
    }
  )

  it("preserves ordinary Unicode while distinguishing literal backslashes", () => {
    const write = jest.fn()
    morgan(":url", { immediate: true, stream: { write } })(
      { url: "/catalog/Björk/\\u2028", headers: {} },
      {},
      jest.fn()
    )
    expect(write).toHaveBeenCalledWith("/catalog/Björk/\\\\u2028\n")
  })

  it("escapes quotes inside the combined log's request fields", () => {
    const write = jest.fn()
    morgan("combined", { immediate: true, stream: { write } })(
      {
        method: "GET",
        url: "/catalog",
        httpVersionMajor: 1,
        httpVersionMinor: 1,
        headers: {
          referer: 'https://example.invalid/"forged',
          "user-agent": 'agent"forged',
        },
      },
      {},
      jest.fn()
    )
    const line: unknown = write.mock.calls[0]?.[0]
    expect(line).toEqual(
      expect.stringContaining('https://example.invalid/\\"forged')
    )
    expect(line).toEqual(expect.stringContaining('agent\\"forged'))
  })
})
