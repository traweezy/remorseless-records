import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { normalizeManagedImageUploads } from "../../../lib/uploads/image-normalization"
import { POST } from "./route"

jest.mock("../../../lib/uploads/image-normalization", () => ({
  normalizeManagedImageUploads: jest.fn(),
}))

const normalizeMock = normalizeManagedImageUploads as jest.MockedFunction<
  typeof normalizeManagedImageUploads
>

const responseFixture = (): {
  res: MedusaResponse
  json: jest.Mock
  status: jest.Mock
} => {
  const res = {} as MedusaResponse
  const json = jest.fn(() => res)
  const status = jest.fn(() => res)
  res.json = json as MedusaResponse["json"]
  res.status = status as MedusaResponse["status"]
  return { json, res, status }
}

describe("POST /admin/managed-uploads", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("publishes only the normalized WebP with an opaque storage name", async () => {
    const source = {
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      destination: "",
      encoding: "7bit",
      fieldname: "files",
      filename: "",
      mimetype: "image/png",
      originalname: "private-event-name.png",
      path: "",
      size: 8,
      stream: null as never,
    } satisfies Express.Multer.File
    normalizeMock.mockResolvedValue([
      {
        buffer: Buffer.from("normalized-webp"),
        filename: "private-event-name.webp",
        height: 1_200,
        mimeType: "image/webp",
        sha256: "a".repeat(64),
        size: 15,
        source: {
          channels: 3,
          filename: source.originalname,
          format: "png",
          frames: 1,
          height: 2_400,
          mimeType: source.mimetype,
          sha256: "b".repeat(64),
          size: source.size,
          width: 2_400,
        },
        width: 1_200,
      },
    ])
    const createFiles = jest.fn().mockResolvedValue([
      { id: "file_1", url: "https://cdn.example.com/managed.webp" },
    ])
    const req = {
      files: [source],
      scope: { resolve: jest.fn(() => ({ createFiles })) },
    } as unknown as AuthenticatedMedusaRequest
    const { json, res, status } = responseFixture()

    await POST(req, res)

    expect(createFiles).toHaveBeenCalledWith([
      {
        access: "public",
        content: "bm9ybWFsaXplZC13ZWJw",
        filename: expect.stringMatching(
          /^managed-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-0\.webp$/,
        ),
        mimeType: "image/webp",
      },
    ])
    expect(createFiles.mock.calls[0]?.[0]?.[0]?.filename).not.toContain(
      "private-event-name",
    )
    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith({
      files: [
        { id: "file_1", url: "https://cdn.example.com/managed.webp" },
      ],
    })
  })

  it("preserves validated CSV import support with an opaque storage name", async () => {
    const csv = Buffer.from("Product Handle,Product Title\nrecord-1,Record 1\n")
    const source = {
      buffer: csv,
      destination: "",
      encoding: "7bit",
      fieldname: "files",
      filename: "",
      mimetype: "text/csv",
      originalname: "client-catalog.csv",
      path: "",
      size: csv.length,
      stream: null as never,
    } satisfies Express.Multer.File
    const createFiles = jest.fn().mockResolvedValue([
      { id: "file_csv", url: "https://cdn.example.com/managed.csv" },
    ])
    const req = {
      files: [source],
      scope: { resolve: jest.fn(() => ({ createFiles })) },
    } as unknown as AuthenticatedMedusaRequest
    const { res } = responseFixture()

    await POST(req, res)

    expect(normalizeMock).not.toHaveBeenCalled()
    expect(createFiles).toHaveBeenCalledWith([
      {
        access: "public",
        content: csv.toString("base64"),
        filename: expect.stringMatching(/\.csv$/),
        mimeType: "text/csv",
      },
    ])
    expect(createFiles.mock.calls[0]?.[0]?.[0]?.filename).not.toContain(
      "client-catalog",
    )
  })

  it("rejects mixed image and CSV batches before normalization or storage", async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ])
    const csv = Buffer.from("Product Handle\nrecord-1\n")
    const createFiles = jest.fn()
    const req = {
      files: [
        {
          buffer: png,
          mimetype: "image/png",
          originalname: "cover.png",
          size: png.length,
        },
        {
          buffer: csv,
          mimetype: "text/csv",
          originalname: "products.csv",
          size: csv.length,
        },
      ],
      scope: { resolve: jest.fn(() => ({ createFiles })) },
    } as unknown as AuthenticatedMedusaRequest
    const { res } = responseFixture()

    await expect(POST(req, res)).rejects.toThrow(
      "Image and CSV uploads must use separate requests.",
    )
    expect(normalizeMock).not.toHaveBeenCalled()
    expect(createFiles).not.toHaveBeenCalled()
  })
})
