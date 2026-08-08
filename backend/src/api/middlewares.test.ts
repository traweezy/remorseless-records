import type { MiddlewareRoute } from "@medusajs/framework/http";

import {
  nativeAdminActions,
  operationsAdminActions,
} from "../lib/admin-permissions";
import middlewares, {
  contentAdminPolicyRoutes,
  operationsAdminPolicyRoutes,
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

const policyFor = (
  routes: MiddlewareRoute[],
  method: string,
  path: string,
) => {
  const matches = routes.filter((route) =>
    routeMatches(route, method, path),
  );
  expect(matches).toHaveLength(1);
  return matches[0]?.policies;
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
    [
      "POST",
      "/admin/discography/disco_01/archive",
      "discography",
      "update",
    ],
    [
      "POST",
      "/admin/discography/disco_01/restore",
      "discography",
      "update",
    ],
  ])("maps %s %s to %s:%s", (method, path, resource, operation) => {
    expect(policyFor(contentAdminPolicyRoutes, method, path)).toEqual({
      operation,
      resource,
    });
  });

  it("protects managed uploads with Medusa's native file permission", () => {
    const uploadRoute = (middlewares.routes ?? []).find(
      (route) =>
        route.matcher === "/admin/managed-uploads" &&
        route.methods?.includes("POST"),
    );

    expect(uploadRoute?.policies).toEqual(nativeAdminActions.file.create);
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
    [
      "POST",
      "/admin/tax-control/taxrate-io/refresh",
      "tax_control",
      "update",
    ],
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
    expect(policyFor(operationsAdminPolicyRoutes, method, path)).toEqual({
      operation,
      resource,
    });
  });

  it("uses distinct read and update capabilities for sensitive actions", () => {
    expect(
      policyFor(operationsAdminPolicyRoutes, "GET", "/admin/tax-control"),
    ).toEqual(operationsAdminActions.taxControl.read);
    expect(
      policyFor(
        operationsAdminPolicyRoutes,
        "POST",
        "/admin/tax-control/switch",
      ),
    ).toEqual(operationsAdminActions.taxControl.update);
    expect(
      policyFor(
        operationsAdminPolicyRoutes,
        "POST",
        "/admin/catalog/media/assets/media_01/quarantine",
      ),
    ).toEqual(operationsAdminActions.mediaCleanup.update);
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
