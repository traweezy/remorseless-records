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

type CatalogService = InstanceType<typeof CatalogModuleService>

type ProductRecord = {
  handle?: string | null
  id: string
  metadata?: Record<string, unknown> | null
  status?: string | null
  title?: string | null
  type?: {
    value?: string | null
  } | null
}

type ProductService = {
  listAndCountProducts: (
    filters: Record<string, unknown>,
    config: {
      relations: string[]
      skip: number
      take: number
    },
  ) => Promise<[ProductRecord[], number]>
}

type ServiceContainer = {
  resolve: (key: string) => unknown
}

const listAll = async <T>(
  listPage: (skip: number, take: number) => Promise<[T[], number]>,
): Promise<T[]> => {
  const records: T[] = []
  const take = 250
  let skip = 0

  while (true) {
    const [page, count] = await listPage(skip, take)
    records.push(...page)
    skip += page.length
    if (page.length === 0 || skip >= count) {
      return records
    }
  }
}

export const loadCatalogAuthoringAudit = async (
  container: ServiceContainer,
): Promise<CatalogAuthoringAuditReport> => {
  const productService = container.resolve(Modules.PRODUCT) as ProductService
  const catalogService = container.resolve("catalog") as CatalogService

  const [productRecords, profileRecords, referenceRecords, bundleRecords] =
    await Promise.all([
      listAll((skip, take) =>
        productService.listAndCountProducts(
          {},
          { relations: ["type"], skip, take },
        ),
      ),
      listAll((skip, take) =>
        catalogService.listAndCountCatalogProductProfiles(
          {},
          { skip, take },
        ),
      ),
      listAll((skip, take) =>
        catalogService.listAndCountCatalogReferenceValues(
          { kind: "product_type" },
          { skip, take },
        ),
      ),
      listAll((skip, take) =>
        catalogService.listAndCountCatalogBundleProfiles({}, { skip, take }),
      ),
    ])

  return buildCatalogAuthoringAudit({
    bundles: bundleRecords.map(
      (bundle): CatalogAuthoringAuditBundle => ({
        bundleType: bundle.bundle_type,
        productId: bundle.product_id,
      }),
    ),
    products: productRecords.map(
      (product): CatalogAuthoringAuditProduct => ({
        handle: product.handle?.trim() || null,
        id: product.id,
        metadata: product.metadata ?? null,
        nativeProductType: product.type?.value?.trim() || null,
        status: product.status?.trim() || null,
        title: product.title?.trim() || "Untitled product",
      }),
    ),
    profiles: profileRecords.map(
      (profile): CatalogAuthoringAuditProfile => ({
        productId: profile.product_id,
        productTypeId: profile.product_type_id ?? null,
      }),
    ),
    references: referenceRecords.map(
      (reference): CatalogAuthoringAuditReference => ({
        id: reference.id,
        isActive: reference.is_active,
        kind: reference.kind,
        label: reference.label,
        value: reference.value,
      }),
    ),
  })
}
