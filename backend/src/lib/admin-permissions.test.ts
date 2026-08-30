import {
  adminPermissionKey,
  adminPolicyOperations,
  catalogAdminActions,
  catalogAdminPolicyDefinitions,
  catalogAdminResources,
  contentAdminActions,
  contentAdminPolicyDefinitions,
  contentAdminResources,
  contentReadPermissionKeys,
  nativeAdminActions,
  operationsAdminActions,
  operationsAdminPolicyDefinitions,
  operationsAdminResources,
  operationsReadPermissionKeys,
  productImportAdminActions,
  productImportAdminPolicyDefinitions,
  productImportAdminResources,
} from "./admin-permissions"

describe("catalog Admin permission contract", () => {
  it("defines the eleven reviewed capabilities exactly once", () => {
    expect(catalogAdminPolicyDefinitions).toHaveLength(11)

    const keys = catalogAdminPolicyDefinitions.map(adminPermissionKey)
    expect(new Set(keys).size).toBe(keys.length)
    expect(
      new Set(catalogAdminPolicyDefinitions.map(({ name }) => name)).size
    ).toBe(catalogAdminPolicyDefinitions.length)
    expect(new Set(keys)).toEqual(
      new Set([
        "catalog_authoring:read",
        "catalog_authoring:create",
        "catalog_authoring:update",
        "catalog_authoring:delete",
        "catalog_taxonomy:read",
        "catalog_taxonomy:create",
        "catalog_taxonomy:update",
        "catalog_taxonomy:delete",
        "catalog_merchandising:read",
        "catalog_merchandising:create",
        "catalog_merchandising:update",
      ])
    )
  })

  it("keeps authoring, taxonomy, and merchandising capabilities distinct", () => {
    expect(catalogAdminResources).toEqual({
      authoring: "catalog_authoring",
      merchandising: "catalog_merchandising",
      taxonomy: "catalog_taxonomy",
    })
    expect(adminPermissionKey(catalogAdminActions.authoring.update)).toBe(
      "catalog_authoring:update"
    )
    expect(adminPermissionKey(catalogAdminActions.taxonomy.create)).toBe(
      "catalog_taxonomy:create"
    )
    expect(adminPermissionKey(catalogAdminActions.merchandising.update)).toBe(
      "catalog_merchandising:update"
    )
    expect(catalogAdminActions.merchandising).not.toHaveProperty("delete")
  })

  it("keeps every custom definition key and name globally unique", () => {
    const definitions = [
      ...catalogAdminPolicyDefinitions,
      ...contentAdminPolicyDefinitions,
      ...operationsAdminPolicyDefinitions,
      ...productImportAdminPolicyDefinitions,
    ]
    expect(definitions).toHaveLength(27)
    expect(new Set(definitions.map(adminPermissionKey)).size).toBe(
      definitions.length
    )
    expect(new Set(definitions.map(({ name }) => name)).size).toBe(
      definitions.length
    )
  })
})

describe("content Admin permission contract", () => {
  it("defines each CRUD operation once for each content resource", () => {
    expect(contentAdminPolicyDefinitions).toHaveLength(8)

    const keys = contentAdminPolicyDefinitions.map(adminPermissionKey)
    expect(new Set(keys).size).toBe(keys.length)
    expect(
      new Set(contentAdminPolicyDefinitions.map(({ name }) => name)).size
    ).toBe(contentAdminPolicyDefinitions.length)
    expect(new Set(keys)).toEqual(
      new Set(
        Object.values(contentAdminResources).flatMap((resource) =>
          Object.values(adminPolicyOperations).map(
            (operation) => `${resource}:${operation}`
          )
        )
      )
    )
  })

  it("uses stable native-compatible permission keys", () => {
    expect(adminPermissionKey(contentAdminActions.news.update)).toBe(
      "news:update"
    )
    expect(adminPermissionKey(contentAdminActions.discography.read)).toBe(
      "discography:read"
    )
    expect(contentReadPermissionKeys).toEqual(["news:read", "discography:read"])
  })
})

describe("native Admin permission overlay contract", () => {
  it("uses Medusa's stable Product mutation permission keys", () => {
    expect(adminPermissionKey(nativeAdminActions.product.update)).toBe(
      "product:update"
    )
    expect(adminPermissionKey(nativeAdminActions.productVariant.update)).toBe(
      "product_variant:update"
    )
  })
})

describe("operations Admin permission contract", () => {
  it("defines the six least-privilege operations policies exactly once", () => {
    expect(operationsAdminPolicyDefinitions).toHaveLength(6)

    const keys = operationsAdminPolicyDefinitions.map(adminPermissionKey)
    expect(new Set(keys).size).toBe(keys.length)
    expect(
      new Set(operationsAdminPolicyDefinitions.map(({ name }) => name)).size
    ).toBe(operationsAdminPolicyDefinitions.length)
    expect(new Set(keys)).toEqual(
      new Set([
        "tax_control:read",
        "tax_control:update",
        "tax_records:read",
        "refund_operations:read",
        "media_cleanup:read",
        "media_cleanup:update",
      ])
    )
  })

  it("keeps view-only and state-changing capabilities separate", () => {
    expect(adminPermissionKey(operationsAdminActions.taxControl.read)).toBe(
      "tax_control:read"
    )
    expect(adminPermissionKey(operationsAdminActions.taxControl.update)).toBe(
      "tax_control:update"
    )
    expect(adminPermissionKey(operationsAdminActions.mediaCleanup.update)).toBe(
      "media_cleanup:update"
    )
    expect(Object.values(operationsAdminResources)).toEqual([
      "media_cleanup",
      "refund_operations",
      "tax_control",
      "tax_records",
    ])
    expect(operationsReadPermissionKeys).toEqual([
      "tax_control:read",
      "tax_records:read",
      "refund_operations:read",
      "media_cleanup:read",
    ])
  })
})

describe("product import Admin permission contract", () => {
  it("defines separate prepare and execute capabilities exactly once", () => {
    expect(productImportAdminPolicyDefinitions).toHaveLength(2)

    const keys = productImportAdminPolicyDefinitions.map(adminPermissionKey)
    expect(keys).toEqual(["product_import:create", "product_import:update"])
    expect(new Set(keys).size).toBe(keys.length)
    expect(productImportAdminPolicyDefinitions.map(({ name }) => name)).toEqual(
      ["PrepareProductImport", "ExecuteProductImport"]
    )
  })

  it("uses stable task-specific action keys", () => {
    expect(productImportAdminResources).toEqual({
      productImport: "product_import",
    })
    expect(
      adminPermissionKey(productImportAdminActions.productImport.create)
    ).toBe("product_import:create")
    expect(
      adminPermissionKey(productImportAdminActions.productImport.update)
    ).toBe("product_import:update")
  })
})
