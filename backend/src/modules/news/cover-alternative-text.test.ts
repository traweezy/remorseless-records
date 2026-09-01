import { resolveNewsCoverAlternativeText } from "./cover-alternative-text"

describe("resolveNewsCoverAlternativeText", () => {
  it("preserves authored alternative text for cover artwork", () => {
    expect(
      resolveNewsCoverAlternativeText(
        "Studio report",
        "https://media.example/studio.jpg",
        "A mixing desk under red lights"
      )
    ).toBe("A mixing desk under red lights")
  })

  it("provides an accessible fallback for legacy cover artwork", () => {
    expect(
      resolveNewsCoverAlternativeText(
        "Studio report",
        "https://media.example/studio.jpg",
        null
      )
    ).toBe("Studio report cover artwork")
  })

  it("omits alternative text when no cover is present", () => {
    expect(
      resolveNewsCoverAlternativeText(
        "Studio report",
        null,
        "Unused alternative text"
      )
    ).toBeNull()
  })
})
