import { parseMonetaryMigrationArguments } from "./monetary-migration"

const manifest = "a".repeat(64)

describe("monetary migration arguments", () => {
  it("defaults to a non-mutating dry run", () => {
    expect(parseMonetaryMigrationArguments([])).toEqual({ apply: false })
  })

  it("requires the exact expected count and manifest for apply mode", () => {
    expect(
      parseMonetaryMigrationArguments([
        "--apply",
        "--expected-count=588",
        `--expected-manifest-sha256=${manifest}`,
      ])
    ).toEqual({
      apply: true,
      expectedCount: 588,
      expectedManifestSha256: manifest,
    })
  })

  it.each([
    ["missing count", ["--apply", `--expected-manifest-sha256=${manifest}`]],
    [
      "invalid count",
      [
        "--apply",
        "--expected-count=1.5",
        `--expected-manifest-sha256=${manifest}`,
      ],
    ],
    ["missing hash", ["--apply", "--expected-count=588"]],
    [
      "invalid hash",
      ["--apply", "--expected-count=588", "--expected-manifest-sha256=nope"],
    ],
    ["unknown flag", ["--force"]],
  ])("rejects %s", (_label, args) => {
    expect(() => parseMonetaryMigrationArguments(args)).toThrow(
      "[money-migration]"
    )
  })
})
