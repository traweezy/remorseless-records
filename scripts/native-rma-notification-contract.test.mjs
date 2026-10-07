import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import test from "node:test"
import vm from "node:vm"

const require = createRequire(
  new URL("../backend/package.json", import.meta.url)
)
const medusaRoot = dirname(require.resolve("@medusajs/medusa/package.json"))
const flowsRoot = dirname(dirname(require.resolve("@medusajs/core-flows")))
const ts = require("typescript")
const nativeUtils = require("@medusajs/framework/utils")

const receiptTransform = () => {
  const entry = "dist/order/workflows/return/confirm-receive-return-request.js"
  const source = ts.createSourceFile(
    entry,
    readFileSync(join(flowsRoot, entry), "utf8"),
    ts.ScriptTarget.Latest,
    true
  )
  let transform
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) ===
        "{ updateReturnItem, returnedQuantityMap, updateReturn }"
    ) {
      assert.ok(ts.isCallExpression(node.initializer))
      transform = node.initializer.arguments[1].getText(source)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(transform, "The installed native receipt transform is required")
  return vm.runInNewContext(`(${transform})`, { utils_1: nativeUtils })
}
const returnItem = (id, quantity, received = 0, damaged = 0) => ({
  id: `retitem_${id}`,
  item_id: id,
  quantity,
  received_quantity: received,
  damaged_quantity: damaged,
  item: { variant_id: "variant_a" },
})
const receiptAction = (id, quantity, damaged = false) => ({
  action: damaged
    ? nativeUtils.ChangeActionType.RECEIVE_DAMAGED_RETURN_ITEM
    : nativeUtils.ChangeActionType.RECEIVE_RETURN_ITEM,
  details: { reference_id: id, quantity },
})
const calculateReceipt = (items, actions) =>
  receiptTransform()({
    orderReturn: { id: "return_fixture", items },
    orderChange: { actions },
  })
const plain = (value) =>
  JSON.parse(JSON.stringify(value), (key, entry) =>
    ["received_quantity", "damaged_quantity"].includes(key) ||
    key.startsWith("variant_")
      ? Number(entry)
      : entry
  )

test("split receipts retain prior quantities and restock only the new batch", () => {
  const result = calculateReceipt(
    [returnItem("item_a", 2, 1)],
    [receiptAction("item_a", 1)]
  )
  assert.deepEqual(plain(result.updateReturnItem), [
    { id: "retitem_item_a", received_quantity: 2, damaged_quantity: 0 },
  ])
  assert.deepEqual(plain(result.returnedQuantityMap), { variant_a: 1 })
  assert.equal(result.updateReturn.status, nativeUtils.ReturnStatus.RECEIVED)
})

test("a usable second batch preserves previously received damaged units", () => {
  const result = calculateReceipt(
    [returnItem("item_a", 2, 1, 1)],
    [receiptAction("item_a", 1)]
  )
  assert.deepEqual(plain(result.updateReturnItem), [
    { id: "retitem_item_a", received_quantity: 2, damaged_quantity: 1 },
  ])
  assert.deepEqual(plain(result.returnedQuantityMap), { variant_a: 1 })
  assert.equal(result.updateReturn.status, nativeUtils.ReturnStatus.RECEIVED)
})

test("a damaged second batch completes receipt without restocking it", () => {
  const result = calculateReceipt(
    [returnItem("item_a", 2, 1)],
    [receiptAction("item_a", 1, true)]
  )
  assert.deepEqual(plain(result.updateReturnItem), [
    { id: "retitem_item_a", received_quantity: 2, damaged_quantity: 1 },
  ])
  assert.deepEqual(plain(result.returnedQuantityMap), {})
  assert.equal(result.updateReturn.status, nativeUtils.ReturnStatus.RECEIVED)
})

test("mixed actions aggregate within a batch and preserve other return items", () => {
  const result = calculateReceipt(
    [returnItem("item_a", 4, 1, 1), returnItem("item_b", 1, 1)],
    [
      receiptAction("item_a", 1),
      receiptAction("item_a", 1, true),
      receiptAction("item_a", 1),
    ]
  )
  assert.deepEqual(plain(result.updateReturnItem), [
    { id: "retitem_item_a", received_quantity: 4, damaged_quantity: 2 },
  ])
  assert.deepEqual(plain(result.returnedQuantityMap), { variant_a: 2 })
  assert.equal(result.updateReturn.status, nativeUtils.ReturnStatus.RECEIVED)
})

test("an incomplete batch remains partial and aggregates shared variants", () => {
  const result = calculateReceipt(
    [returnItem("item_a", 3), returnItem("item_b", 2, 1)],
    [receiptAction("item_a", 1), receiptAction("item_b", 1)]
  )
  assert.deepEqual(plain(result.returnedQuantityMap), { variant_a: 2 })
  assert.equal(
    result.updateReturn.status,
    nativeUtils.ReturnStatus.PARTIALLY_RECEIVED
  )
})

