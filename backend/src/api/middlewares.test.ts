import path from "node:path";

import type {
  MedusaRequest,
  MedusaResponse,
  MiddlewareRoute,
} from "@medusajs/framework/http";

import {
  adminAuthorizationManifest,
  adminAuthorizationPolicyRoutes,
} from "../lib/admin-authorization-manifest";
import {
  nativeAdminActions,
  operationsAdminActions,
  productImportAdminActions,
} from "../lib/admin-permissions";
import middlewares, {
  contentAdminPolicyRoutes,
  applySecurityBoundaryHeaders,
  nativeAdminPolicyOverlayRoutes,
  operationsAdminMiddlewareRoutes,
  operationsAdminPolicyRoutes,
  productImportAdminPolicyRoutes,
  rejectDeprecatedProductImport,
} from "./middlewares";

jest.mock("../lib/constants", () => ({
  STORE_CORS: "http://localhost:3000",
}));

const routeMatches = (
  route: MiddlewareRoute,
  method: string,
  path: string,
): boolean => {
  if (!route.methods?.some((candidate) => candidate === method)) {
    return false;
  }
  return typeof route.matcher === "string"
    ? route.matcher === path
    : route.matcher.test(path);
};

const policyFor = (routes: MiddlewareRoute[], method: string, path: string) => {
  const matches = routes.filter(
    (route) =>
      route.policies !== undefined && routeMatches(route, method, path),
  );
  expect(matches).toHaveLength(1);
  return matches[0]?.policies;
};

type PinnedSortableRoute = {
  [key: string]: unknown;
  marker?: string;
  matcher: string | RegExp;
};

type PinnedRouteSorter = new (routes: ReadonlyArray<PinnedSortableRoute>) => {
  sort: () => PinnedSortableRoute[];
};

describe("content Admin RBAC middleware", () => {
  it.each([
    ["GET", "/admin/news", "news", "read"],
    ["POST", "/admin/news", "news", "create"],
    ["GET", "/admin/news/news_01", "news", "read"],
    ["PUT", "/admin/news/news_01", "news", "update"],
    ["DELETE", "/admin/news/news_01", "news", "delete"],
    ["POST", "/admin/news/news_01/archive", "news", "update"],
    ["POST", "/admin/news/news_01/restore", "news", "update"],
    ["GET", "/admin/discography", "discography", "read"],
    ["POST", "/admin/discography", "discography", "create"],
    ["GET", "/admin/discography/disco_01", "discography", "read"],
    ["PUT", "/admin/discography/disco_01", "discography", "update"],
    ["DELETE", "/admin/discography/disco_01", "discography", "delete"],
    ["POST", "/admin/discography/disco_01/archive", "discography", "update"],
    ["POST", "/admin/discography/disco_01/restore", "discography", "update"],
  ])("maps %s %s to %s:%s", (method, path, resource, operation) => {
    const expectedPolicies = [{ operation, resource }];
    if (resource === "discography" && operation === "read") {
      expectedPolicies.push(nativeAdminActions.product.read);
    }
    expect(policyFor(contentAdminPolicyRoutes, method, path)).toEqual(
      expectedPolicies,
    );
  });

  it("protects managed uploads with Medusa's native file permission", () => {
    expect(
      policyFor(middlewares.routes ?? [], "POST", "/admin/managed-uploads"),
    ).toEqual([nativeAdminActions.file.create]);
  });

  it("does not match nested or malformed content routes", () => {
    expect(
      contentAdminPolicyRoutes.some((route) =>
        routeMatches(route, "GET", "/admin/news/news_01/extra"),
      ),
    ).toBe(false);
    expect(
      contentAdminPolicyRoutes.some((route) =>
        routeMatches(route, "POST", "/admin/discography/disco_01/delete"),
      ),
    ).toBe(false);
  });
});

