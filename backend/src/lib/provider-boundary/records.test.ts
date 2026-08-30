import {
  asUnknownRecord,
  readCountedRecordPage,
  readProviderDataRecords,
  readRecordArray,
  readWorkflowResultRecords,
} from "./records"

describe("provider structured-data boundaries", () => {
  it("narrows objects without accepting null or arrays", () => {
    expect(asUnknownRecord({ id: "record_01" })).toEqual({ id: "record_01" })
    expect(asUnknownRecord(null)).toBeNull()
    expect(asUnknownRecord([])).toBeNull()
  })

  it("requires every array member to be a structured record", () => {
    expect(
      readRecordArray([{ id: "record_01" }], { context: "Provider" })
    ).toEqual([{ id: "record_01" }])
    expect(
      readRecordArray(undefined, { context: "Provider", optional: true })
    ).toEqual([])
    expect(() =>
      readRecordArray([{ id: "record_01" }, null], { context: "Provider" })
    ).toThrow("Provider returned malformed structured data.")
  })

  it("validates graph data envelopes without trusting their declared type", () => {
    expect(
      readProviderDataRecords({ data: [{ id: "record_01" }] }, "Graph query")
    ).toEqual([{ id: "record_01" }])
    expect(() =>
      readProviderDataRecords({ data: [false] }, "Graph query")
    ).toThrow("Graph query returned malformed structured data.")
    expect(() => readProviderDataRecords({}, "Graph query")).toThrow(
      "Graph query returned malformed structured data."
    )
  })

  it("accepts both supported workflow row envelopes", () => {
    expect(
      readWorkflowResultRecords(
        { result: { rows: [{ id: "record_01" }] } },
        "Order workflow"
      )
    ).toEqual([{ id: "record_01" }])
    expect(
      readWorkflowResultRecords(
        { result: [{ id: "record_02" }] },
        "Order workflow"
      )
    ).toEqual([{ id: "record_02" }])
    expect(() =>
      readWorkflowResultRecords({ result: { rows: ["bad"] } }, "Order workflow")
    ).toThrow("Order workflow returned malformed structured data.")
  })

  it("validates counted service pages and their total", () => {
    expect(
      readCountedRecordPage([[{ id: "record_01" }], 3], "Evidence service")
    ).toEqual({ count: 3, records: [{ id: "record_01" }] })
    expect(() =>
      readCountedRecordPage([[{ id: "record_01" }], 0], "Evidence service")
    ).toThrow("Evidence service returned malformed structured data.")
    expect(() =>
      readCountedRecordPage([[{ id: "record_01" }], 1.5], "Evidence service")
    ).toThrow("Evidence service returned malformed structured data.")
  })
})
