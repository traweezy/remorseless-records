import type { PolicyDefinition } from "@medusajs/framework/utils"

export const adminPolicyOperations = {
  create: "create",
  delete: "delete",
  read: "read",
  update: "update",
} as const

export const contentAdminResources = {
  discography: "discography",
  news: "news",
} as const

export const operationsAdminResources = {
  mediaCleanup: "media_cleanup",
  refundOperations: "refund_operations",
  taxControl: "tax_control",
  taxRecords: "tax_records",
} as const

export const productImportAdminResources = {
  productImport: "product_import",
} as const

export const catalogAdminResources = {
  authoring: "catalog_authoring",
  merchandising: "catalog_merchandising",
  taxonomy: "catalog_taxonomy",
} as const

export type AdminPolicyAction = {
  operation: string
  resource: string
}

export type AdminPermissionKey = `${string}:${string}`

export const adminPermissionKey = ({
  operation,
  resource,
}: AdminPolicyAction): AdminPermissionKey => `${resource}:${operation}`

const createResourceActions = <const TResource extends string>(
  resource: TResource
) => ({
  create: {
    operation: adminPolicyOperations.create,
    resource,
  },
  delete: {
    operation: adminPolicyOperations.delete,
    resource,
  },
  read: {
    operation: adminPolicyOperations.read,
    resource,
  },
  update: {
    operation: adminPolicyOperations.update,
    resource,
  },
})

export const contentAdminActions = {
  discography: createResourceActions(contentAdminResources.discography),
  news: createResourceActions(contentAdminResources.news),
} as const

export const operationsAdminActions = {
  mediaCleanup: {
    read: {
      operation: adminPolicyOperations.read,
      resource: operationsAdminResources.mediaCleanup,
    },
    update: {
      operation: adminPolicyOperations.update,
      resource: operationsAdminResources.mediaCleanup,
    },
  },
  refundOperations: {
    read: {
      operation: adminPolicyOperations.read,
      resource: operationsAdminResources.refundOperations,
    },
  },
  taxControl: {
    read: {
      operation: adminPolicyOperations.read,
      resource: operationsAdminResources.taxControl,
    },
    update: {
      operation: adminPolicyOperations.update,
      resource: operationsAdminResources.taxControl,
    },
  },
  taxRecords: {
    read: {
      operation: adminPolicyOperations.read,
      resource: operationsAdminResources.taxRecords,
    },
  },
} as const

export const productImportAdminActions = {
  productImport: {
    create: {
      operation: adminPolicyOperations.create,
      resource: productImportAdminResources.productImport,
    },
    update: {
      operation: adminPolicyOperations.update,
      resource: productImportAdminResources.productImport,
    },
  },
} as const

export const catalogAdminActions = {
  authoring: createResourceActions(catalogAdminResources.authoring),
  merchandising: {
    create: {
      operation: adminPolicyOperations.create,
      resource: catalogAdminResources.merchandising,
    },
    read: {
      operation: adminPolicyOperations.read,
      resource: catalogAdminResources.merchandising,
    },
    update: {
      operation: adminPolicyOperations.update,
      resource: catalogAdminResources.merchandising,
    },
  },
  taxonomy: createResourceActions(catalogAdminResources.taxonomy),
} as const

