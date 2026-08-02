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

export const nativeAdminActions = {
  file: {
    create: {
      operation: adminPolicyOperations.create,
      resource: "file",
    },
  },
  product: {
    read: {
      operation: adminPolicyOperations.read,
      resource: "product",
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

export const contentReadPermissionKeys = [
  adminPermissionKey(contentAdminActions.news.read),
  adminPermissionKey(contentAdminActions.discography.read),
] as const;
