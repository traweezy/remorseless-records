import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(
  new URL("../backend/package.json", import.meta.url)
)
const root = dirname(require.resolve("@medusajs/dashboard/package.json"))
const ts = require("typescript")
const helperNames = [
  "getClaimInventoryVariantIds",
  "readClaimInventoryLocationMap",
  "claimInventoryLocationWarning",
]

const readHelpers = (entry) => {
  const text = readFileSync(join(root, "dist", entry), "utf8")
  const source = ts.createSourceFile(entry, text, ts.ScriptTarget.Latest, true)
  const functions = []
  const visit = (node) => {
    if (
      ts.isFunctionDeclaration(node) &&
      helperNames.includes(node.name?.getText(source))
    )
      functions.push(node.getText(source))
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.equal(
    functions.length,
    3,
    "Complete native inventory guidance helpers must be installed"
  )
  return vm.runInNewContext(
    `${functions.join("\n")}\n({${helperNames.join(",")}})`
  )
}

const component = (id, locations = ["sloc_hq"]) => ({
  inventory_item_id: id,
  required_quantity: 1,
  inventory: {
    id,
    location_levels: locations.map((location_id) => ({ location_id })),
  },
})
const variant = (id = "variant_a") => ({
  id,
  manage_inventory: true,
  inventory_items: [component(`iitem_${id}`)],
})
const read = async (helpers, variants, transform = (value) => value) => {
  const requests = []
  const result = await helpers.readClaimInventoryLocationMap(
    variants.map((row) => row.id),
    async (query) => {
      requests.push(query)
      return transform({
        variants: variants.slice(query.offset, query.offset + query.limit),
        count: variants.length,
        offset: query.offset,
        limit: query.limit,
      })
    }
  )
  return {
    result: JSON.parse(JSON.stringify(result)),
    requests: JSON.parse(JSON.stringify(requests)),
  }
}

for (const entry of [
  "order-create-claim-ZMJRSB2U.mjs",
  "order-create-return-CZVXDD6A.mjs",
  "app.js",
]) {
  test(`${entry}: fresh field-array rows use canonical order variants`, () => {
    const helpers = readHelpers(entry)
    const orderItems = [
      {
        id: "ordli_a",
        variant_id: "variant_a",
        variant: { manage_inventory: true },
      },
      {
        id: "ordli_b",
        variant_id: "variant_a",
        variant: { manage_inventory: true },
      },
      { id: "ordli_manual", variant_id: null },
      {
        id: "ordli_unmanaged",
        variant_id: "variant_unmanaged",
        variant: { manage_inventory: false },
      },
    ]
    const fields = orderItems.map((item) => ({
      item_id: item.id,
      variant_id: "variant_stale",
    }))
    assert.deepEqual(
      [...helpers.getClaimInventoryVariantIds(orderItems, fields)],
      ["variant_a"]
    )
    assert.throws(() =>
      helpers.getClaimInventoryVariantIds(orderItems, [
        { item_id: "ordli_other" },
      ])
    )
    assert.throws(() =>
      helpers.getClaimInventoryVariantIds(
        [{ id: "ordli_a", variant_id: "variant_a" }],
        [{ item_id: "ordli_a" }]
      )
    )
    assert.throws(() =>
      helpers.getClaimInventoryVariantIds(
        [orderItems[0], orderItems[0]],
        fields
      )
    )
  })

  test(`${entry}: paginates all selected variants through the native endpoint`, async () => {
    const helpers = readHelpers(entry)
    const variants = Array.from({ length: 101 }, (_, index) =>
      variant(`variant_${index}`)
    )
    const { result, requests } = await read(helpers, variants)
    assert.equal(Object.keys(result).length, 101)
    assert.deepEqual(result.variant_100, ["sloc_hq"])
    assert.deepEqual(
      requests.map((query) => query.offset),
      [0, 100]
    )
    assert.ok(
      requests.every(
        (query) =>
          query.limit === 100 &&
          query.id.length === 101 &&
          query.fields.includes("inventory_items.inventory.location_levels")
      )
    )
  })

  test(`${entry}: inventory kits require a level for every component`, async () => {
    const helpers = readHelpers(entry)
    const kit = variant()
    kit.inventory_items = [
      component("iitem_a", ["sloc_hq", "sloc_other"]),
      component("iitem_b", ["sloc_other"]),
    ]
    const { result } = await read(helpers, [kit])
    assert.deepEqual(result.variant_a, ["sloc_other"])
    const context = { key: "current", status: "ready", locations: result }
    assert.equal(
      helpers.claimInventoryLocationWarning(
        context,
        "current",
        [kit.id],
        "sloc_hq"
      ),
      true
    )
    assert.equal(
      helpers.claimInventoryLocationWarning(
        context,
        "current",
        [kit.id],
        "sloc_other"
      ),
      false
    )
  })

  test(`${entry}: loading, failed and stale reads never assert a missing level`, () => {
    const helpers = readHelpers(entry)
    for (const status of ["loading", "unavailable"])
      assert.equal(
        helpers.claimInventoryLocationWarning(
          { key: "current", status, locations: {} },
          "current",
          ["variant_a"],
          "sloc_hq"
        ),
        false
      )
    assert.equal(
      helpers.claimInventoryLocationWarning(
        { key: "old", status: "ready", locations: { variant_a: [] } },
        "current",
        ["variant_a"],
        "sloc_hq"
      ),
      false
    )
    assert.equal(
      helpers.claimInventoryLocationWarning(
        { key: "current", status: "ready", locations: { variant_a: [] } },
        "current",
        ["variant_a"],
        undefined
      ),
      false
    )
  })

  test(`${entry}: retains unmanaged and confirmed empty-location outcomes`, async () => {
    const helpers = readHelpers(entry)
    const { result } = await read(helpers, [
      { id: "variant_a", manage_inventory: false },
      { id: "variant_b", manage_inventory: true, inventory_items: [] },
    ])
    assert.deepEqual(result, { variant_a: null, variant_b: [] })
    const context = { key: "current", status: "ready", locations: result }
    assert.equal(
      helpers.claimInventoryLocationWarning(
        context,
        "current",
        ["variant_a"],
        "sloc_hq"
      ),
      false
    )
    assert.equal(
      helpers.claimInventoryLocationWarning(
        context,
        "current",
        ["variant_b"],
        "sloc_hq"
      ),
      true
    )
  })

  test(`${entry}: rejects incomplete, changed or ambiguous native pages`, async () => {
    const helpers = readHelpers(entry)
    for (const transform of [
      (value) => ({ ...value, count: 0 }),
      (value) => ({ ...value, offset: 1 }),
      (value) => ({ ...value, limit: 20 }),
      (value) => ({ ...value, variants: [] }),
      (value) => ({ ...value, variants: [variant(), variant()] }),
      (value) => ({ ...value, variants: [variant("variant_other")] }),
      () => null,
    ])
      await assert.rejects(read(helpers, [variant()], transform))
    const variants = Array.from({ length: 101 }, (_, index) =>
      variant(`variant_${index}`)
    )
    await assert.rejects(
      read(helpers, variants, (value) =>
        value.offset > 0 ? { ...value, count: 100 } : value
      )
    )
    await assert.rejects(
      helpers.readClaimInventoryLocationMap(["variant_a"], async () => {
        throw Error("native request failed")
      })
    )
  })

  test(`${entry}: rejects malformed inventory relationships and levels`, async () => {
    const helpers = readHelpers(entry)
    for (const change of [
      (row) => {
        delete row.manage_inventory
      },
      (row) => {
        delete row.inventory_items
      },
      (row) => {
        row.inventory_items[0].inventory.id = "iitem_other"
      },
      (row) => {
        row.inventory_items[0].required_quantity = 0
      },
      (row) => {
        row.inventory_items[0].required_quantity = Infinity
      },
      (row) => {
        row.inventory_items[0].inventory.location_levels = null
      },
      (row) => {
        row.inventory_items.push(row.inventory_items[0])
      },
      (row) => {
        row.inventory_items[0].inventory.location_levels.push({
          location_id: "sloc_hq",
        })
      },
      (row) => {
        row.inventory_items[0].inventory.location_levels[0].location_id =
          "invalid"
      },
    ]) {
      const row = variant()
      change(row)
      await assert.rejects(read(helpers, [row]))
    }
    await assert.rejects(
      helpers.readClaimInventoryLocationMap(
        ["variant_a", "variant_a"],
        async () => {}
      )
    )
    await assert.rejects(
      helpers.readClaimInventoryLocationMap(
        Array.from({ length: 251 }, (_, index) => `variant_${index}`),
        async () => {}
      )
    )
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          await helpers.readClaimInventoryLocationMap([], async () => {
            throw Error("No call expected")
          })
        )
      ),
      {}
    )
  })
}