const operations = [
  [
    "returns/[id]/request",
    "confirmReturnRequestWorkflow",
    "return_id",
    "return/confirm-return-request",
    "RETURN_REQUESTED",
  ],
  [
    "returns/[id]/receive/confirm",
    "confirmReturnReceiveWorkflow",
    "return_id",
    "return/confirm-receive-return-request",
    "RETURN_RECEIVED",
  ],
  [
    "claims/[id]/request",
    "confirmClaimRequestWorkflow",
    "claim_id",
    "claim/confirm-claim-request",
    "CLAIM_CREATED",
  ],
  [
    "exchanges/[id]/request",
    "confirmExchangeRequestWorkflow",
    "exchange_id",
    "exchange/confirm-exchange-request",
    "EXCHANGE_CREATED",
  ],
]

for (const [route, workflow, idField, file, event] of operations) {
  test(`${route}: forwards the validated checkbox and native actor`, async () => {
    const source = readFileSync(
      join(medusaRoot, "dist/api/admin", route, "route.js"),
      "utf8"
    )
    for (const preference of [false, true, undefined]) {
      let submitted
      const exports = {}
      vm.runInNewContext(source, {
        exports,
        require: (id) => {
          if (id === "@medusajs/core-flows")
            return {
              [workflow]: () => ({
                run: async ({ input }) => {
                  submitted = input
                  return { result: {} }
                },
              }),
            }
          if (id === "@medusajs/framework/utils")
            return {
              ContainerRegistrationKeys: { REMOTE_QUERY: "query" },
              remoteQueryObjectFromString: (input) => input,
            }
          if (id.includes("query-config")) return {}
          throw Error(`Unexpected route dependency: ${id}`)
        },
      })
      await exports.POST(
        {
          params: { id: "owned_fixture" },
          auth_context: { actor_id: "user_fixture" },
          validatedBody: { no_notification: preference },
          body: { no_notification: !preference },
          queryConfig: { fields: ["id"] },
          filterableFields: {},
          scope: { resolve: () => async () => [{ id: "owned_fixture" }] },
        },
        { json: () => {} }
      )
      assert.deepEqual(JSON.parse(JSON.stringify(submitted)), {
        [idField]: "owned_fixture",
        confirmed_by: "user_fixture",
        no_notification: preference !== false,
      })
    }
  })

  test(`${file}: binds event preference to the confirmed native change`, () => {
    const source = readFileSync(
      join(flowsRoot, "dist/order/workflows", `${file}.js`),
      "utf8"
    )
    const start = source.indexOf(
      `eventName: utils_1.OrderWorkflowEvents.${event},`
    )
    assert.ok(start >= 0)
    const dataStart = source.indexOf("data: {", start) + 6
    const dataEnd = source.indexOf("\n        },", dataStart)
    assert.ok(dataEnd > dataStart)
    const data = source.slice(dataStart, dataEnd) + "\n}"
    for (const preference of [false, true, undefined, "false"]) {
      const result = vm.runInNewContext(`(${data})`, {
        order: { id: "order_fixture" },
        orderChange: { id: "ordch_fixture" },
        orderReturn: { id: "return_fixture" },
        orderClaim: { id: "claim_fixture" },
        orderExchange: { id: "oexc_fixture" },
        updateReturn: { status: "received" },
        input: { no_notification: preference },
        workflows_sdk_1: { transform: (input, transform) => transform(input) },
      })
      assert.equal(result.order_id, "order_fixture")
      assert.equal(result.order_change_id, "ordch_fixture")
      assert.equal(result.no_notification, preference !== false)
      if (event === "RETURN_RECEIVED")
        assert.equal(result.return_status, "received")
    }
    const type = readFileSync(
      join(flowsRoot, "dist/order/workflows", `${file}.d.ts`),
      "utf8"
    )
    assert.match(type, /no_notification\?: boolean;/u)
  })
}

for (const [resource, schema] of [
  ["claims", "AdminPostClaimsConfirmRequestReqSchema"],
  ["exchanges", "AdminPostExchangesConfirmRequestReqSchema"],
]) {
  test(`${resource}: validates preference while retaining native RBAC`, () => {
    const source = readFileSync(
      join(medusaRoot, "dist/api/admin", resource, "middlewares.js"),
      "utf8"
    )
    const start = source.indexOf(`matcher: "/admin/${resource}/:id/request"`)
    const end = source.indexOf("method:", start)
    const confirmation = source.slice(start, end)
    assert.match(
      confirmation,
      new RegExp(`validateAndTransformBody\\)\\(validators_1\\.${schema}\\)`)
    )
    assert.match(confirmation, /policies:/u)
    assert.match(confirmation, /PolicyOperation\.update/u)
    const validator = require(
      join(medusaRoot, "dist/api/admin", resource, "validators.js")
    )[schema]
    for (const no_notification of [false, true])
      assert.equal(
        validator.parse({ no_notification }).no_notification,
        no_notification
      )
    for (const no_notification of ["false", 0, null, []])
      assert.throws(() => validator.parse({ no_notification }))
  })
}