describe("operations Admin RBAC middleware", () => {
  it.each([
    ["GET", "/admin/tax-control", "tax_control", "read"],
    ["POST", "/admin/tax-control/switch", "tax_control", "update"],
    ["POST", "/admin/tax-control/taxrate-io/refresh", "tax_control", "update"],
    ["GET", "/admin/tax-records", "tax_records", "read"],
    ["GET", "/admin/tax-records/export", "tax_records", "read"],
    ["GET", "/admin/refund-operations", "refund_operations", "read"],
    ["GET", "/admin/catalog/media/orphans", "media_cleanup", "read"],
    [
      "POST",
      "/admin/catalog/media/assets/media_01/quarantine",
      "media_cleanup",
      "update",
    ],
    [
      "POST",
      "/admin/catalog/media/assets/media_01/restore",
      "media_cleanup",
      "update",
    ],
  ])("maps %s %s to %s:%s", (method, path, resource, operation) => {
    expect(policyFor(operationsAdminPolicyRoutes, method, path)).toEqual([
      { operation, resource },
    ]);
  });

  it("uses distinct read and update capabilities for sensitive actions", () => {
    expect(
      policyFor(operationsAdminPolicyRoutes, "GET", "/admin/tax-control"),
    ).toEqual([operationsAdminActions.taxControl.read]);
    expect(
      policyFor(
        operationsAdminPolicyRoutes,
        "POST",
        "/admin/tax-control/switch",
      ),
    ).toEqual([operationsAdminActions.taxControl.update]);
    expect(
      policyFor(
        operationsAdminPolicyRoutes,
        "POST",
        "/admin/catalog/media/assets/media_01/quarantine",
      ),
    ).toEqual([operationsAdminActions.mediaCleanup.update]);
  });

  it("does not grant a policy to malformed or unsupported operations routes", () => {
    expect(
      operationsAdminPolicyRoutes.some((route) =>
        routeMatches(route, "POST", "/admin/tax-records/export"),
      ),
    ).toBe(false);
    expect(
      operationsAdminPolicyRoutes.some((route) =>
        routeMatches(
          route,
          "POST",
          "/admin/catalog/media/assets/media_01/purge",
        ),
      ),
    ).toBe(false);
  });
});

describe("native Admin mutation policy overlays", () => {
  it.each([
    ["/admin/products/prod_01", nativeAdminActions.product.update],
    ["/ADMIN/PRODUCTS/PROD_01/", nativeAdminActions.product.update],
    [
      "/admin/products/prod_01/variants/variant_01",
      nativeAdminActions.productVariant.update,
    ],
    [
      "/ADMIN/PRODUCTS/PROD_01/VARIANTS/VARIANT_01/",
      nativeAdminActions.productVariant.update,
    ],
  ])("protects POST %s with the exact update action", (requestPath, action) => {
    expect(
      policyFor(nativeAdminPolicyOverlayRoutes, "POST", requestPath),
    ).toEqual([action]);
    expect(policyFor(middlewares.routes ?? [], "POST", requestPath)).toEqual([
      action,
    ]);
  });

  it.each([
    ["GET", "/admin/products/prod_01"],
    ["POST", "/admin/products/product_01"],
    ["POST", "/admin/products/import"],
    ["POST", "/admin/products/imports"],
    ["POST", "/admin/products/batch"],
    ["POST", "/admin/products/export"],
    ["POST", "/admin/products/prod_01/variants/not-a-variant"],
    ["POST", "/admin/products/prod_01/variants/variant_01/extra"],
  ])("does not overlay unsupported or static %s %s", (method, requestPath) => {
    expect(
      nativeAdminPolicyOverlayRoutes.some((route) =>
        routeMatches(route, method, requestPath),
      ),
    ).toBe(false);
  });

  it("sorts each overlay before the pinned native validator and handler", () => {
    const frameworkEntry = require.resolve("@medusajs/framework");
    const routesSorterPath = path.join(
      path.dirname(frameworkEntry),
      "http/routes-sorter.js",
    );
    const medusaEntry = require.resolve("@medusajs/medusa");
    const productMiddlewarePath = path.join(
      path.dirname(medusaEntry),
      "api/admin/products/middlewares.js",
    );
    const { RoutesSorter } = jest.requireActual<{
      RoutesSorter: PinnedRouteSorter;
    }>(routesSorterPath);
    const { adminProductRoutesMiddlewares } = jest.requireActual<{
      adminProductRoutesMiddlewares: MiddlewareRoute[];
    }>(productMiddlewarePath);
    const cases = [
      {
        requestPath: "/admin/products/prod_01",
        template: "/admin/products/:id",
      },
      {
        requestPath: "/admin/products/prod_01/variants/variant_01",
        template: "/admin/products/:id/variants/:variant_id",
      },
    ] as const;

    cases.forEach(({ requestPath, template }) => {
      const overlay = nativeAdminPolicyOverlayRoutes.find((route) =>
        routeMatches(route, "POST", requestPath),
      );
      const coreValidator = adminProductRoutesMiddlewares.find((route) => {
        const method = (
          route as MiddlewareRoute & { method?: readonly string[] }
        ).method;
        return route.matcher === template && method?.includes("POST");
      });
      expect(overlay).toBeDefined();
      expect(coreValidator).toBeDefined();
      expect(coreValidator?.policies).toBeUndefined();
      if (!overlay || !coreValidator) {
        return;
      }

      const sorted = new RoutesSorter([
        { ...overlay, marker: "project-overlay" },
        { ...coreValidator, marker: "core-validator" },
        {
          isRoute: true,
          matcher: template,
          method: "POST",
          marker: "core-handler",
        },
      ]).sort();
      const markers = sorted.map(({ marker }) => marker);

      expect(markers.indexOf("project-overlay")).toBeLessThan(
        markers.indexOf("core-validator"),
      );
      expect(markers.indexOf("project-overlay")).toBeLessThan(
        markers.indexOf("core-handler"),
      );
    });
  });
});

