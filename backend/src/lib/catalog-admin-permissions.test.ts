import { hasPermission } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";

import {
  adminAuthorizationManifest,
  type AdminHttpMethod,
  type AdminRouteTemplate,
} from "./admin-authorization-manifest";
import {
  type AdminPolicyAction,
  catalogAdminActions,
  nativeAdminActions,
} from "./admin-permissions";

const policiesFor = (
  method: AdminHttpMethod,
  template: AdminRouteTemplate,
): AdminPolicyAction[] => {
  const entry = adminAuthorizationManifest.find(
    (candidate) =>
      candidate.method === method && candidate.template === template,
  );
  if (!entry) {
    throw new Error(`Missing authorization manifest entry: ${method} ${template}`);
  }
  return [...entry.policies];
};

const routePolicies = {
  authoringView: policiesFor(
    "GET",
    "/admin/catalog/products/:product_id/authoring-view",
  ),
  bundleUpdate: policiesFor(
    "PUT",
    "/admin/catalog/products/:product_id/bundle",
  ),
  compositeCreate: policiesFor("POST", "/admin/catalog/products"),
  profileDelete: policiesFor(
    "DELETE",
    "/admin/catalog/products/:product_id/profile",
  ),
  shelfRead: policiesFor("GET", "/admin/catalog/shelves"),
} as const;

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

type RoleExpectation = Readonly<Record<keyof typeof routePolicies, boolean>>;

type RoleCase = Readonly<{
  expected: RoleExpectation;
  grants: readonly AdminPolicyAction[];
  name: string;
}>;

const deniesAll: RoleExpectation = {
  authoringView: false,
  bundleUpdate: false,
  compositeCreate: false,
  profileDelete: false,
  shelfRead: false,
};

const nativeReadGrants = [
  nativeAdminActions.product.read,
  nativeAdminActions.productVariant.read,
  nativeAdminActions.price.read,
  nativeAdminActions.inventoryItem.read,
  nativeAdminActions.inventoryLevel.read,
] as const;

const compositeCreateGrants = [
  catalogAdminActions.authoring.create,
  catalogAdminActions.authoring.update,
  catalogAdminActions.taxonomy.create,
  nativeAdminActions.product.create,
  nativeAdminActions.productVariant.read,
  nativeAdminActions.inventoryItem.read,
  nativeAdminActions.inventoryItem.create,
  nativeAdminActions.inventoryLevel.create,
  nativeAdminActions.price.create,
] as const;

const bundleUpdateGrants = [
  catalogAdminActions.authoring.update,
  nativeAdminActions.product.read,
  nativeAdminActions.productVariant.read,
  nativeAdminActions.inventoryItem.read,
  nativeAdminActions.inventoryItem.create,
  nativeAdminActions.inventoryItem.update,
  nativeAdminActions.inventoryItem.delete,
] as const;

const roleCases: readonly RoleCase[] = [
  {
    expected: deniesAll,
    grants: [],
    name: "unprivileged role",
  },
  {
    expected: deniesAll,
    grants: [
      ...nativeReadGrants,
      nativeAdminActions.product.create,
      nativeAdminActions.inventoryItem.create,
      nativeAdminActions.inventoryItem.update,
      nativeAdminActions.inventoryItem.delete,
      nativeAdminActions.inventoryLevel.create,
      nativeAdminActions.price.create,
    ],
    name: "native catalog operator without custom capabilities",
  },
  {
    expected: { ...deniesAll, authoringView: true },
    grants: [
      catalogAdminActions.authoring.read,
      catalogAdminActions.taxonomy.read,
      ...nativeReadGrants,
    ],
    name: "complete catalog authoring reader",
  },
  {
    expected: deniesAll,
    grants: compositeCreateGrants.filter(
      ({ resource, operation }) =>
        resource !== "catalog_authoring" || operation !== "update",
    ),
    name: "composite creator without shared-asset update access",
  },
  {
    expected: { ...deniesAll, compositeCreate: true },
    grants: compositeCreateGrants,
    name: "complete composite product creator",
  },
  {
    expected: deniesAll,
    grants: [catalogAdminActions.merchandising.read],
    name: "merchandising reader without product visibility",
  },
  {
    expected: { ...deniesAll, shelfRead: true },
    grants: [
      catalogAdminActions.merchandising.read,
      nativeAdminActions.product.read,
    ],
    name: "complete merchandising reader",
  },
  {
    expected: deniesAll,
    grants: [catalogAdminActions.authoring.delete],
    name: "profile deleter without merchandising cleanup access",
  },
  {
    expected: { ...deniesAll, profileDelete: true },
    grants: [
      catalogAdminActions.authoring.delete,
      catalogAdminActions.merchandising.update,
    ],
    name: "complete product profile deleter",
  },
  {
    expected: deniesAll,
    grants: bundleUpdateGrants.filter(
      ({ resource, operation }) =>
        resource !== "inventory_item" || operation !== "delete",
    ),
    name: "bundle editor without inventory unlink access",
  },
  {
    expected: { ...deniesAll, bundleUpdate: true },
    grants: bundleUpdateGrants,
    name: "complete bundle editor",
  },
  {
    expected: {
      authoringView: true,
      bundleUpdate: true,
      compositeCreate: true,
      profileDelete: true,
      shelfRead: true,
    },
    grants: [{ operation: "*", resource: "*" }],
    name: "wildcard administrator",
  },
];

describe("catalog Admin role contract", () => {
  it.each(roleCases)(
    "default-denies incomplete capabilities for $name",
    async ({ expected, grants }) => {
      const container = createPermissionContainer(grants);
      const results = await Promise.all(
        Object.entries(routePolicies).map(async ([route, actions]) => [
          route,
          await hasPermission({ actions, container, roles: "role_test" }),
        ]),
      );

      expect(Object.fromEntries(results)).toEqual(expected);
    },
  );
});

describe("native Product mutation overlay role contract", () => {
  it.each([
    {
      expectedProduct: false,
      expectedVariant: false,
      grants: [],
      name: "no update grants",
    },
    {
      expectedProduct: true,
      expectedVariant: false,
      grants: [nativeAdminActions.product.update],
      name: "Product update only",
    },
    {
      expectedProduct: false,
      expectedVariant: true,
      grants: [nativeAdminActions.productVariant.update],
      name: "Variant update only",
    },
    {
      expectedProduct: true,
      expectedVariant: true,
      grants: [{ operation: "*", resource: "*" }],
      name: "wildcard administrator",
    },
  ])(
    "default-denies missing mutation capabilities for $name",
    async ({ expectedProduct, expectedVariant, grants }) => {
      const container = createPermissionContainer(grants);
      const [productAllowed, variantAllowed] = await Promise.all([
        hasPermission({
          actions: [nativeAdminActions.product.update],
          container,
          roles: "role_test",
        }),
        hasPermission({
          actions: [nativeAdminActions.productVariant.update],
          container,
          roles: "role_test",
        }),
      ]);

      expect(productAllowed).toBe(expectedProduct);
      expect(variantAllowed).toBe(expectedVariant);
    },
  );
});
