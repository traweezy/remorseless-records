import { MedusaError } from "@medusajs/framework/utils"
import { parse } from "csv-parse/sync"

import {
  createProductImportPlan,
  MAX_PRODUCT_IMPORT_BYTES,
  MAX_PRODUCT_IMPORT_COLUMNS,
  MAX_PRODUCT_IMPORT_OPERATIONS,
  MAX_PRODUCT_IMPORT_ROWS,
  normalizeProductImportFilename,
  parseProductImportPlan,
  PRODUCT_IMPORT_PLAN_TTL_MS,
  productImportLockKey,
  productImportWorkflowTransactionId,
  readCsvMatrix,
  readCsvRecords,
  readNormalizedProductTree,
  readProductImportBuffer,
  readProductImportFileKey,
  readProductLookupRows,
  validateProductImportWorkflowResult,
} from "./product-import-contract"

const nowMs = Date.parse("2026-08-30T16:00:00.000Z")

const storedPlan = (overrides: Record<string, unknown> = {}): Buffer =>
  Buffer.from(
    JSON.stringify({
      create: [{ title: "New release" }],
      filename: "catalog.csv",
      generatedAt: new Date(nowMs).toISOString(),
      update: [{ id: "prod_existing", title: "Existing release" }],
      ...overrides,
    }),
    "utf-8"
  )

const validPlan = () => parseProductImportPlan(storedPlan(), nowMs)

const parseCsvRecord = (csv: string, groupColumnsByName = false): object => {
  const rows: unknown = parse(csv, {
    bom: true,
    columns: true,
    group_columns_by_name: groupColumnsByName,
    skip_empty_lines: true,
  })
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error("Expected exactly one parsed CSV fixture row.")
  }
  const row: unknown = rows[0]
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw new Error("Expected a parsed CSV fixture object.")
  }
  return row
}

describe("product import file boundaries", () => {
  it("normalizes a path-bearing filename and validates opaque file IDs", () => {
    expect(normalizeProductImportFilename(" ../exports/catalog.csv ")).toBe(
      "catalog.csv"
    )
    expect(normalizeProductImportFilename("\u0000bad.csv")).toBe(
      "products-import.csv"
    )
    expect(readProductImportFileKey("file_01.example:2")).toBe(
      "file_01.example:2"
    )
    expect(() => readProductImportFileKey("../file_01")).toThrow(MedusaError)
  })

  it("accepts only bounded, non-empty UTF-8 buffers without NUL bytes", () => {
    expect(readProductImportBuffer(Buffer.from("title\nRelease"))).toBe(
      "title\nRelease"
    )
    expect(() => readProductImportBuffer("title\nRelease")).toThrow(MedusaError)
    expect(() => readProductImportBuffer(Buffer.alloc(0))).toThrow(MedusaError)
    expect(() => readProductImportBuffer(Buffer.from("bad\u0000csv"))).toThrow(
      MedusaError
    )
    expect(() => readProductImportBuffer(Buffer.from([0xc3, 0x28]))).toThrow(
      MedusaError
    )
    expect(() =>
      readProductImportBuffer(Buffer.alloc(MAX_PRODUCT_IMPORT_BYTES + 1))
    ).toThrow(MedusaError)
  })
})