export const nativeAdminActions = {
  productCategory: {
    delete: {
      operation: adminPolicyOperations.delete,
      resource: "product_category",
    },
  },
  productCollection: {
    delete: {
      operation: adminPolicyOperations.delete,
      resource: "product_collection",
    },
  },
  file: {
    create: {
      operation: adminPolicyOperations.create,
      resource: "file",
    },
  },
  inventoryItem: {
    create: {
      operation: adminPolicyOperations.create,
      resource: "inventory_item",
    },
    delete: {
      operation: adminPolicyOperations.delete,
      resource: "inventory_item",
    },
    read: {
      operation: adminPolicyOperations.read,
      resource: "inventory_item",
    },
    update: {
      operation: adminPolicyOperations.update,
      resource: "inventory_item",
    },
  },
  inventoryLevel: {
    create: {
      operation: adminPolicyOperations.create,
      resource: "inventory_level",
    },
    read: {
      operation: adminPolicyOperations.read,
      resource: "inventory_level",
    },
  },
  order: {
    read: {
      operation: adminPolicyOperations.read,
      resource: "order",
    },
  },
  product: {
    create: {
      operation: adminPolicyOperations.create,
      resource: "product",
    },
    delete: {
      operation: adminPolicyOperations.delete,
      resource: "product",
    },
    read: {
      operation: adminPolicyOperations.read,
      resource: "product",
    },
    update: {
      operation: adminPolicyOperations.update,
      resource: "product",
    },
  },
  productVariant: {
    delete: {
      operation: adminPolicyOperations.delete,
      resource: "product_variant",
    },
    read: {
      operation: adminPolicyOperations.read,
      resource: "product_variant",
    },
    update: {
      operation: adminPolicyOperations.update,
      resource: "product_variant",
    },
  },
  productOption: {
    delete: {
      operation: adminPolicyOperations.delete,
      resource: "product_option",
    },
    update: {
      operation: adminPolicyOperations.update,
      resource: "product_option",
    },
  },
  productOptionValue: {
    delete: {
      operation: adminPolicyOperations.delete,
      resource: "product_option_value",
    },
  },
  productTag: {
    delete: {
      operation: adminPolicyOperations.delete,
      resource: "product_tag",
    },
  },
  productType: {
    delete: {
      operation: adminPolicyOperations.delete,
      resource: "product_type",
    },
  },
  price: {
    create: {
      operation: adminPolicyOperations.create,
      resource: "price",
    },
    read: {
      operation: adminPolicyOperations.read,
      resource: "price",
    },
  },
  refundReason: {
    read: {
      operation: adminPolicyOperations.read,
      resource: "refund_reason",
    },
  },
} as const

const createResourcePolicyDefinitions = (
  resource: (typeof contentAdminResources)[keyof typeof contentAdminResources],
  displayName: string
): PolicyDefinition[] => [
  {
    description: `Read ${displayName}`,
    name: `Read${displayName}Content`,
    operation: adminPolicyOperations.read,
    resource,
  },
  {
    description: `Create ${displayName}`,
    name: `Create${displayName}Content`,
    operation: adminPolicyOperations.create,
    resource,
  },
  {
    description: `Update ${displayName}`,
    name: `Update${displayName}Content`,
    operation: adminPolicyOperations.update,
    resource,
  },
  {
    description: `Delete ${displayName}`,
    name: `Delete${displayName}Content`,
    operation: adminPolicyOperations.delete,
    resource,
  },
]

export const contentAdminPolicyDefinitions: PolicyDefinition[] = [
  ...createResourcePolicyDefinitions(contentAdminResources.news, "News"),
  ...createResourcePolicyDefinitions(
    contentAdminResources.discography,
    "Discography"
  ),
]

export const operationsAdminPolicyDefinitions: PolicyDefinition[] = [
  {
    description:
      "View tax provider status, readiness, usage, audit history, and payment tax evidence",
    name: "ReadTaxControlOperations",
    operation: adminPolicyOperations.read,
    resource: operationsAdminResources.taxControl,
  },
  {
    description:
      "Switch the active tax provider and refresh metered provider usage",
    name: "UpdateTaxControlOperations",
    operation: adminPolicyOperations.update,
    resource: operationsAdminResources.taxControl,
  },
  {
    description:
      "View and export tax filing records without customer contact or street-address data",
    name: "ReadTaxRecords",
    operation: adminPolicyOperations.read,
    resource: operationsAdminResources.taxRecords,
  },
  {
    description:
      "View Medusa, payment-provider, and tax-reversal refund reconciliation",
    name: "ReadRefundOperations",
    operation: adminPolicyOperations.read,
    resource: operationsAdminResources.refundOperations,
  },
  {
    description: "View unlinked and quarantined catalog media",
    name: "ReadMediaCleanup",
    operation: adminPolicyOperations.read,
    resource: operationsAdminResources.mediaCleanup,
  },
  {
    description: "Quarantine and restore unlinked catalog media",
    name: "UpdateMediaCleanup",
    operation: adminPolicyOperations.update,
    resource: operationsAdminResources.mediaCleanup,
  },
]

