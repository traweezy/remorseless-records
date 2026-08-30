import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

import ts from "typescript"

import {
  adminAuthorizationKey,
  adminAuthorizationManifest,
  adminAuthorizationPolicyRoutes,
  adminHttpMethods,
  type AdminHttpMethod,
  type AdminRouteTemplate,
} from "./admin-authorization-manifest"
import { adminPermissionKey } from "./admin-permissions"

const adminApiRoot = path.join(__dirname, "../api/admin")
const supportedMethods = new Set<string>(adminHttpMethods)

const routeFilesBelow = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return routeFilesBelow(entryPath)
    }
    return entry.isFile() && entry.name === "route.ts" ? [entryPath] : []
  })

const isExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  ts
    .getModifiers(node)
    ?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword) === true

const exportedHttpMethodsFromSource = (
  file: string,
  sourceText: string
): AdminHttpMethod[] => {
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS
  )

  return source.statements.flatMap((statement) => {
    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      return statement.exportClause.elements.flatMap((specifier) =>
        !specifier.isTypeOnly && supportedMethods.has(specifier.name.text)
          ? [specifier.name.text as AdminHttpMethod]
          : []
      )
    }
    if (!isExported(statement)) {
      return []
    }
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.flatMap(({ name }) =>
        ts.isIdentifier(name) && supportedMethods.has(name.text)
          ? [name.text as AdminHttpMethod]
          : []
      )
    }
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      supportedMethods.has(statement.name.text)
    ) {
      return [statement.name.text as AdminHttpMethod]
    }
    return []
  })
}

const exportedHttpMethods = (file: string): AdminHttpMethod[] =>
  exportedHttpMethodsFromSource(file, readFileSync(file, "utf8"))

const routeTemplateForFile = (file: string): AdminRouteTemplate => {
  const relativeDirectory = path.relative(adminApiRoot, path.dirname(file))
  const segments = relativeDirectory
    .split(path.sep)
    .filter(Boolean)
    .map((segment) => {
      const parameter = /^\[([a-z][a-z0-9_]*)\]$/i.exec(segment)?.[1]
      return parameter ? `:${parameter}` : segment
    })
  return `/admin/${segments.join("/")}` as AdminRouteTemplate
}

const discoveredAuthorizationKeys = (): string[] =>
  routeFilesBelow(adminApiRoot).flatMap((file) =>
    exportedHttpMethods(file).map((method) =>
      adminAuthorizationKey({
        method,
        template: routeTemplateForFile(file),
      })
    )
  )

const renderTemplate = (template: AdminRouteTemplate): string =>
  template.replace(/:[a-z][a-z0-9_]*/gi, "mixed_ID-01")

const catalogExpectedPolicies: Record<string, string[]> = {
  "DELETE /admin/catalog/artists/:id": ["catalog_taxonomy:delete"],
  "DELETE /admin/catalog/products/:product_id/bundle": [
    "catalog_authoring:delete",
    "product:read",
    "product_variant:read",
    "inventory_item:read",
    "inventory_item:delete",
  ],
  "DELETE /admin/catalog/products/:product_id/media": [
    "catalog_authoring:delete",
  ],
  "DELETE /admin/catalog/products/:product_id/profile": [
    "catalog_authoring:delete",
    "catalog_merchandising:update",
  ],
  "DELETE /admin/catalog/reference-values/:id": ["catalog_taxonomy:delete"],
  "DELETE /admin/catalog/shelves/:id": ["catalog_merchandising:update"],
  "DELETE /admin/catalog/variants/:variant_id/profile": [
    "catalog_authoring:delete",
  ],
  "GET /admin/catalog/artists": ["catalog_taxonomy:read"],
  "GET /admin/catalog/artists/:id": ["catalog_taxonomy:read"],
  "GET /admin/catalog/authoring-audit": [
    "catalog_authoring:read",
    "catalog_taxonomy:read",
    "product:read",
  ],
  "GET /admin/catalog/bundles": ["catalog_authoring:read"],
  "GET /admin/catalog/media/assets/:id": ["media_cleanup:read"],
  "GET /admin/catalog/media/orphans": ["media_cleanup:read"],
  "GET /admin/catalog/products/:product_id/authoring-view": [
    "catalog_authoring:read",
    "catalog_taxonomy:read",
    "product:read",
    "product_variant:read",
    "price:read",
    "inventory_item:read",
    "inventory_level:read",
  ],
  "GET /admin/catalog/products/:product_id/bundle": [
    "catalog_authoring:read",
    "product:read",
  ],
  "GET /admin/catalog/products/:product_id/media": [
    "catalog_authoring:read",
    "product:read",
  ],
  "GET /admin/catalog/products/:product_id/profile": [
    "catalog_authoring:read",
    "product:read",
  ],
  "GET /admin/catalog/products/status/:idempotency_key": [
    "catalog_authoring:read",
  ],
  "GET /admin/catalog/reference-values": ["catalog_taxonomy:read"],
  "GET /admin/catalog/reference-values/:id": ["catalog_taxonomy:read"],
  "GET /admin/catalog/shelves": ["catalog_merchandising:read", "product:read"],
  "GET /admin/catalog/shelves/:id": [
    "catalog_merchandising:read",
    "product:read",
  ],
  "GET /admin/catalog/shelves/:id/products": [
    "catalog_merchandising:read",
    "product:read",
  ],
  "GET /admin/catalog/variants/:variant_id/profile": [
    "catalog_authoring:read",
    "product_variant:read",
  ],
  "POST /admin/catalog/artists": ["catalog_taxonomy:create"],
  "POST /admin/catalog/bundles": [
    "catalog_authoring:create",
    "catalog_authoring:update",
    "product:read",
    "product_variant:read",
    "inventory_item:read",
    "inventory_item:create",
    "inventory_item:update",
    "inventory_item:delete",
  ],
  "POST /admin/catalog/media/assets/:id/quarantine": ["media_cleanup:update"],
  "POST /admin/catalog/media/assets/:id/restore": ["media_cleanup:update"],
  "POST /admin/catalog/media/uploads": [
    "catalog_authoring:create",
    "file:create",
  ],
  "POST /admin/catalog/products": [
    "catalog_authoring:create",
    "catalog_authoring:update",
    "catalog_taxonomy:create",
    "product:create",
    "product_variant:read",
    "inventory_item:read",
    "inventory_item:create",
    "inventory_level:create",
    "price:create",
  ],
  "POST /admin/catalog/reference-values": ["catalog_taxonomy:create"],
  "POST /admin/catalog/shelves": [
    "catalog_merchandising:create",
    "product:read",
  ],
  "POST /admin/catalog/shelves/:id/restore": [
    "catalog_merchandising:update",
    "product:read",
  ],
  "PUT /admin/catalog/artists/:id": ["catalog_taxonomy:update"],
  "PUT /admin/catalog/products/:product_id/bundle": [
    "catalog_authoring:update",
    "product:read",
    "product_variant:read",
    "inventory_item:read",
    "inventory_item:create",
    "inventory_item:update",
    "inventory_item:delete",
  ],
  "PUT /admin/catalog/products/:product_id/media": [
    "catalog_authoring:update",
    "product:read",
    "product_variant:read",
  ],
  "PUT /admin/catalog/products/:product_id/profile": [
    "catalog_authoring:update",
    "catalog_taxonomy:create",
    "product:read",
  ],
  "PUT /admin/catalog/reference-values/:id": ["catalog_taxonomy:update"],
  "PUT /admin/catalog/shelves/:id": [
    "catalog_merchandising:update",
    "product:read",
  ],
  "PUT /admin/catalog/shelves/:id/products": [
    "catalog_merchandising:update",
    "product:read",
  ],
  "PUT /admin/catalog/variants/:variant_id/profile": [
    "catalog_authoring:update",
    "catalog_taxonomy:create",
    "product_variant:read",
  ],
}

