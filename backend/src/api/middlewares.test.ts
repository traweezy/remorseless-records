import type { MiddlewareRoute } from "@medusajs/framework/http";

import { nativeAdminActions } from "../lib/admin-permissions";
import middlewares, { contentAdminPolicyRoutes } from "./middlewares";

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

const policyFor = (method: string, path: string) => {
  const matches = contentAdminPolicyRoutes.filter((route) =>
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
    expect(policyFor(method, path)).toEqual({ operation, resource });
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