export const productImportAdminPolicyDefinitions: PolicyDefinition[] = [
  {
    description: "Prepare a product import plan from CSV input",
    name: "PrepareProductImport",
    operation: adminPolicyOperations.create,
    resource: productImportAdminResources.productImport,
  },
  {
    description: "Execute a prepared product import plan",
    name: "ExecuteProductImport",
    operation: adminPolicyOperations.update,
    resource: productImportAdminResources.productImport,
  },
]

const createCatalogPolicyDefinition = ({
  description,
  name,
  operation,
  resource,
}: Required<
  Pick<PolicyDefinition, "description" | "name" | "operation" | "resource">
>): PolicyDefinition => ({
  description,
  name,
  operation,
  resource,
})

export const catalogAdminPolicyDefinitions: PolicyDefinition[] = [
  createCatalogPolicyDefinition({
    description: "View catalog authoring profiles, bundles, and media",
    name: "ReadCatalogAuthoring",
    operation: adminPolicyOperations.read,
    resource: catalogAdminResources.authoring,
  }),
  createCatalogPolicyDefinition({
    description: "Create catalog authoring profiles, bundles, and media",
    name: "CreateCatalogAuthoring",
    operation: adminPolicyOperations.create,
    resource: catalogAdminResources.authoring,
  }),
  createCatalogPolicyDefinition({
    description: "Update catalog authoring profiles, bundles, and media",
    name: "UpdateCatalogAuthoring",
    operation: adminPolicyOperations.update,
    resource: catalogAdminResources.authoring,
  }),
  createCatalogPolicyDefinition({
    description: "Delete catalog authoring profiles, bundles, and media",
    name: "DeleteCatalogAuthoring",
    operation: adminPolicyOperations.delete,
    resource: catalogAdminResources.authoring,
  }),
  createCatalogPolicyDefinition({
    description: "View catalog artists and reference values",
    name: "ReadCatalogTaxonomy",
    operation: adminPolicyOperations.read,
    resource: catalogAdminResources.taxonomy,
  }),
  createCatalogPolicyDefinition({
    description: "Create catalog artists and reference values",
    name: "CreateCatalogTaxonomy",
    operation: adminPolicyOperations.create,
    resource: catalogAdminResources.taxonomy,
  }),
  createCatalogPolicyDefinition({
    description: "Update catalog artists and reference values",
    name: "UpdateCatalogTaxonomy",
    operation: adminPolicyOperations.update,
    resource: catalogAdminResources.taxonomy,
  }),
  createCatalogPolicyDefinition({
    description: "Delete catalog artists and reference values",
    name: "DeleteCatalogTaxonomy",
    operation: adminPolicyOperations.delete,
    resource: catalogAdminResources.taxonomy,
  }),
  createCatalogPolicyDefinition({
    description: "View catalog shelves and product placement",
    name: "ReadCatalogMerchandising",
    operation: adminPolicyOperations.read,
    resource: catalogAdminResources.merchandising,
  }),
  createCatalogPolicyDefinition({
    description: "Create catalog shelves and product placement",
    name: "CreateCatalogMerchandising",
    operation: adminPolicyOperations.create,
    resource: catalogAdminResources.merchandising,
  }),
  createCatalogPolicyDefinition({
    description: "Update and archive catalog shelves and product placement",
    name: "UpdateCatalogMerchandising",
    operation: adminPolicyOperations.update,
    resource: catalogAdminResources.merchandising,
  }),
]

export const contentReadPermissionKeys = [
  adminPermissionKey(contentAdminActions.news.read),
  adminPermissionKey(contentAdminActions.discography.read),
] as const

export const operationsReadPermissionKeys = [
  adminPermissionKey(operationsAdminActions.taxControl.read),
  adminPermissionKey(operationsAdminActions.taxRecords.read),
  adminPermissionKey(operationsAdminActions.refundOperations.read),
  adminPermissionKey(operationsAdminActions.mediaCleanup.read),
] as const
