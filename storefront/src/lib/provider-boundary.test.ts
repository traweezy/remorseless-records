import { describe, expect, it } from "vitest"

import {
  asUnknownRecord,
  readBoundedText,
  readFiniteNumber,
  readIsoTimestamp,
  readNonNegativeSafeInteger,
  readPositiveSafeInteger,
  readRecordArray,
} from "./provider-boundary"

describe("Storefront provider boundary primitives", () => {
  it("accepts explicit finite numbers and Medusa value wrappers", () => {
    expect(readFiniteNumber(12.5)).toBe(12.5)
    expect(readFiniteNumber(" 12.5 ")).toBe(12.5)
    expect(readFiniteNumber({ precision: 20, value: "12.5" })).toBe(12.5)
  })

  it.each([true, false, [], {}, "", "12px", Number.POSITIVE_INFINITY])(
    "rejects coercive numeric value %p",
    (value) => {
      expect(readFiniteNumber(value)).toBeNull()
    }
  )

  it("accepts only canonical safe integers", () => {
    expect(readNonNegativeSafeInteger("0")).toBe(0)
    expect(readPositiveSafeInteger({ value: "7" })).toBe(7)
    expect(readPositiveSafeInteger("7.0")).toBeNull()
    expect(readPositiveSafeInteger(true)).toBeNull()
  })

  it("rejects arrays and primitive rows as records", () => {
    expect(asUnknownRecord([])).toBeNull()
    expect(readRecordArray([{}])).toEqual([{}])
    expect(readRecordArray([{}, false])).toBeNull()
    expect(readRecordArray(undefined, { optional: true })).toEqual([])
  })

  it("bounds text and requires complete offset-aware timestamps", () => {
    expect(readBoundedText(" value ", 5)).toBe("value")
    expect(readBoundedText("value!", 5)).toBeNull()
    expect(readIsoTimestamp("2026-08-30T12:00:00Z")).toBe(
      "2026-08-30T12:00:00.000Z"
    )
    expect(readIsoTimestamp("2026-08-30")).toBeNull()
  })
})
