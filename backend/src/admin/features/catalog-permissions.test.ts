import { adminPermissionKey } from "../../lib/admin-permissions"
import {
  catalogMerchandisingWorkspaceActions,
  catalogProductCreateActions,
  catalogProductEditActions,
  catalogProductSummaryReadActions,
  catalogVariantProfileActions,
} from "./catalog-permissions"

const permissionKeys = (
  actions: readonly { operation: string; resource: string }[],
): string[] => actions.map(adminPermissionKey)

const expectExactPermissions = (
  actions: readonly { operation: string; resource: string }[],
  expected: readonly string[],
): void => {
  const keys = permissionKeys(actions)

  expect(keys).toEqual(expected)
  expect(new Set(keys).size).toBe(keys.length)
}

describe("Catalog Admin permission contracts", () => {
  it("requires the complete product summary read contract", () => {
    expectExactPermissions(catalogProductSummaryReadActions, [
      "catalog_authoring:read",
      "catalog_taxonomy:read",
      "product:read",
      "product_variant:read",
      "price:read",
      "inventory_item:read",
      "inventory_level:read",
    ])
  })

  it("requires every variant profile read and write capability", () => {
    expectExactPermissions(catalogVariantProfileActions, [
      "catalog_authoring:read",
      "catalog_authoring:update",
      "catalog_taxonomy:read",
      "catalog_taxonomy:create",
      "product:read",
      "product_variant:read",
    ])
  })

  it("requires every merchandising read and write capability", () => {
    expectExactPermissions(catalogMerchandisingWorkspaceActions, [
      "catalog_merchandising:read",
      "catalog_merchandising:create",
      "catalog_merchandising:update",
      "product:read",
    ])
  })

  it("requires every product creation dependency", () => {
    expectExactPermissions(catalogProductCreateActions, [
      "catalog_authoring:read",
      "catalog_authoring:create",
      "catalog_authoring:update",
      "catalog_taxonomy:read",
      "catalog_taxonomy:create",
      "file:create",
      "product:read",
      "product:create",
      "product_variant:read",
      "inventory_item:read",
      "inventory_item:create",
      "inventory_level:create",
      "price:create",
    ])
  })

  it("requires every product editor dependency", () => {
    expectExactPermissions(catalogProductEditActions, [
      "catalog_authoring:read",
      "catalog_authoring:update",
      "catalog_authoring:delete",
      "catalog_taxonomy:read",
      "catalog_taxonomy:create",
      "product:read",
      "product:update",
      "product_variant:read",
      "inventory_item:read",
      "inventory_item:create",
      "inventory_item:update",
      "inventory_item:delete",
    ])
  })
})
