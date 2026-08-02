import { loader } from "./page"

describe("legacy catalog authoring route", () => {
  it("redirects to the native Medusa product list without adding history", () => {
    const response = loader()

    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe("/products")
    expect(response.headers.get("x-remix-replace")).toBe("true")
  })
})
