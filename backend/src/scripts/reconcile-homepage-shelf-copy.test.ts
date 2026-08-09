import {
  buildHomepageShelfCopyManifest,
  hashHomepageShelfCopyManifest,
  parseHomepageShelfCopyArguments,
} from "./reconcile-homepage-shelf-copy"

describe("homepage shelf copy reconciliation guards", () => {
  const hash = "a".repeat(64)

  it("defaults to non-mutating preview mode", () => {
    expect(parseHomepageShelfCopyArguments([])).toEqual({
      apply: false,
      expectedCount: null,
      expectedManifestSha256: null,
    })
  })

  it("requires reviewed count and manifest identity in apply mode", () => {
    expect(() => parseHomepageShelfCopyArguments(["--apply"])).toThrow("Apply mode requires")
    expect(
      parseHomepageShelfCopyArguments([
        "--apply",
        "--expected-count=2",
        `--expected-manifest-sha256=${hash}`,
      ])
    ).toEqual({
      apply: true,
      expectedCount: 2,
      expectedManifestSha256: hash,
    })
  })

  it("rejects malformed guard values", () => {
    expect(() => parseHomepageShelfCopyArguments(["--expected-count=-1"])).toThrow(
      "non-negative integer"
    )
    expect(() =>
      parseHomepageShelfCopyArguments(["--expected-manifest-sha256=not-a-hash"])
    ).toThrow("lowercase SHA-256")
  })

  it("hashes stable manifests deterministically", () => {
    const manifest = buildHomepageShelfCopyManifest([])
    expect(hashHomepageShelfCopyManifest(manifest)).toBe(
      "74b9745d0ddae85f58d690e873255c29867cd44a76aab02ce1f1d7c834a9f62a"
    )
  })
})
