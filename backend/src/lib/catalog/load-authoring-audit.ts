import { Modules } from "@medusajs/framework/utils"

import type CatalogModuleService from "@/modules/catalog/service"

import {
  buildCatalogAuthoringAudit,
  type CatalogAuthoringAuditBundle,
  type CatalogAuthoringAuditProduct,
  type CatalogAuthoringAuditProfile,
  type CatalogAuthoringAuditReference,
  type CatalogAuthoringAuditReport,
} from "./authoring-audit"
import {
  assertCatalogAuthoringAuditRelationships,
  loadAllCatalogAuthoringAuditRecords,
  readCatalogAuthoringAuditBundlePage,
  readCatalogAuthoringAuditProductPage,
  readCatalogAuthoringAuditProfilePage,
  readCatalogAuthoringAuditReferencePage,
  readCatalogAuthoringAuditService,
} from "./authoring-audit-persistence-contracts"

type CatalogService = InstanceType<typeof CatalogModuleService>

type ProductService = {
  listAndCountProducts: (
    filters: Record<string, unknown>,
    config: {
      order: { id: "ASC" }
      relations: string[]
      skip: number
      take: number
    }
  ) => Promise<unknown>
}

type ServiceContainer = {
  resolve: (key: string) => unknown
}

export const loadCatalogAuthoringAudit = async (
  container: ServiceContainer
): Promise<CatalogAuthoringAuditReport> => {
  const productService = readCatalogAuthoringAuditService<ProductService>(
    container.resolve(Modules.PRODUCT),
    ["listAndCountProducts"]
  )
  const catalogService = readCatalogAuthoringAuditService<CatalogService>(
    container.resolve("catalog"),
    [
      "listAndCountCatalogBundleProfiles",
      "listAndCountCatalogProductProfiles",
      "listAndCountCatalogReferenceValues",
    ]
  )

  const [productRecords, profileRecords, referenceRecords, bundleRecords] =
    await Promise.all([
      loadAllCatalogAuthoringAuditRecords({
        identity: ({ id }) => id,
        listPage: (skip, take) =>
          productService.listAndCountProducts(
            {},
            { order: { id: "ASC" }, relations: ["type"], skip, take }
          ),
        readPage: readCatalogAuthoringAuditProductPage,
      }),
      loadAllCatalogAuthoringAuditRecords({
        identity: ({ id }) => id,
        listPage: (skip, take) =>
          catalogService.listAndCountCatalogProductProfiles(
            {},
            { order: { id: "ASC" }, skip, take }
          ),
        readPage: readCatalogAuthoringAuditProfilePage,
      }),
      loadAllCatalogAuthoringAuditRecords({
        identity: ({ id }) => id,
        listPage: (skip, take) =>
          catalogService.listAndCountCatalogReferenceValues(
            { kind: "product_type" },
            { order: { id: "ASC" }, skip, take }
          ),
        readPage: readCatalogAuthoringAuditReferencePage,
      }),
      loadAllCatalogAuthoringAuditRecords({
        identity: ({ id }) => id,
        listPage: (skip, take) =>
          catalogService.listAndCountCatalogBundleProfiles(
            {},
            { order: { id: "ASC" }, skip, take }
          ),
        readPage: readCatalogAuthoringAuditBundlePage,
      }),
    ])

  assertCatalogAuthoringAuditRelationships({
    bundles: bundleRecords,
    products: productRecords,
    profiles: profileRecords,
    references: referenceRecords,
  })

  return buildCatalogAuthoringAudit({
    bundles: bundleRecords.map(
      (bundle): CatalogAuthoringAuditBundle => ({
        bundleType: bundle.bundle_type,
        productId: bundle.product_id,
      })
    ),
    products: productRecords.map(
      (product): CatalogAuthoringAuditProduct => ({
        handle: product.handle?.trim() || null,
        id: product.id,
        metadata: product.metadata ?? null,
        nativeProductType: product.type?.value?.trim() || null,
        status: product.status?.trim() || null,
        title: product.title?.trim() || "Untitled product",
      })
    ),
    profiles: profileRecords.map(
      (profile): CatalogAuthoringAuditProfile => ({
        productId: profile.product_id,
        productTypeId: profile.product_type_id ?? null,
      })
    ),
    references: referenceRecords.map(
      (reference): CatalogAuthoringAuditReference => ({
        id: reference.id,
        isActive: reference.is_active,
        kind: "product_type",
        label: reference.label,
        value: reference.value,
      })
    ),
  })
}