describe("Admin middleware composition", () => {
  it("applies global security and default no-store headers", () => {
    const next = jest.fn();
    const removeHeader = jest.fn();
    const setHeader = jest.fn();

    applySecurityBoundaryHeaders(
      {
        method: "GET",
        path: "/admin/products",
      } as MedusaRequest,
      { removeHeader, setHeader } as unknown as MedusaResponse,
      next,
    );

    expect(removeHeader).toHaveBeenCalledWith("X-Powered-By");
    expect(setHeader).toHaveBeenCalledWith("X-Frame-Options", "DENY");
    expect(setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(setHeader).toHaveBeenCalledWith(
      "Content-Security-Policy",
      expect.stringContaining("base-uri 'none'"),
    );
    expect(setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("mounts every manifest policy exactly once", () => {
    const configuredRoutes = middlewares.routes ?? [];

    adminAuthorizationManifest.forEach((entry) => {
      const renderedPath = entry.template.replace(
        /:[a-z][a-z0-9_]*/gi,
        "test_ID-01",
      );
      expect(policyFor(configuredRoutes, entry.method, renderedPath)).toEqual(
        entry.policies,
      );
    });
  });

  it("sorts every generated policy before its matching route handler", () => {
    const frameworkEntry = require.resolve("@medusajs/framework");
    const routesSorterPath = path.join(
      path.dirname(frameworkEntry),
      "http/routes-sorter.js",
    );
    const { RoutesSorter } = jest.requireActual<{
      RoutesSorter: PinnedRouteSorter;
    }>(routesSorterPath);

    adminAuthorizationManifest.forEach((entry, index) => {
      const policyRoute = adminAuthorizationPolicyRoutes[index];
      expect(policyRoute).toBeDefined();
      if (!policyRoute) {
        return;
      }

      const sorted = new RoutesSorter([
        { ...policyRoute, marker: "project-policy" },
        {
          isRoute: true,
          matcher: entry.template,
          method: entry.method,
          marker: "route-handler",
        },
      ]).sort();
      const markers = sorted.map(({ marker }) => marker);

      expect(markers.indexOf("project-policy")).toBeLessThan(
        markers.indexOf("route-handler"),
      );
    });
  });

  it("keeps operational rate limits and body limits separate from policies", () => {
    expect(operationsAdminMiddlewareRoutes).toHaveLength(8);
    expect(
      operationsAdminMiddlewareRoutes.every(
        (route) => !Object.hasOwn(route, "policies"),
      ),
    ).toBe(true);
    expect(
      operationsAdminMiddlewareRoutes.find(
        ({ matcher }) => matcher === "/admin/tax-control/switch",
      )?.bodyParser,
    ).toEqual({ sizeLimit: "8kb" });
    expect(
      operationsAdminMiddlewareRoutes.find(
        ({ matcher }) => matcher === "/admin/tax-control/taxrate-io/refresh",
      )?.bodyParser,
    ).toEqual({ sizeLimit: "8kb" });
  });

  it.each([
    "/admin/catalog/media/assets/media_01/quarantine",
    "/admin/catalog/media/assets/media_01/restore/",
    "/ADMIN/CATALOG/MEDIA/ASSETS/media_01/QuArAnTiNe/",
  ])("rate limits equivalent media lifecycle path %s", (path) => {
    const matches = operationsAdminMiddlewareRoutes.filter((route) =>
      routeMatches(route, "POST", path),
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.middlewares).toHaveLength(1);
  });

  it.each([
    "/admin/catalog/media/assets/media_01/purge",
    "/admin/catalog/media/assets/media_01/restored",
    "/admin/catalog/media/assets/media_01/quarantine/extra",
    "/admin/catalog/media/assets//quarantine",
  ])("does not rate limit near media lifecycle path %s", (path) => {
    expect(
      operationsAdminMiddlewareRoutes.some((route) =>
        routeMatches(route, "POST", path),
      ),
    ).toBe(false);
  });

  it("keeps upload parsing after the catalog media rate limiter", () => {
    const configuredRoutes = middlewares.routes ?? [];
    const managedUploadRoute = configuredRoutes.find(
      ({ matcher, methods, middlewares: routeMiddlewares }) =>
        matcher === "/admin/managed-uploads" &&
        methods?.includes("POST") &&
        routeMiddlewares !== undefined,
    );
    const catalogUploadRoute = configuredRoutes.find(
      ({ matcher, methods, middlewares: routeMiddlewares }) =>
        matcher === "/admin/catalog/media/uploads" &&
        methods?.includes("POST") &&
        routeMiddlewares !== undefined,
    );

    expect(managedUploadRoute?.policies).toBeUndefined();
    expect(managedUploadRoute?.middlewares).toHaveLength(1);
    expect(catalogUploadRoute?.policies).toBeUndefined();
    expect(catalogUploadRoute?.middlewares).toHaveLength(2);
    expect(catalogUploadRoute?.middlewares?.[1]?.name).toBe(
      managedUploadRoute?.middlewares?.[0]?.name,
    );
  });

  it.each([
    ["managed upload", "/admin/managed-uploads"],
    ["catalog media upload", "/admin/catalog/media/uploads"],
  ])(
    "sorts the %s policy before multipart parsing and the handler",
    (_name, requestPath) => {
      const frameworkEntry = require.resolve("@medusajs/framework");
      const routesSorterPath = path.join(
        path.dirname(frameworkEntry),
        "http/routes-sorter.js",
      );
      const { RoutesSorter } = jest.requireActual<{
        RoutesSorter: PinnedRouteSorter;
      }>(routesSorterPath);
      const configuredRoutes = middlewares.routes ?? [];
      const policyRoute = configuredRoutes.find(
        (route) =>
          route.policies !== undefined &&
          routeMatches(route, "POST", requestPath),
      );
      const parserRoute = configuredRoutes.find(
        (route) =>
          route.middlewares !== undefined &&
          routeMatches(route, "POST", requestPath),
      );

      expect(policyRoute).toBeDefined();
      expect(parserRoute).toBeDefined();
      if (!policyRoute || !parserRoute) {
        return;
      }

      const sorted = new RoutesSorter([
        { ...policyRoute, marker: "project-policy" },
        { ...parserRoute, marker: "multipart-parser" },
        {
          isRoute: true,
          matcher: requestPath,
          method: "POST",
          marker: "route-handler",
        },
      ]).sort();
      const markers = sorted.map(({ marker }) => marker);

      expect(markers.indexOf("project-policy")).toBeLessThan(
        markers.indexOf("multipart-parser"),
      );
      expect(markers.indexOf("multipart-parser")).toBeLessThan(
        markers.indexOf("route-handler"),
      );
    },
  );
});

describe("product import Admin RBAC middleware", () => {
  const preparePolicies = [
    nativeAdminActions.product.read,
    nativeAdminActions.file.create,
    productImportAdminActions.productImport.create,
  ];
  const confirmPolicies = [
    nativeAdminActions.product.read,
    productImportAdminActions.productImport.update,
  ];

  it("uses exact regex matchers for every import route", () => {
    expect(
      productImportAdminPolicyRoutes.every(
        ({ matcher }) => matcher instanceof RegExp,
      ),
    ).toBe(true);
  });

  it("retires both deprecated routes before their core handlers", () => {
    const deprecatedPaths = [
      "/admin/products/import",
      "/admin/products/import/transaction_01/confirm",
    ];
    deprecatedPaths.forEach((path) => {
      const deprecatedRoute = productImportAdminPolicyRoutes.find(
        ({ matcher }) => matcher instanceof RegExp && matcher.test(path),
      );
      expect(deprecatedRoute?.bodyParser).toBe(false);
      expect(deprecatedRoute?.middlewares).toEqual([
        rejectDeprecatedProductImport,
      ]);
    });

    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const setHeader = jest.fn();
    const type = jest.fn();
    rejectDeprecatedProductImport(
      { path: "/admin/products/import" } as MedusaRequest,
      { json, setHeader, status, type } as unknown as MedusaResponse,
    );

    expect(setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "private, no-store",
    );
    expect(type).toHaveBeenCalledWith("application/problem+json");
    expect(status).toHaveBeenCalledWith(410);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "urn:remorseless-records:problem:deprecated-product-import",
        title: "Deprecated product import route",
        status: 410,
        detail:
          "Upload a validated CSV and prepare it through POST /admin/products/imports.",
        code: "deprecated_product_import",
        instance: "/admin/products/import",
        request_id: expect.any(String),
        trace_id: expect.stringMatching(/^[0-9a-f]{32}$/u),
      }),
    );
  });

  it("sorts the legacy rejection before Medusa's multipart parser", () => {
    const frameworkEntry = require.resolve("@medusajs/framework");
    const routesSorterPath = path.join(
      path.dirname(frameworkEntry),
      "http/routes-sorter.js",
    );
    const medusaEntry = require.resolve("@medusajs/medusa");
    const productMiddlewarePath = path.join(
      path.dirname(medusaEntry),
      "api/admin/products/middlewares.js",
    );
    const { RoutesSorter } = jest.requireActual<{
      RoutesSorter: PinnedRouteSorter;
    }>(routesSorterPath);
    const { adminProductRoutesMiddlewares } = jest.requireActual<{
      adminProductRoutesMiddlewares: MiddlewareRoute[];
    }>(productMiddlewarePath);
    const coreMultipartRoute = adminProductRoutesMiddlewares.find(
      ({ matcher }) => matcher === "/admin/products/import",
    );
    const projectRejectionRoute = productImportAdminPolicyRoutes.find(
      ({ matcher }) =>
        matcher instanceof RegExp && matcher.test("/admin/products/import"),
    );
    expect(coreMultipartRoute).toBeDefined();
    expect(projectRejectionRoute).toBeDefined();
    if (!coreMultipartRoute || !projectRejectionRoute) {
      return;
    }

    const sorted = new RoutesSorter([
      { ...coreMultipartRoute, marker: "core-multipart" },
      {
        isRoute: true,
        matcher: "/admin/products/import",
        method: "POST",
        marker: "core-handler",
      },
      { ...projectRejectionRoute, marker: "project-rejection" },
    ]).sort();
    const markers = sorted.map(({ marker }) => marker);

    expect(markers.indexOf("project-rejection")).toBeLessThan(
      markers.indexOf("core-multipart"),
    );
    expect(markers.indexOf("project-rejection")).toBeLessThan(
      markers.indexOf("core-handler"),
    );
  });

  it.each([
    ["/admin/products/import", preparePolicies],
    ["/ADMIN/PRODUCTS/IMPORT/", preparePolicies],
    ["/admin/products/imports", preparePolicies],
    ["/Admin/Products/Imports/", preparePolicies],
    ["/admin/products/import/transaction_01/confirm", confirmPolicies],
    ["/Admin/Products/Import/transaction_01/Confirm/", confirmPolicies],
    ["/admin/products/imports/transaction_01/confirm", confirmPolicies],
    ["/Admin/Products/Imports/transaction_01/Confirm/", confirmPolicies],
  ])("protects POST %s with its complete policy set", (path, policies) => {
    expect(policyFor(productImportAdminPolicyRoutes, "POST", path)).toEqual(
      policies,
    );
    expect(policyFor(middlewares.routes ?? [], "POST", path)).toEqual(policies);
  });

  it.each([
    ["GET", "/admin/products/import"],
    ["POST", "/admin/products/imported"],
    ["POST", "/admin/products/import/confirm"],
    ["POST", "/admin/products/imports/confirm"],
    ["POST", "/admin/products/import/transaction_01/confirm/extra"],
    ["POST", "/admin/products/imports/transaction_01/confirm/extra"],
  ])("does not match unsupported %s %s", (method, path) => {
    expect(
      productImportAdminPolicyRoutes.some((route) =>
        routeMatches(route, method, path),
      ),
    ).toBe(false);
  });
});
