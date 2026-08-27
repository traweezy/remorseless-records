type TransformResult = { code: string; map: null } | null

type ZodStrictCspVitePlugin = {
  enforce: "pre"
  name: string
  transform: (source: string, moduleId: string) => TransformResult
}

const { createZodStrictCspVitePlugin } = require(
  "./zod-strict-csp-vite-plugin.cjs"
) as {
  createZodStrictCspVitePlugin: () => ZodStrictCspVitePlugin
}

const probeSource = `
export const allowsEval = cached(() => {
  if (globalConfig.jitless) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  }
  catch (_) {
    return false;
  }
});
`

describe("Zod strict-CSP Vite plugin", () => {
  it("removes the eval capability probe from every Zod core utility module", () => {
    const plugin = createZodStrictCspVitePlugin()
    const result = plugin.transform(
      probeSource,
      "/workspace/node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/util.js"
    )

    expect(plugin.name).toBe("remorseless-zod-strict-csp")
    expect(plugin.enforce).toBe("pre")
    expect(result?.code).not.toContain("Function")
    expect(result?.code).toContain("return false;")
    expect(result?.map).toBeNull()
  })

  it("supports Windows paths and Vite query suffixes", () => {
    const result = createZodStrictCspVitePlugin().transform(
      probeSource,
      "C:\\workspace\\node_modules\\zod\\v4\\core\\util.cjs?commonjs-entry"
    )

    expect(result?.code).not.toContain("new F")
  })

  it("removes probes from prebundled Dashboard modules", () => {
    const bundledSource = [
      'const captureStackTrace="captureStackTrace" in Error;',
      'navigator?.userAgent?.includes("Cloudflare");',
      'Object.prototype.hasOwnProperty.call(value,"isPrototypeOf");',
      'const allowsEval=cached(()=>{try{const t=Function;return new t(""),!0}catch{return!1}});',
    ].join("")
    const result = createZodStrictCspVitePlugin().transform(
      bundledSource,
      "/workspace/node_modules/@medusajs/dashboard/dist/index.mjs"
    )

    expect(result?.code).not.toContain("Function")
    expect(result?.code).toContain("return false;")
  })

  it("ignores unrelated modules", () => {
    const result = createZodStrictCspVitePlugin().transform(
      probeSource,
      "/workspace/src/admin/validation.ts"
    )

    expect(result).toBeNull()
  })

  it("fails closed when Zod changes the reviewed probe shape", () => {
    expect(() =>
      createZodStrictCspVitePlugin().transform(
        "export const allowsEval = () => true",
        "/workspace/node_modules/zod/v4/core/util.js"
      )
    ).toThrow("Expected one Zod eval capability probe")
  })
})
