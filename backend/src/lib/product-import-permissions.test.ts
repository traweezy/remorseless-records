import { hasPermission } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";

import {
  type AdminPolicyAction,
  nativeAdminActions,
  productImportAdminActions,
} from "./admin-permissions";

const prepareActions = [
  nativeAdminActions.product.read,
  nativeAdminActions.file.create,
  productImportAdminActions.productImport.create,
];

const confirmActions = [
  nativeAdminActions.product.read,
  productImportAdminActions.productImport.update,
];

const createPermissionContainer = (grants: readonly AdminPolicyAction[]) =>
  ({
    resolve: (
      registrationName: string,
      options?: Readonly<{ allowUnregistered?: boolean }>,
    ) => {
      if (registrationName === ContainerRegistrationKeys.FEATURE_FLAG_ROUTER) {
        return { isFeatureEnabled: (key: string) => key === "rbac" };
      }
      if (registrationName === ContainerRegistrationKeys.QUERY) {
        return {
          graph: async () => ({
            data: [
              {
                id: "role_test",
                policies: grants.map((grant, index) => ({
                  id: `policy_${index}`,
                  ...grant,
                })),
              },
            ],
          }),
        };
      }
      if (registrationName === Modules.CACHING && options?.allowUnregistered) {
        return undefined;
      }
      throw new Error(`Unexpected container registration: ${registrationName}`);
    },
  }) as unknown as Parameters<typeof hasPermission>[0]["container"];

type RoleCase = Readonly<{
  confirm: boolean;
  grants: readonly AdminPolicyAction[];
  name: string;
  prepare: boolean;
}>;

const roleCases: readonly RoleCase[] = [
  {
    confirm: false,
    grants: [nativeAdminActions.product.read],
    name: "product reader",
    prepare: false,
  },
  {
    confirm: false,
    grants: [
      nativeAdminActions.product.read,
      nativeAdminActions.file.create,
    ],
    name: "product reader with upload access",
    prepare: false,
  },
  {
    confirm: false,
    grants: [
      nativeAdminActions.file.create,
      productImportAdminActions.productImport.create,
    ],
    name: "import preparer without product read access",
    prepare: false,
  },
  {
    confirm: false,
    grants: [
      nativeAdminActions.product.read,
      productImportAdminActions.productImport.create,
    ],
    name: "import preparer without file upload access",
    prepare: false,
  },
  {
    confirm: false,
    grants: [
      nativeAdminActions.product.read,
      nativeAdminActions.file.create,
      { operation: "create", resource: "product" },
      { operation: "update", resource: "product" },
    ],
    name: "manual product editor without import access",
    prepare: false,
  },
  {
    confirm: false,
    grants: prepareActions,
    name: "import preparer",
    prepare: true,
  },
  {
    confirm: false,
    grants: [productImportAdminActions.productImport.update],
    name: "import confirmer without product read access",
    prepare: false,
  },
  {
    confirm: true,
    grants: confirmActions,
    name: "import confirmer",
    prepare: false,
  },
  {
    confirm: true,
    grants: [...prepareActions, ...confirmActions],
    name: "full import operator",
    prepare: true,
  },
  {
    confirm: true,
    grants: [{ operation: "*", resource: "*" }],
    name: "wildcard administrator",
    prepare: true,
  },
];

describe("product import role contract", () => {
  it.each(roleCases)(
    "grants only the intended import actions to $name",
    async ({ confirm, grants, prepare }) => {
      const container = createPermissionContainer(grants);

      await expect(
        hasPermission({
          actions: prepareActions,
          container,
          roles: "role_test",
        }),
      ).resolves.toBe(prepare);
      await expect(
        hasPermission({
          actions: confirmActions,
          container,
          roles: "role_test",
        }),
      ).resolves.toBe(confirm);
    },
  );
});
