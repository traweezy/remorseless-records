import { resolveObjectStorageConfig } from "./config"

describe("resolveObjectStorageConfig", () => {
  it("returns null for an unconfigured non-production environment", () => {
    expect(
      resolveObjectStorageConfig({
        environment: {},
        required: false,
      })
    ).toBeNull()
  })

  it("normalizes a complete MinIO configuration", () => {
    expect(
      resolveObjectStorageConfig({
        environment: {
          MINIO_ACCESS_KEY: "access",
          MINIO_BUCKET: "medusa-media",
          MINIO_ENDPOINT: "objects.example.test",
          MINIO_REGION: "us-east-1",
          MINIO_SECRET_KEY: "secret",
        },
        required: true,
      })
    ).toEqual({
      accessKeyId: "access",
      bucket: "medusa-media",
      endpoint: "https://objects.example.test",
      fileUrl: "https://objects.example.test/medusa-media",
      region: "us-east-1",
      secretAccessKey: "secret",
    })
  })

  it("rejects partial configuration instead of falling back locally", () => {
    expect(() =>
      resolveObjectStorageConfig({
        environment: {
          MINIO_ACCESS_KEY: "access",
          MINIO_ENDPOINT: "objects.example.test",
        },
        required: false,
      })
    ).toThrow("must be configured together")
  })

  it("rejects credential-bearing endpoints", () => {
    expect(() =>
      resolveObjectStorageConfig({
        environment: {
          MINIO_ACCESS_KEY: "access",
          MINIO_ENDPOINT: "https://user:pass@objects.example.test",
          MINIO_SECRET_KEY: "secret",
        },
        required: true,
      })
    ).toThrow("must not contain credentials")
  })

  it("rejects an endpoint path that would change S3 request routing", () => {
    expect(() =>
      resolveObjectStorageConfig({
        environment: {
          MINIO_ACCESS_KEY: "access",
          MINIO_ENDPOINT: "https://objects.example.test/storage",
          MINIO_SECRET_KEY: "secret",
        },
        required: true,
      })
    ).toThrow("must not contain a path")
  })

  it("accepts a public file URL with a bucket path", () => {
    expect(
      resolveObjectStorageConfig({
        environment: {
          MINIO_ACCESS_KEY: "access",
          MINIO_ENDPOINT: "https://objects.internal.test",
          MINIO_FILE_URL: "https://cdn.example.test/assets/records/",
          MINIO_SECRET_KEY: "secret",
        },
        required: true,
      })?.fileUrl
    ).toBe("https://cdn.example.test/assets/records")
  })
})