describe("Admin authorization manifest", () => {
  it("inventories variable, function, and named route exports", () => {
    expect(
      exportedHttpMethodsFromSource(
        "route.ts",
        [
          "export const GET = async () => undefined",
          "export async function POST() { return undefined }",
          "const PATCH = async () => undefined",
          "export { PATCH }",
          'export { worker as DELETE } from "./worker"',
          "export type { PUT }",
          "const PUT = async () => undefined",
        ].join("\n")
      )
    ).toEqual(["GET", "POST", "PATCH", "DELETE"])
  })

  it("covers every exported custom Admin method exactly once", () => {
    const discovered = discoveredAuthorizationKeys()
    const manifested = adminAuthorizationManifest.map(adminAuthorizationKey)

    expect(new Set(discovered).size).toBe(discovered.length)
    expect(new Set(manifested).size).toBe(manifested.length)
    expect(manifested.sort()).toEqual(discovered.sort())
  })

  it("compiles Express-equivalent exact matchers with one-segment params", () => {
    adminAuthorizationManifest.forEach((entry, index) => {
      const route = adminAuthorizationPolicyRoutes[index]
      expect(route).toBeDefined()
      expect(route?.matcher).toBeInstanceOf(RegExp)
      if (!(route?.matcher instanceof RegExp)) {
        return
      }

      const rendered = renderTemplate(entry.template)
      expect(route.matcher.test(rendered)).toBe(true)
      expect(route.matcher.test(rendered.toUpperCase())).toBe(true)
      expect(route.matcher.test(`${rendered}/`)).toBe(true)
      expect(route.matcher.test(`${rendered}/nested`)).toBe(false)
      expect(route.matcher.test(`/prefix${rendered}`)).toBe(false)
      if (entry.template.includes(":")) {
        expect(route.matcher.test(`${rendered}/extra-segment`)).toBe(false)
      }
    })
  })

  it("emits policy-only middleware entries", () => {
    expect(adminAuthorizationPolicyRoutes).toHaveLength(
      adminAuthorizationManifest.length
    )
    adminAuthorizationPolicyRoutes.forEach((route) => {
      expect(Array.isArray(route.policies)).toBe(true)
      expect(route.middlewares).toBeUndefined()
      expect(route.bodyParser).toBeUndefined()
    })
  })

  it("uses the reviewed catalog policy conjunctions exactly", () => {
    const actual = Object.fromEntries(
      adminAuthorizationManifest
        .filter(({ template }) => template.startsWith("/admin/catalog/"))
        .map((entry) => [
          adminAuthorizationKey(entry),
          entry.policies.map(adminPermissionKey),
        ])
    )

    expect(actual).toEqual(catalogExpectedPolicies)
  })
})
