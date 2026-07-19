import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http";
import {
  ContainerRegistrationKeys,
  getVariantAvailability,
  MedusaError,
} from "@medusajs/framework/utils";

import {
  parseResolvedVariantMappings,
  type CatalogBundleComponentRecord,
} from "@/lib/catalog/bundle-inventory";

type JsonRecord = Record<string, unknown>;
type QueryGraph = {
  graph: (query: {
    entity: string;
    fields: string[];
    filters?: Record<string, unknown>;
    pagination?: { take?: number; skip?: number };
  }) => Promise<{ data: JsonRecord[] }>;
};
type CatalogBundleProfile = {
  id: string;
  product_id: string;
  bundle_type?: unknown;
  display_title?: unknown;
  is_active?: unknown;
};
type CatalogService = {
  listCatalogBundleProfiles: (
    filters: Record<string, unknown>,
  ) => Promise<CatalogBundleProfile[]>;
  listCatalogBundleComponents: (
    filters: Record<string, unknown>,
  ) => Promise<CatalogBundleComponentRecord[]>;
};

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length ? value.trim() : null;

const asPositiveInteger = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 1;

const unique = (values: Array<string | null>): string[] =>
  Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  );

export const GET = async (
  req: MedusaStoreRequest,
  res: MedusaResponse,
): Promise<void> => {
  const handle = asString(req.params.handle);
  if (!handle || handle.length > 200) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A valid product handle is required",
    );
  }

  const salesChannelIds = req.publishable_key_context.sales_channel_ids;
  if (salesChannelIds.length !== 1 || !salesChannelIds[0]) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Bundle availability requires exactly one sales channel",
    );
  }

  const query = req.scope.resolve(
    ContainerRegistrationKeys.QUERY,
  ) as QueryGraph;
  const productResult = await query.graph({
    entity: "product",
    fields: ["id", "handle", "title", "variants.id", "variants.title"],
    filters: { handle },
    pagination: { take: 1 },
  });
  const product = productResult.data[0];
  if (!product) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Product not found");
  }
  const productId = asString(product?.id);
  if (!productId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Product not found");
  }

  const catalogService = req.scope.resolve("catalog") as CatalogService;
  const profiles = await catalogService.listCatalogBundleProfiles({
    product_id: productId,
  });
  const profile = profiles.find((candidate) => candidate.is_active !== false);
  if (!profile) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Bundle composition not found",
    );
  }

  const components = (
    await catalogService.listCatalogBundleComponents({
      bundle_profile_id: profile.id,
    })
  ).sort(
    (left, right) =>
      Number((left as JsonRecord).sort_order ?? 0) -
      Number((right as JsonRecord).sort_order ?? 0),
  );
  const mappingsByComponent = components.map((component) =>
    parseResolvedVariantMappings(component),
  );
  const mappedVariantIds = unique(
    mappingsByComponent.flatMap((mappings) =>
      mappings.flatMap((mapping) =>
        mapping.componentVariants.map((variant) => variant.variantId),
      ),
    ),
  );
  const componentProductIds = unique(
    components.map((component) =>
      asString((component as JsonRecord).component_product_id),
    ),
  );

  const [availability, componentProductResult] = await Promise.all([
    mappedVariantIds.length
      ? getVariantAvailability(
          query as Parameters<typeof getVariantAvailability>[0],
          {
            variant_ids: mappedVariantIds,
            sales_channel_id: salesChannelIds[0],
          },
        )
      : Promise.resolve({} as Record<string, { availability: number | null }>),
    componentProductIds.length
      ? query.graph({
          entity: "product",
          fields: [
            "id",
            "handle",
            "title",
            "variants.id",
            "variants.title",
            "variants.sku",
          ],
          filters: { id: componentProductIds },
        })
      : Promise.resolve({ data: [] }),
  ]);

  const componentProductsById = new Map(
    componentProductResult.data.flatMap((candidate) => {
      const id = asString(candidate.id);
      return id ? [[id, candidate] as const] : [];
    }),
  );
  const variantDetailsById = new Map<string, JsonRecord>();
  componentProductResult.data.forEach((candidate) => {
    const variants = Array.isArray(candidate.variants)
      ? candidate.variants
      : [];
    variants.forEach((rawVariant) => {
      if (!isRecord(rawVariant)) {
        return;
      }
      const id = asString(rawVariant.id);
      if (id) {
        variantDetailsById.set(id, rawVariant);
      }
    });
  });
  const bundleVariantTitles = new Map<string, string>();
  const rawBundleVariants = Array.isArray(product.variants)
    ? product.variants
    : [];
  rawBundleVariants.forEach((rawVariant) => {
    if (!isRecord(rawVariant)) {
      return;
    }
    const id = asString(rawVariant.id);
    if (id) {
      bundleVariantTitles.set(id, asString(rawVariant.title) ?? "Bundle");
    }
  });

  let unavailableMappingCount = 0;
  const serializedComponents = components.map((component, componentIndex) => {
    const quantity = asPositiveInteger(component.quantity);
    const componentProductId = asString(
      (component as JsonRecord).component_product_id,
    );
    const componentProduct = componentProductId
      ? componentProductsById.get(componentProductId)
      : undefined;
    const mappings = mappingsByComponent[componentIndex] ?? [];
    const availabilityByBundleVariant = mappings.map((mapping) => {
      const options = mapping.componentVariants.map((variant) => {
        const detail = variantDetailsById.get(variant.variantId);
        const availableQuantity =
          availability[variant.variantId]?.availability ?? null;
        return {
          variantId: variant.variantId,
          title: asString(detail?.title) ?? variant.sku ?? "Component",
          sku: asString(detail?.sku) ?? variant.sku,
          availableQuantity,
          available:
            typeof availableQuantity === "number" &&
            availableQuantity >= quantity,
        };
      });
      const available =
        mapping.selectionMode === "any"
          ? options.some((option) => option.available)
          : options.every((option) => option.available);
      if (!available) {
        unavailableMappingCount += 1;
      }
      return {
        bundleVariantIds: mapping.bundleVariantIds,
        bundleVariantTitles: mapping.bundleVariantIds.map(
          (variantId) => bundleVariantTitles.get(variantId) ?? "Bundle",
        ),
        selectionMode: mapping.selectionMode,
        available,
        options,
      };
    });

    return {
      id: asString(component.id) ?? `component-${componentIndex + 1}`,
      title:
        asString((component as JsonRecord).title) ??
        asString(componentProduct?.title) ??
        `Item ${componentIndex + 1}`,
      quantity,
      required: component.is_required !== false,
      product: {
        id: componentProductId,
        handle: asString(componentProduct?.handle),
        title: asString(componentProduct?.title),
      },
      availabilityByBundleVariant,
    };
  });

  res.status(200).json({
    bundle: {
      productId,
      handle,
      title:
        asString(profile.display_title) ?? asString(product.title) ?? "Bundle",
      type: asString(profile.bundle_type) ?? "fixed",
      componentCount: serializedComponents.length,
      unavailableMappingCount,
      hasUnavailableComponents: unavailableMappingCount > 0,
      components: serializedComponents,
    },
  });
};
