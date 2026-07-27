import {
  buildCatalogMediaRemoteFilename,
  CatalogMediaUploadPartialFailure,
  compensateCatalogMediaUpload,
  performCatalogMediaUpload,
  type CatalogMediaUploadInput,
} from "./product-media-upload"

const serviceFixture = () => {
  const service = {
    createCatalogAuthoringOperations: jest.fn(),
    createCatalogMediaAssets: jest.fn(),
    deleteCatalogMediaAssets: jest.fn(),
    listCatalogAuthoringOperations: jest.fn(),
    updateCatalogAuthoringOperations: jest.fn(),
  }
  service.listCatalogAuthoringOperations.mockResolvedValue([])
  service.createCatalogAuthoringOperations.mockResolvedValue([
    { id: "caop_upload_1" },
  ])
  service.createCatalogMediaAssets.mockResolvedValue([
    { id: "cmedia_upload_1" },
  ])
  return service
}

const fileServiceFixture = () => ({
  createFiles: jest.fn().mockResolvedValue({
    id: "file_upload_1",
    url: "https://media.example/catalog/cover.jpg",
  }),
  deleteFiles: jest.fn(),
})

const commandFixture = (): CatalogMediaUploadInput => ({
  actorId: "user_1",
  files: [
    {
      content: "base64-content",
      filename: "The Album Cover.JPG",
      mimeType: "image/jpeg",
      remoteFilename:
        "00000000-0000-4000-8000-000000000001-00-The-Album-Cover.jpg",
      sha256: "a".repeat(64),
      size: 1_024,
    },
  ],
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
  requestSha256: "b".repeat(64),
})

