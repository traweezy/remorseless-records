import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"
import vm from "node:vm"

const backendRequire = createRequire(
  new URL("../backend/package.json", import.meta.url)
)
const dashboardRequire = createRequire(
  backendRequire.resolve("@medusajs/dashboard/package.json")
)
const resolverRoot = dirname(
  dashboardRequire.resolve("@hookform/resolvers/package.json")
)
const resolverRequire = createRequire(join(resolverRoot, "package.json"))
const z4 = dashboardRequire("zod")
const z3 = dashboardRequire("zod/v3")
const options = { fields: {}, shouldUseNativeValidation: false }

const loadResolver = async (entry) => {
  const path = join(resolverRoot, "zod/dist", entry)
  if (entry === "zod.js") return resolverRequire(path).zodResolver
  if (entry === "zod.umd.js") {
    const exports = {}
    vm.runInNewContext(readFileSync(path, "utf8"), {
      exports,
      module: { exports },
      require: resolverRequire,
    })
    return exports.zodResolver
  }
  return (await import(pathToFileURL(path).href)).zodResolver
}

for (const entry of [
  "zod.js",
  "zod.mjs",
  "zod.module.js",
  "zod.modern.mjs",
  "zod.umd.js",
]) {
  test(`${entry}: native Admin validation supports both installed Zod formats`, async () => {
    const resolver = await loadResolver(entry)
    for (const z of [z3, z4]) {
      const schema = z.object({
        label: z.string().min(1, "Label required"),
        code: z.string().min(1, "Code required"),
      })
      const result = await resolver(schema)(
        { label: "", code: "" },
        undefined,
        options
      )
      assert.equal(result.errors.label.message, "Label required")
      assert.equal(result.errors.code.message, "Code required")
      assert.equal(Object.keys(result.values).length, 0)
      const valid = { label: "Audit", code: "audit" }
      assert.deepEqual(
        JSON.parse(
          JSON.stringify(await resolver(schema)(valid, undefined, options))
        ),
        {
          errors: {},
          values: valid,
        }
      )
    }
  })
  test(`${entry}: nested Zod 4 union paths, arrays and criteria survive conversion`, async () => {
    const resolver = await loadResolver(entry)
    const schema = z4.object({
      rows: z4.array(
        z4.object({
          choice: z4.union([
            z4.object({ name: z4.string().min(1, "Name required") }),
            z4.object({ count: z4.number().min(1) }),
          ]),
        })
      ),
    })
    const result = await resolver(schema)(
      { rows: [{ choice: { name: 12 } }] },
      undefined,
      { ...options, criteriaMode: "all" }
    )
    assert.ok(result.errors.rows[0].choice.name.message)
    assert.ok(result.errors.rows[0].choice.count.message)
    const repeated = z4.object({
      label: z4.string().min(3, "Too short").regex(/^A/u, "Start with A"),
    })
    const all = await resolver(repeated)({ label: "b" }, undefined, {
      ...options,
      criteriaMode: "all",
    })
    assert.equal(all.errors.label.types.too_small, "Too short")
    assert.equal(all.errors.label.types.invalid_format, "Start with A")
    const union = z4.object({
      selection: z4.discriminatedUnion("type", [
        z4.object({ type: z4.literal("one"), name: z4.string() }),
      ]),
    })
    assert.ok(
      (
        await resolver(union)(
          { selection: { type: "other" } },
          undefined,
          options
        )
      ).errors.selection
    )
  })
  test(`${entry}: transform/raw/sync/native paths and genuine exceptions remain intact`, async () => {
    const resolver = await loadResolver(entry)
    const schema = z4.object({ label: z4.string().trim() })
    const input = { label: " Audit " }
    assert.equal(
      (await resolver(schema)(input, undefined, options)).values.label,
      "Audit"
    )
    assert.equal(
      (
        await resolver(schema, undefined, { raw: true, mode: "sync" })(
          input,
          undefined,
          options
        )
      ).values.label,
      input.label
    )
    let validity
    let reports = 0
    const ref = {
      setCustomValidity: (value) => {
        validity = value
      },
      reportValidity: () => {
        reports += 1
      },
    }
    const native = {
      fields: { label: { ref } },
      shouldUseNativeValidation: true,
    }
    const required = z4.object({ label: z4.string().min(1, "Label required") })
    await resolver(required)({ label: "" }, undefined, native)
    assert.equal(validity, "Label required")
    await resolver(required)({ label: "Audit" }, undefined, native)
    assert.equal(validity, "")
    assert.equal(reports, 2)
    for (const failure of [new Error("Unexpected"), null, { issues: [] }]) {
      await assert.rejects(
        resolver({
          parseAsync: async () => {
            throw failure
          },
        })({}, undefined, options),
        (error) => error === failure
      )
    }
  })
}
