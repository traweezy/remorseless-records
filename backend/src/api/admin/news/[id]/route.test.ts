import { DELETE } from "./route"

describe("DELETE /admin/news/:id", () => {
  it("rejects physical deletion in favor of archive", async () => {
    await expect(DELETE()).rejects.toThrow(
      "News posts are retained for audit history. Archive the post instead."
    )
  })
})
