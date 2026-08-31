import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { normalizeManagedImageUploads } from "../../../../../lib/uploads/image-normalization"
import { uploadCatalogProductMediaWorkflow } from "../../../../../workflows/catalog/upload-product-media"
import { POST } from "./route"

jest.mock("../../../../../lib/uploads/image-normalization", () => ({
  normalizeManagedImageUploads: jest.fn(),
}))
jest.mock("../../../../../workflows/catalog/upload-product-media", () => ({
  uploadCatalogProductMediaWorkflow: jest.fn(),
}))

const workflowMock = uploadCatalogProductMediaWorkflow as jest.MockedFunction<
  typeof uploadCatalogProductMediaWorkflow
>
const normalizeMock = normalizeManagedImageUploads as jest.MockedFunction<
  typeof normalizeManagedImageUploads
>

type ResponseState = {
  body: unknown
  status: number
}

const responseFixture = (): {
  res: MedusaResponse
  state: ResponseState
} => {
  const state: ResponseState = { body: null, status: 200 }
  const response = {} as MedusaResponse
  response.status = jest.fn((status: number) => {
    state.status = status
    return response
  }) as MedusaResponse["status"]
  response.json = jest.fn((body: unknown) => {
    state.body = body
    return response
  }) as MedusaResponse["json"]
  return { res: response, state }
}

const upload = ({
  buffer,
  filename,
  mimeType,
}: {
  buffer: Buffer
  filename: string
  mimeType: string
}): Express.Multer.File =>
  ({
    buffer,
    destination: "",
    encoding: "7bit",
    fieldname: "files",
    filename: "",
    mimetype: mimeType,
    originalname: filename,
    path: "",
    size: buffer.length,
    stream: null as never,
  }) satisfies Express.Multer.File

const requestFixture = (
  body: unknown,
  files: Express.Multer.File[]
): AuthenticatedMedusaRequest =>
  ({
    auth_context: { actor_id: "user_1" },
    body,
    files,
    scope: {
      resolve: jest.fn(() => ({ service: true })),
    },
  }) as unknown as AuthenticatedMedusaRequest

beforeEach(() => {
  jest.clearAllMocks()
  normalizeMock.mockResolvedValue([
    {
      buffer: Buffer.from("normalized-webp"),
      filename: "The-Album-Cover.webp",
      height: 1_200,
      mimeType: "image/webp",
      sha256: "a".repeat(64),
      size: 15,
      source: {
        channels: 3,
        filename: "The Album Cover.JPG",
        format: "jpeg",
        frames: 1,
        height: 2_400,
        mimeType: "image/jpeg",
        sha256: "b".repeat(64),
        size: 4,
        width: 2_400,
      },
      width: 1_200,
    },
  ])
})

describe("POST /admin/catalog/media/uploads", () => {
  it("runs the catalog upload contract with an image digest and safe name", async () => {
    const idempotencyKey = "00000000-0000-4000-8000-000000000001"
    const files = [
      {
        filename: "The Album Cover.JPG",
        id: "file_1",
        mediaAssetId: "cmedia_1",
        mimeType: "image/webp",
        size: 15,
        url: "https://media.example/catalog/cover.jpg",
      },
    ]
    const run = jest.fn().mockResolvedValue({ result: { files } })
    workflowMock.mockReturnValue({ run } as never)
    const req = requestFixture({ idempotencyKey }, [
      upload({
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
        filename: "The Album Cover.JPG",
        mimeType: "image/jpeg",
      }),
    ])
    const { res, state } = responseFixture()

    await POST(req, res)

    expect(run).toHaveBeenCalledWith({
      context: {
        idempotencyKey,
        requestId: idempotencyKey,
      },
      input: {
        actorId: "user_1",
        files: [
          {
            content: "bm9ybWFsaXplZC13ZWJw",
            filename: "The Album Cover.JPG",
            height: 1_200,
            mimeType: "image/webp",
            remoteFilename: `${idempotencyKey}-00.webp`,
            sha256: "a".repeat(64),
            size: 15,
            source: {
              channels: 3,
              filename: "The Album Cover.JPG",
              format: "jpeg",
              frames: 1,
              height: 2_400,
              mimeType: "image/jpeg",
              sha256: "b".repeat(64),
              size: 4,
              width: 2_400,
            },
            width: 1_200,
          },
        ],
        idempotencyKey,
        requestSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    })
    expect(state).toEqual({
      body: { files },
      status: 201,
    })
  })

  it("rejects an invalid idempotency key before validating or uploading", async () => {
    const req = requestFixture({ idempotencyKey: "not-a-uuid" }, [
      upload({
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
        filename: "cover.jpg",
        mimeType: "image/jpeg",
      }),
    ])
    const { res } = responseFixture()

    await expect(POST(req, res)).rejects.toThrow(
      "valid catalog upload idempotency key"
    )
    expect(workflowMock).not.toHaveBeenCalled()
  })
})
