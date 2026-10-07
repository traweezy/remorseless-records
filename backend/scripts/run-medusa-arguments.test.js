const { buildForwardedArgs } = require("./run-medusa-arguments")

describe("Medusa script argument forwarding", () => {
  it("passes no arguments when none are present", () => {
    expect(buildForwardedArgs([])).toEqual([])
  })

  it("retains direct flag arguments for native Medusa exec", () => {
    expect(buildForwardedArgs(["--apply"])).toEqual(["--apply"])
  })

  it("removes pnpm's first separator without consuming script arguments", () => {
    expect(buildForwardedArgs(["--", "--apply", "--", "value"])).toEqual([
      "--apply",
      "--",
      "value",
    ])
  })
})
