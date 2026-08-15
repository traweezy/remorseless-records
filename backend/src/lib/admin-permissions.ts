import type { PolicyDefinition } from "@medusajs/framework/utils";

export const adminPolicyOperations = {
  create: "create",
  delete: "delete",
  read: "read",
  update: "update",
} as const;

export const contentAdminResources = {
  discography: "discography",
  news: "news",
} as const;

export const operationsAdminResources = {
  mediaCleanup: "media_cleanup",
  refundOperations: "refund_operations",
  taxControl: "tax_control",
  taxRecords: "tax_records",
} as const;

export const productImportAdminResources = {
  productImport: "product_import",
} as const;

export type AdminPolicyAction = {
  operation: string;
  resource: string;
};

export type AdminPermissionKey = `${string}:${string}`;

export const adminPermissionKey = ({
  operation,
  resource,
}: AdminPolicyAction): AdminPermissionKey => `${resource}:${operation}`;

const createResourceActions = (resource: string) => ({
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
});

export const contentAdminActions = {
  discography: createResourceActions(contentAdminResources.discography),
  news: createResourceActions(contentAdminResources.news),
} as const;

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
} as const;

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
} as const;

export const nativeAdminActions = {
  file: {
    create: {
      operation: adminPolicyOperations.create,
      resource: "file",
    },
  },
  order: {
    read: {
      operation: adminPolicyOperations.read,
      resource: "order",
    },
  },
  product: {
    read: {
      operation: adminPolicyOperations.read,
      resource: "product",
    },
  },
  refundReason: {
    read: {
      operation: adminPolicyOperations.read,
      resource: "refund_reason",
    },
  },
} as const;

const createResourcePolicyDefinitions = (
  resource: (typeof contentAdminResources)[keyof typeof contentAdminResources],
  displayName: string,
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
];

export const contentAdminPolicyDefinitions: PolicyDefinition[] = [
  ...createResourcePolicyDefinitions(contentAdminResources.news, "News"),
  ...createResourcePolicyDefinitions(
    contentAdminResources.discography,
    "Discography",
  ),
];

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
];

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
];

export const contentReadPermissionKeys = [
  adminPermissionKey(contentAdminActions.news.read),
  adminPermissionKey(contentAdminActions.discography.read),
] as const;

export const operationsReadPermissionKeys = [
  adminPermissionKey(operationsAdminActions.taxControl.read),
  adminPermissionKey(operationsAdminActions.taxRecords.read),
  adminPermissionKey(operationsAdminActions.refundOperations.read),
  adminPermissionKey(operationsAdminActions.mediaCleanup.read),
] as const;