describe("product import CSV boundaries", () => {
  it.each(["__proto__", "constructor", "toString"])(
    "parses %s headers as own data without replacing the row prototype",
    (header) => {
      const row = parseCsvRecord(
        `\uFEFF${header},Product Title\nheader-value,Release\n`
      )

      expect(Object.getPrototypeOf(row)).toBe(Object.prototype)
      expect(Object.getOwnPropertyDescriptor(row, header)).toEqual({
        configurable: true,
        enumerable: true,
        value: "header-value",
        writable: true,
      })
      expect(Object.keys(row)).toEqual([header, "Product Title"])
      expect(readCsvRecords([row])[0]?.["Product Title"]).toBe("Release")
    }
  )

  // Imports do not enable grouping; the shared row boundary must still reject
  // grouped values rather than accepting data hidden in an inherited property.
  it.each(["__proto__", "constructor", "toString"])(
    "keeps grouped %s columns own and rejects them at the string-only boundary",
    (header) => {
      const row = parseCsvRecord(
        `${header},${header},Product Title\nfirst,second,Release\n`,
        true
      )

      expect(Object.getPrototypeOf(row)).toBe(Object.prototype)
      expect(Object.getOwnPropertyDescriptor(row, header)).toEqual({
        configurable: true,
        enumerable: true,
        value: ["first", "second"],
        writable: true,
      })
      expect(Object.hasOwn(row, "0")).toBe(false)
      expect(Object.hasOwn(row, "length")).toBe(false)
      expect(() => readCsvRecords([row])).toThrow(MedusaError)
    }
  )

  it("accepts string matrices and string-valued record rows", () => {
    expect(readCsvMatrix([["Product Title"], ["Release"]])).toEqual([
      ["Product Title"],
      ["Release"],
    ])
    expect(readCsvRecords([{ "Product Title": "Release" }])).toEqual([
      { "Product Title": "Release" },
    ])
  })

  it("rejects primitive rows, non-string cells, and oversized shapes", () => {
    expect(() => readCsvMatrix(["Product Title"])).toThrow(MedusaError)
    expect(() => readCsvMatrix([["Product Title", 1]])).toThrow(MedusaError)
    expect(() =>
      readCsvMatrix([Array.from({ length: MAX_PRODUCT_IMPORT_COLUMNS + 1 })])
    ).toThrow(MedusaError)
    expect(() =>
      readCsvMatrix(
        Array.from({ length: MAX_PRODUCT_IMPORT_ROWS + 2 }, () => [])
      )
    ).toThrow(MedusaError)
    expect(() => readCsvRecords([{ title: null }])).toThrow(MedusaError)
  })

  it("requires bounded product maps from the Medusa normalizer", () => {
    expect(
      readNormalizedProductTree({
        toCreate: { release: { title: "Release" } },
        toUpdate: {},
      })
    ).toEqual({
      toCreate: { release: { title: "Release" } },
      toUpdate: {},
    })
    expect(() =>
      readNormalizedProductTree({ toCreate: [], toUpdate: {} })
    ).toThrow(MedusaError)
    expect(() =>
      readNormalizedProductTree({
        ignored: {},
        toCreate: {},
        toUpdate: {},
      })
    ).toThrow(MedusaError)
  })
})

describe("persisted product import plans", () => {
  it("validates exact persisted fields and product operation schemas", () => {
    const plan = validPlan()

    expect(plan.filename).toBe("catalog.csv")
    expect(plan.create).toHaveLength(1)
    expect(plan.update).toHaveLength(1)
    expect(plan.update[0]?.id).toBe("prod_existing")
    expect(() =>
      parseProductImportPlan(storedPlan({ extra: true }), nowMs)
    ).toThrow(MedusaError)
    expect(() =>
      parseProductImportPlan(storedPlan({ create: ["release"] }), nowMs)
    ).toThrow(MedusaError)
  })

  it("normalizes filenames only when creating a plan", () => {
    const plan = createProductImportPlan({
      create: [{ title: "Release" }],
      filename: "../../catalog.csv",
      generatedAt: new Date(nowMs).toISOString(),
      update: [],
    })

    expect(plan.filename).toBe("catalog.csv")
    expect(() =>
      parseProductImportPlan(
        storedPlan({ filename: "../../catalog.csv" }),
        nowMs
      )
    ).toThrow(MedusaError)
  })

  it("rejects empty, duplicate, and oversized operation sets", () => {
    expect(() =>
      parseProductImportPlan(storedPlan({ create: [], update: [] }), nowMs)
    ).toThrow(MedusaError)
    expect(() =>
      parseProductImportPlan(
        storedPlan({
          create: [],
          update: [
            { id: "prod_duplicate", title: "One" },
            { id: "prod_duplicate", title: "Two" },
          ],
        }),
        nowMs
      )
    ).toThrow(MedusaError)
    expect(() =>
      createProductImportPlan({
        create: Array.from(
          { length: MAX_PRODUCT_IMPORT_OPERATIONS + 1 },
          () => ({ title: "Release" })
        ),
        filename: "catalog.csv",
        update: [],
      })
    ).toThrow(MedusaError)
  })

  it("expires plans after 24 hours and rejects implausible future plans", () => {
    expect(() =>
      parseProductImportPlan(
        storedPlan(),
        nowMs + PRODUCT_IMPORT_PLAN_TTL_MS + 1
      )
    ).toThrow(MedusaError)
    expect(() =>
      parseProductImportPlan(storedPlan(), nowMs - 5 * 60 * 1_000 - 1)
    ).toThrow(MedusaError)
  })
})

