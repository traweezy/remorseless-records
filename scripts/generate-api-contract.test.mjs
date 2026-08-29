import assert from "node:assert/strict"
import { test } from "node:test"

import {
  buildContract,
  extractRouteMethods,
  inventoryRoutes,
  REPOSITORY_ROOT,
  routePathFromFile,
  serializeContract,
} from "./generate-api-contract.mjs"

test("extracts declaration and re-exported route methods", () => {
  assert.deepEqual(
    extractRouteMethods(`
      export const GET = async () => new Response()
      export async function POST() {}
      export { PATCH, handler as DELETE }
    `),
    ["DELETE", "GET", "PATCH", "POST"]
  )
})

test("normalizes dynamic and grouped route segments", () => {
  assert.equal(
    routePathFromFile(
      "/repo/src/app",
      "/repo/src/app/(shop)/products/[id]/route.ts"
    ),
    "/products/{id}"
  )
})

test("inventories every custom route with complete error references", async () => {
  const inventory = await inventoryRoutes(REPOSITORY_ROOT)
  assert.equal(
    inventory.filter((entry) => entry.service === "backend").length,
    56
  )
  assert.equal(
    inventory.filter((entry) => entry.service === "storefront").length,
    30
  )
  assert.ok(inventory.every((entry) => entry.methods.length > 0))

  const contract = buildContract(inventory)
  assert.equal(contract.openapi, "3.1.0")
  assert.equal(contract["x-inventory"].routeFileCount, 86)
  assert.equal(contract["x-inventory"].routeOperationCount, 113)
  assert.equal(contract["x-inventory"].uniqueOperationCount, 111)

  const operationIds = []
  for (const [routePath, pathItem] of Object.entries(contract.paths)) {
    for (const operation of Object.values(pathItem)) {
      operationIds.push(operation.operationId)
      assert.ok(operation["x-route-files"].length >= 1)
      assert.ok(operation["x-services"].length >= 1)

      const expectedParameters = [...routePath.matchAll(/\{([^}]+)\}/gu)].map(
        (match) => match[1]
      )
      assert.deepEqual(
        (operation.parameters ?? []).map((parameter) => parameter.name),
        expectedParameters
      )

      for (const response of Object.values(operation.responses)) {
        if (response.$ref) {
          assert.match(
            response.$ref,
            /^\.\/api-problems\.yaml#\/components\/responses\/(ApiProblemResponse|NativeMedusaErrorResponse)$/u
          )
        }
      }
    }
  }

  assert.equal(new Set(operationIds).size, operationIds.length)
  assert.equal(serializeContract(contract), serializeContract(buildContract(inventory)))
})
