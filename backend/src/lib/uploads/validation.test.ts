import {
  validateManagedImageUploads,
  validateManagedUploads,
} from "./validation"

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

describe("validateManagedUploads", () => {
  it.each([
    ["cover.jpg", "image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0x00])],
    [
      "cover.png",
      "image/png",
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ],
    [
      "cover.webp",
      "image/webp",
      Buffer.from("RIFF0000WEBP", "ascii"),
    ],
    ["cover.gif", "image/gif", Buffer.from("GIF89a", "ascii")],
    ["products.csv", "text/csv", Buffer.from("title,handle\nAlbum,album")],
  ])("accepts a valid %s upload", (filename, mimeType, buffer) => {
    const file = upload({ buffer, filename, mimeType })
    expect(validateManagedUploads([file])).toEqual([file])
  })

  it("rejects an image whose bytes do not match its media type", () => {
    expect(() =>
      validateManagedUploads([
        upload({
          buffer: Buffer.from("<svg></svg>"),
          filename: "cover.jpg",
          mimeType: "image/jpeg",
        }),
      ])
    ).toThrow("does not match its declared media type")
  })

  it("rejects a mismatched extension", () => {
    expect(() =>
      validateManagedUploads([
        upload({
          buffer: Buffer.from([0xff, 0xd8, 0xff]),
          filename: "cover.png",
          mimeType: "image/jpeg",
        }),
      ])
    ).toThrow("extension does not match")
  })

  it("rejects SVG and path-like filenames", () => {
    expect(() =>
      validateManagedUploads([
        upload({
          buffer: Buffer.from("<svg></svg>"),
          filename: "../cover.svg",
          mimeType: "image/svg+xml",
        }),
      ])
    ).toThrow("invalid filename")
  })

  it("rejects binary data labeled as CSV", () => {
    expect(() =>
      validateManagedUploads([
        upload({
          buffer: Buffer.from([0xff, 0xfe, 0x00]),
          filename: "products.csv",
          mimeType: "text/csv",
        }),
      ])
    ).toThrow("Only JPEG")
  })

  it("rejects a combined upload larger than 20 MiB", () => {
    const first = Buffer.alloc(11 * 1024 * 1024, 0x61)
    const second = Buffer.alloc(10 * 1024 * 1024, 0x62)
    expect(() =>
      validateManagedUploads([
        upload({ buffer: first, filename: "one.csv", mimeType: "text/csv" }),
        upload({ buffer: second, filename: "two.csv", mimeType: "text/csv" }),
      ])
    ).toThrow("combined upload")
  })
})

describe("validateManagedImageUploads", () => {
  it("accepts validated images but rejects otherwise valid CSV files", () => {
    const image = upload({
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
      filename: "cover.jpg",
      mimeType: "image/jpeg",
    })
    const csv = upload({
      buffer: Buffer.from("title,handle\nAlbum,album"),
      filename: "products.csv",
      mimeType: "text/csv",
    })

    expect(validateManagedImageUploads([image])).toEqual([image])
    expect(() => validateManagedImageUploads([csv])).toThrow(
      "Catalog media uploads must be",
    )
  })
})