describe("catalog product media upload", () => {
  it("builds a bounded, path-safe remote filename with the batch prefix", () => {
    expect(
      buildCatalogMediaRemoteFilename(
        commandFixture().idempotencyKey,
        3,
        String.raw`folder\The Album Cover.JPG`,
      ),
    ).toBe(
      "00000000-0000-4000-8000-000000000001-03-The-Album-Cover.jpg",
    )
  })

  it("records each remote upload as a catalog asset immediately", async () => {
    const service = serviceFixture()
    const fileService = fileServiceFixture()
    const input = commandFixture()

    await expect(
      performCatalogMediaUpload(service as never, fileService as never, input),
    ).resolves.toEqual({
      compensation: {
        assetIds: ["cmedia_upload_1"],
        fileIds: ["file_upload_1"],
        operationId: "caop_upload_1",
      },
      mutation: {
        files: [
          {
            filename: "The Album Cover.JPG",
            id: "file_upload_1",
            mediaAssetId: "cmedia_upload_1",
            mimeType: "image/jpeg",
            size: 1_024,
            url: "https://media.example/catalog/cover.jpg",
          },
        ],
        operationId: "caop_upload_1",
        replayed: false,
      },
    })
    expect(service.createCatalogAuthoringOperations).toHaveBeenCalledWith([
      expect.objectContaining({
        aggregate_id: input.idempotencyKey,
        command: "catalog.product-media.upload",
        metadata: {
          file_sha256s: ["a".repeat(64)],
          remote_prefix: input.idempotencyKey,
        },
        status: "pending",
      }),
    ])
    expect(fileService.createFiles).toHaveBeenCalledWith({
      access: "public",
      content: "base64-content",
      filename: input.files[0]?.remoteFilename,
      mimeType: "image/jpeg",
    })
    expect(service.createCatalogMediaAssets).toHaveBeenCalledWith([
      expect.objectContaining({
        content_sha256: "a".repeat(64),
        metadata: {
          upload_idempotency_key: input.idempotencyKey,
        },
        source_file_key: "file_upload_1",
        source_url: "https://media.example/catalog/cover.jpg",
      }),
    ])
  })

  it("replays only an exact succeeded upload without remote writes", async () => {
    const service = serviceFixture()
    const fileService = fileServiceFixture()
    const input = commandFixture()
    const files = [
      {
        filename: input.files[0]?.filename,
        id: "file_existing",
        mediaAssetId: "cmedia_existing",
        mimeType: input.files[0]?.mimeType,
        size: input.files[0]?.size,
        url: "https://media.example/catalog/existing.jpg",
      },
    ]
    service.listCatalogAuthoringOperations.mockResolvedValue([
      {
        actor_id: input.actorId,
        aggregate_id: input.idempotencyKey,
        command: "catalog.product-media.upload",
        expected_version: 0,
        id: "caop_existing",
        request_sha256: input.requestSha256,
        result: { files },
        status: "succeeded",
      },
    ])

    await expect(
      performCatalogMediaUpload(service as never, fileService as never, input),
    ).resolves.toEqual({
      compensation: null,
      mutation: {
        files,
        operationId: "caop_existing",
        replayed: true,
      },
    })
    expect(fileService.createFiles).not.toHaveBeenCalled()
    expect(service.createCatalogMediaAssets).not.toHaveBeenCalled()

    await expect(
      performCatalogMediaUpload(service as never, fileService as never, {
        ...input,
        requestSha256: "c".repeat(64),
      }),
    ).rejects.toThrow("cannot be replayed")
  })

  it("exposes partial ownership when a later remote upload fails", async () => {
    const service = serviceFixture()
    const fileService = fileServiceFixture()
    const first = commandFixture().files[0]
    if (!first) {
      throw new Error("The upload fixture is missing.")
    }
    const input = {
      ...commandFixture(),
      files: [
        first,
        {
          ...first,
          filename: "Back.jpg",
          remoteFilename:
            "00000000-0000-4000-8000-000000000001-01-Back.jpg",
          sha256: "c".repeat(64),
        },
      ],
    }
    fileService.createFiles
      .mockResolvedValueOnce({
        id: "file_upload_1",
        url: "https://media.example/catalog/front.jpg",
      })
      .mockRejectedValueOnce(new Error("provider unavailable"))

    const upload = performCatalogMediaUpload(
      service as never,
      fileService as never,
      input,
    )

    await expect(upload).rejects.toBeInstanceOf(
      CatalogMediaUploadPartialFailure,
    )
    await expect(upload).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: "provider unavailable",
      }),
      compensation: {
        assetIds: ["cmedia_upload_1"],
        fileIds: ["file_upload_1"],
        operationId: "caop_upload_1",
      },
    })
  })

  it("attempts every compensation path and preserves the first error", async () => {
    const service = serviceFixture()
    const fileService = fileServiceFixture()
    const firstError = new Error("database unavailable")
    service.deleteCatalogMediaAssets.mockRejectedValue(firstError)
    fileService.deleteFiles.mockRejectedValue(
      new Error("file provider unavailable"),
    )

    await expect(
      compensateCatalogMediaUpload(service as never, fileService as never, {
        assetIds: ["cmedia_upload_1"],
        fileIds: ["file_upload_1"],
        operationId: "caop_upload_1",
      }),
    ).rejects.toBe(firstError)
    expect(service.deleteCatalogMediaAssets).toHaveBeenCalledWith([
      "cmedia_upload_1",
    ])
    expect(fileService.deleteFiles).toHaveBeenCalledWith(["file_upload_1"])
    expect(service.updateCatalogAuthoringOperations).toHaveBeenCalledWith([
      expect.objectContaining({
        error_code: "workflow_compensation_failed",
        id: "caop_upload_1",
        result: {
          compensation: {
            asset_ids: ["cmedia_upload_1"],
            file_ids: ["file_upload_1"],
          },
        },
        status: "failed",
      }),
    ])
  })

  it("marks the operation compensated only after complete cleanup", async () => {
    const service = serviceFixture()
    const fileService = fileServiceFixture()

    await expect(
      compensateCatalogMediaUpload(service as never, fileService as never, {
        assetIds: ["cmedia_upload_1"],
        fileIds: ["file_upload_1"],
        operationId: "caop_upload_1",
      }),
    ).resolves.toBeUndefined()
    expect(service.updateCatalogAuthoringOperations).toHaveBeenCalledWith([
      expect.objectContaining({
        error_code: "workflow_compensated",
        id: "caop_upload_1",
        status: "compensated",
      }),
    ])
  })
})
