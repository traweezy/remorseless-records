import {
  readFiniteNumber,
  readIsoTimestamp,
  readNonNegativeSafeInteger,
} from "./primitives"

describe("provider primitive boundaries", () => {
  it("accepts finite numeric literals and value wrappers", () => {
    expect(readFiniteNumber(12.5)).toBe(12.5)
    expect(readFiniteNumber(" 12.5 ")).toBe(12.5)
    expect(readFiniteNumber({ precision: 20, value: "12.5" })).toBe(12.5)
  })

  it.each([null, true, false, "", "Infinity", "12 dollars", {}, []])(
    "rejects coercive numeric input %p",
    (value) => {
      expect(readFiniteNumber(value)).toBeNull()
    }
  )

  it("accepts only non-negative safe integers", () => {
    expect(readNonNegativeSafeInteger("42")).toBe(42)
    expect(readNonNegativeSafeInteger(-1)).toBeNull()
    expect(readNonNegativeSafeInteger(1.5)).toBeNull()
    expect(readNonNegativeSafeInteger(Number.MAX_SAFE_INTEGER + 1)).toBeNull()
  })

  it("normalizes Date and offset-aware ISO timestamps", () => {
    expect(readIsoTimestamp(new Date("2026-08-30T12:00:00.000Z"))).toBe(
      "2026-08-30T12:00:00.000Z"
    )
    expect(readIsoTimestamp("2026-08-30T08:00:00-04:00")).toBe(
      "2026-08-30T12:00:00.000Z"
    )
  })

  it.each([null, true, 1_788_091_200_000, "2026-08-30", "not-a-date"])(
    "rejects ambiguous timestamp input %p",
    (value) => {
      expect(readIsoTimestamp(value)).toBeNull()
    }
  )
})