describe("product import catalog lookups", () => {
  const validLookup = {
    data: [
      {
        handle: "release",
        id: "prod_release",
        options: [
          {
            created_at: "2026-08-01T12:00:00.000Z",
            id: "opt_format",
            title: "Format",
            values: [{ value: "Vinyl" }],
          },
        ],
        variants: [{ id: "variant_vinyl", sku: "RR-001-LP" }],
      },
    ],
  }

  it("normalizes validated graph relationships", () => {
    expect(readProductLookupRows(validLookup, ["release"])).toEqual([
      {
        handle: "release",
        id: "prod_release",
        options: [
          {
            createdAt: "2026-08-01T12:00:00.000Z",
            id: "opt_format",
            title: "Format",
            values: ["Vinyl"],
          },
        ],
        variants: [{ id: "variant_vinyl", sku: "RR-001-LP" }],
      },
    ])
  })

  it.each([
    ["primitive envelope member", { data: ["release"] }],
    [
      "unexpected handle",
      { data: [{ ...validLookup.data[0], handle: "other" }] },
    ],
    [
      "primitive relationship",
      { data: [{ ...validLookup.data[0], options: ["format"] }] },
    ],
    [
      "missing option timestamp",
      {
        data: [
          {
            ...validLookup.data[0],
            options: [
              {
                id: "opt_format",
                title: "Format",
                values: [{ value: "Vinyl" }],
              },
            ],
          },
        ],
      },
    ],
  ])("rejects %s", (_name, value) => {
    expect(() => readProductLookupRows(value, ["release"])).toThrow(MedusaError)
  })
})

describe("product import confirmation", () => {
  it("derives deterministic identifiers without exposing the plan file ID", () => {
    const fileId = "file_sensitive_01"
    const workflowId = productImportWorkflowTransactionId(fileId)
    const lockKey = productImportLockKey(fileId)

    expect(productImportWorkflowTransactionId(fileId)).toBe(workflowId)
    expect(productImportLockKey(fileId)).toBe(lockKey)
    expect(workflowId).not.toContain(fileId)
    expect(lockKey).not.toContain(fileId)
    expect(() => productImportLockKey("../file_sensitive_01")).toThrow(
      MedusaError
    )
  })

  it("requires exact created and updated workflow acknowledgements", () => {
    const plan = validPlan()

    expect(
      validateProductImportWorkflowResult(
        {
          created: [{ id: "prod_created" }],
          deleted: [],
          updated: [{ id: "prod_existing" }],
        },
        plan
      )
    ).toEqual({ created: 1, updated: 1 })
    expect(() =>
      validateProductImportWorkflowResult(
        {
          created: [{ id: "prod_created" }],
          deleted: [],
          updated: [{ id: "prod_wrong" }],
        },
        plan
      )
    ).toThrow(MedusaError)
    expect(() =>
      validateProductImportWorkflowResult(
        {
          created: [{ id: "prod_created" }],
          deleted: ["prod_deleted"],
          updated: [{ id: "prod_existing" }],
        },
        plan
      )
    ).toThrow(MedusaError)
    expect(() =>
      validateProductImportWorkflowResult(
        { created: ["prod_created"], deleted: [], updated: [] },
        plan
      )
    ).toThrow(MedusaError)
  })
})
