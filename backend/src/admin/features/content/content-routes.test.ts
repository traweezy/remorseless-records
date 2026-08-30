import {
  contentAppRoutePaths,
  contentRoutePaths,
  replaceLegacyContentLocation,
} from "./content-routes"

describe("Content Admin routes", () => {
  it("keeps router links free of the Medusa app prefix", () => {
    expect(contentRoutePaths).toEqual({
      discography: "/content/discography",
      news: "/content/news",
      overview: "/content",
    })
  })

  it.each([
    ["news", "/app/content/news"],
    ["discography", "/app/content/discography"],
  ] as const)(
    "replaces the legacy %s location without adding browser history",
    (workspace, target) => {
      const replace = jest.fn()

      replaceLegacyContentLocation({ replace }, workspace)

      expect(contentAppRoutePaths[workspace]).toBe(target)
      expect(replace).toHaveBeenCalledWith(target)
    }
  )
})
