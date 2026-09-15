import { createRequire } from "node:module"
import path from "node:path"
import { Readable } from "node:stream"

import type * as CsvParse from "csv-parse"

type ImportResult = {
  chunks: { id: string; toCreate: number; toUpdate: number }[]
  summary: { toCreate: number; toUpdate: number }
}

type FileService = {
  getDownloadStream: jest.Mock
  createFiles: jest.Mock
  deleteFiles: jest.Mock
}

type NativeImportStep = (
  fileKey: string,
  context: { container: { resolve: (key: string) => FileService } }
) => Promise<{ output: ImportResult }>

const coreFlowsEntry = require.resolve("@medusajs/core-flows")
const coreFlowsRequire = createRequire(coreFlowsEntry)
const csv = coreFlowsRequire("csv-parse") as typeof CsvParse
const stepPath = path.join(
  path.dirname(coreFlowsEntry),
  "product/steps/normalize-products-to-chunks.js"
)

const loadNativeImportStep = (): NativeImportStep => {
  jest.doMock("@medusajs/framework/workflows-sdk", () => ({
    createStep: (_name: string, run: NativeImportStep) => run,
    StepResponse: class {
      constructor(readonly output: ImportResult) {}
    },
  }))
  return jest.requireActual<{ normalizeCsvToChunksStep: NativeImportStep }>(
    stepPath
  ).normalizeCsvToChunksStep
}

const importFixture = (contents: string) => {
  const files: { filename: string; content: string; mimeType: string }[] = []
  const file: FileService = {
    getDownloadStream: jest.fn(async () => Readable.from([contents])),
    createFiles: jest.fn(async (input: (typeof files)[number]) => {
      files.push(input)
      return { id: `file_chunk_${files.length}` }
    }),
    deleteFiles: jest.fn(async () => undefined),
  }
  return {
    files,
    file,
    run: () =>
      loadNativeImportStep()("file_synthetic_source", {
        container: { resolve: () => file },
      }),
  }
}

describe("pinned Medusa streaming CSV compatibility", () => {
  it("resolves the same patched parser as the direct import boundary", () => {
    expect(coreFlowsRequire.resolve("csv-parse")).toBe(
      require.resolve("csv-parse")
    )
  })

  it.each(["__proto__", "constructor", "toString"])(
    "keeps streamed %s headers as own data properties",
    async (header) => {
      const stream = Readable.from([
        `${header},Product Title\nvalue,Release\n`,
      ]).pipe(csv.parse({ columns: true, skip_empty_lines: true }))
      const rows: unknown[] = []
      for await (const row of stream) rows.push(row)
      expect(rows).toHaveLength(1)
      const row = rows[0]
      if (typeof row !== "object" || row === null)
        throw new Error("Expected CSV row")
      expect(Object.getPrototypeOf(row)).toBe(Object.prototype)
      expect(Object.getOwnPropertyDescriptor(row, header)).toEqual({
        configurable: true,
        enumerable: true,
        value: "value",
        writable: true,
      })
    }
  )

  it("normalizes quoted create and update rows through the actual installed step", async () => {
    const fixture = importFixture(
      'Product Id,Product Handle,Product Title,Variant Title\n,new-release,"Release, Vol. 1",Default\n\nprod_existing,existing-release,Updated Release,Default\n'
    )
    const result = await fixture.run()
    expect(result.output).toEqual({
      chunks: [{ id: "file_chunk_1", toCreate: 1, toUpdate: 1 }],
      summary: { toCreate: 1, toUpdate: 1 },
    })
    const chunk: unknown = JSON.parse(fixture.files[0]?.content ?? "null")
    expect(chunk).toMatchObject({
      create: [
        expect.objectContaining({
          handle: "new-release",
          title: "Release, Vol. 1",
        }),
      ],
      update: [
        expect.objectContaining({
          id: "prod_existing",
          title: "Updated Release",
        }),
      ],
    })
    expect(fixture.file.deleteFiles).not.toHaveBeenCalled()
  })

  it("preserves product grouping across the 1,000-row chunk boundary", async () => {
    const rows = Array.from(
      { length: 999 },
      (_, index) => `release-${index},Release ${index},Default`
    )
    rows.push(
      "grouped,Grouped Release,Vinyl",
      "grouped,Grouped Release,CD",
      "last,Last Release,Default"
    )
    const fixture = importFixture(
      `Product Handle,Product Title,Variant Title\n${rows.join("\n")}\n`
    )
    const result = await fixture.run()
    expect(result.output.summary).toEqual({ toCreate: 1001, toUpdate: 0 })
    expect(result.output.chunks.map(({ toCreate }) => toCreate)).toEqual([
      1000, 1,
    ])
    const firstChunk: unknown = JSON.parse(fixture.files[0]?.content ?? "null")
    expect(firstChunk).toMatchObject({
      create: expect.arrayContaining([
        expect.objectContaining({
          handle: "grouped",
          variants: [
            expect.objectContaining({ title: "Vinyl" }),
            expect.objectContaining({ title: "CD" }),
          ],
        }),
      ]),
    })
  })

  it.each([
    'Product Handle,Product Title\nrelease,"unterminated',
    "Product Handle,Product Title\nrelease,Title,extra\n",
  ])(
    "maps parser failures through native CsvError handling",
    async (contents) => {
      const fixture = importFixture(contents)
      await expect(fixture.run()).rejects.toMatchObject({
        type: "invalid_data",
      })
      expect(fixture.file.createFiles).not.toHaveBeenCalled()
      expect(fixture.file.deleteFiles).toHaveBeenCalledWith([])
    }
  )

  it("cleans up only generated chunks when a later write fails", async () => {
    const rows = Array.from(
      { length: 1001 },
      (_, index) => `release-${index},Release ${index},Default`
    )
    const fixture = importFixture(
      `Product Handle,Product Title,Variant Title\n${rows.join("\n")}\n`
    )
    fixture.file.createFiles
      .mockResolvedValueOnce({ id: "file_owned_chunk" })
      .mockRejectedValueOnce(new Error("Synthetic file write failure"))
    await expect(fixture.run()).rejects.toThrow("Synthetic file write failure")
    expect(fixture.file.deleteFiles).toHaveBeenCalledWith(["file_owned_chunk"])
    expect(fixture.file.deleteFiles).not.toHaveBeenCalledWith(
      expect.arrayContaining(["file_synthetic_source"])
    )
  })
})
