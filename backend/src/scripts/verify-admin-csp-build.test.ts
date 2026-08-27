const { countAdminEvalCapabilityProbes } = require(
  "./verify-admin-csp-build.js"
) as {
  countAdminEvalCapabilityProbes: (source: string) => number
}

describe("Admin CSP build verification", () => {
  it("detects minified and direct empty-Function probes", () => {
    const source = [
      'try{const t=Function;return new t(""),!0}catch{return!1}',
      'new Function("")',
      "Function('')",
    ].join(";")

    expect(countAdminEvalCapabilityProbes(source)).toBe(3)
  })

  it("does not reject ordinary function declarations", () => {
    expect(
      countAdminEvalCapabilityProbes(
        "const createFunction = (value) => () => value"
      )
    ).toBe(0)
  })
})
