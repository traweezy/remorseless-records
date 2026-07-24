import type { MedusaRequest } from "@medusajs/framework/http";
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils";

type JsonRecord = Record<string, unknown>;
type MedusaContainer = MedusaRequest["scope"];

type CatalogBundleProfileRecord = {
  id: string;
  product_id: string;
  inventory_mode?: unknown;
  is_active?: unknown;
};

export type CatalogBundleComponentRecord = {
  id?: string;
  component_variant_id?: string | null;
  component_inventory_item_id?: string | null;
  quantity?: number | null;
  is_required?: boolean | null;
  metadata?: unknown;
};

type CatalogService = {
  listCatalogBundleProfiles: (
    filters: Record<string, unknown>,
  ) => Promise<CatalogBundleProfileRecord[]>;
  listCatalogBundleComponents: (
    filters: Record<string, unknown>,
  ) => Promise<CatalogBundleComponentRecord[]>;
};

type QueryGraph = {
  graph: (query: {
    entity: string;
    fields: string[];
    filters?: Record<string, unknown>;
    pagination?: { take?: number; skip?: number };
  }) => Promise<{ data: Array<Record<string, unknown>> }>;
};

type RemoteLink = {
  create: (links: RemoteLinkDefinition[]) => Promise<unknown[]>;
  dismiss: (links: RemoteLinkDefinition[]) => Promise<unknown[]>;
};

type Logger = {
  info: (message: string) => void;
};

type RemoteLinkDefinition = {
  [Modules.PRODUCT]: { variant_id: string };
  [Modules.INVENTORY]: { inventory_item_id: string };
  data?: { required_quantity: number };
};

export type ResolvedComponentVariant = {
  variantId: string;
  inventoryItemId: string;
  sku: string | null;
};

export type ResolvedVariantMapping = {
  bundleVariantIds: string[];
  selectionMode: "exact" | "any";
  componentVariants: ResolvedComponentVariant[];
};

type InventoryLink = {
  inventoryItemId: string;
  requiredQuantity: number;
};

export type BundleVariantInventoryPlan = {
  bundleVariantId: string;
  links: InventoryLink[];
  selectedAlternativeVariantIds: string[];
};

type BuildPlanInput = {
  bundleVariantIds: string[];
  components: CatalogBundleComponentRecord[];
};

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length ? value.trim() : null;

const asPositiveInteger = (value: unknown, fallback = 1): number =>
  typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;

const asStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(asString).filter((entry): entry is string => Boolean(entry))
    : [];

const parseResolvedComponentVariant = (
  value: unknown,
): ResolvedComponentVariant | null => {
  if (!isRecord(value)) {
    return null;
  }

  const variantId = asString(value.variant_id ?? value.variantId);
  const inventoryItemId = asString(
    value.inventory_item_id ?? value.inventoryItemId,
  );
  if (!variantId || !inventoryItemId) {
    return null;
  }

  return {
    variantId,
    inventoryItemId,
    sku: asString(value.sku),
  };
};

export const parseResolvedVariantMappings = (
  component: CatalogBundleComponentRecord,
): ResolvedVariantMapping[] => {
  if (!isRecord(component.metadata)) {
    return [];
  }

  const rawMappings =
    component.metadata.resolved_variant_mappings ??
    component.metadata.resolvedVariantMappings;
  if (!Array.isArray(rawMappings)) {
    return [];
  }

  return rawMappings.flatMap((rawMapping) => {
    if (!isRecord(rawMapping)) {
      return [];
    }

    const bundleVariantIds = asStringList(
      rawMapping.bundle_variant_ids ?? rawMapping.bundleVariantIds,
    );
    const rawMode = asString(
      rawMapping.selection_mode ?? rawMapping.selectionMode,
    );
    const selectionMode = rawMode === "any" ? "any" : "exact";
    const rawVariants =
      rawMapping.component_variants ?? rawMapping.componentVariants;
    const componentVariants = Array.isArray(rawVariants)
      ? rawVariants
          .map(parseResolvedComponentVariant)
          .filter((entry): entry is ResolvedComponentVariant => Boolean(entry))
      : [];

    return bundleVariantIds.length && componentVariants.length
      ? [{ bundleVariantIds, selectionMode, componentVariants }]
      : [];
  });
};

const fallbackMapping = (
  component: CatalogBundleComponentRecord,
  bundleVariantIds: string[],
): ResolvedVariantMapping[] => {
  const variantId = asString(component.component_variant_id);
  const inventoryItemId = asString(component.component_inventory_item_id);
  if (!variantId || !inventoryItemId) {
    return [];
  }

  return [
    {
      bundleVariantIds,
      selectionMode: "exact",
      componentVariants: [{ variantId, inventoryItemId, sku: null }],
    },
  ];
};

const selectComponentVariants = (
  mapping: ResolvedVariantMapping,
): ResolvedComponentVariant[] => {
  if (mapping.selectionMode === "exact") {
    return mapping.componentVariants;
  }

  // Inventory-kit links are global catalog state. An "any" mapping is treated
  // as an ordered legacy preference until the alternatives are modeled as
  // explicit bundle variants. A cart request must never switch this link based
  // on one shopper's requested quantity or the inventory snapshot it observed.
  const selected = mapping.componentVariants[0];

  return selected ? [selected] : [];
};

export const buildBundleVariantInventoryPlan = ({
  bundleVariantIds,
  components,
}: BuildPlanInput): BundleVariantInventoryPlan[] =>
  bundleVariantIds.map((bundleVariantId) => {
    const quantitiesByInventoryItemId = new Map<string, number>();
    const selectedAlternativeVariantIds: string[] = [];

    components.forEach((component) => {
      if (component.is_required === false) {
        return;
      }

      const componentQuantity = asPositiveInteger(component.quantity);
      const mappings = parseResolvedVariantMappings(component);
      const applicableMappings = (
        mappings.length
          ? mappings
          : fallbackMapping(component, bundleVariantIds)
      ).filter((mapping) => mapping.bundleVariantIds.includes(bundleVariantId));

      applicableMappings.forEach((mapping) => {
        const selected = selectComponentVariants(mapping);
        selected.forEach((variant) => {
          quantitiesByInventoryItemId.set(
            variant.inventoryItemId,
            (quantitiesByInventoryItemId.get(variant.inventoryItemId) ?? 0) +
              componentQuantity,
          );
          if (mapping.selectionMode === "any") {
            selectedAlternativeVariantIds.push(variant.variantId);
          }
        });
      });
    });

    return {
      bundleVariantId,
      links: Array.from(
        quantitiesByInventoryItemId,
        ([inventoryItemId, requiredQuantity]) => ({
          inventoryItemId,
          requiredQuantity,
        }),
      ),
      selectedAlternativeVariantIds,
    };
  });

const buildRemoteLink = (
  variantId: string,
  inventoryItemId: string,
  requiredQuantity?: number,
): RemoteLinkDefinition => ({
  [Modules.PRODUCT]: { variant_id: variantId },
  [Modules.INVENTORY]: { inventory_item_id: inventoryItemId },
  ...(requiredQuantity === undefined
    ? {}
    : { data: { required_quantity: requiredQuantity } }),
});

const readBundleVariants = async (
  query: QueryGraph,
  productId: string,
): Promise<
  Array<{
    id: string;
    inventoryItems: Array<{
      inventoryItemId: string;
      requiredQuantity: number;
    }>;
  }>
> => {
  const productResult = await query.graph({
    entity: "product",
    fields: ["id", "variants.id"],
    filters: { id: productId },
    pagination: { take: 1 },
  });
  const product = productResult.data[0];
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const variantIds = variants.flatMap((rawVariant) => {
    if (!isRecord(rawVariant)) {
      return [];
    }
    const id = asString(rawVariant.id);
    return id ? [id] : [];
  });
  if (!variantIds.length) {
    return [];
  }

  // Query the link entry point directly. Product aggregation can omit links
  // created by the CSV importer during the same request lifecycle.
  const linkResult = await query.graph({
    entity: "product_variant_inventory_items",
    fields: ["variant_id", "inventory_item_id", "required_quantity"],
    filters: { variant_id: variantIds },
  });
  const inventoryItemsByVariantId = new Map<
    string,
    Array<{ inventoryItemId: string; requiredQuantity: number }>
  >();
  linkResult.data.forEach((rawLink) => {
    const variantId = asString(rawLink.variant_id);
    const inventoryItemId = asString(rawLink.inventory_item_id);
    if (!variantId || !inventoryItemId) {
      return;
    }
    const links = inventoryItemsByVariantId.get(variantId) ?? [];
    links.push({
      inventoryItemId,
      requiredQuantity: asPositiveInteger(rawLink.required_quantity),
    });
    inventoryItemsByVariantId.set(variantId, links);
  });

  return variants.flatMap((rawVariant) => {
    if (!isRecord(rawVariant)) {
      return [];
    }
    const id = asString(rawVariant.id);
    if (!id) {
      return [];
    }
    return [{ id, inventoryItems: inventoryItemsByVariantId.get(id) ?? [] }];
  });
};

export const syncComponentDerivedBundleInventory = async (
  container: MedusaContainer,
  productId: string,
): Promise<BundleVariantInventoryPlan[]> => {
  const catalogService = container.resolve("catalog") as CatalogService;
  const profiles = await catalogService.listCatalogBundleProfiles({
    product_id: productId,
  });
  const profile = profiles[0];
  if (
    !profile ||
    profile.inventory_mode !== "component_derived" ||
    profile.is_active === false
  ) {
    return [];
  }

  const [components, bundleVariants] = await Promise.all([
    catalogService.listCatalogBundleComponents({
      bundle_profile_id: profile.id,
    }),
    readBundleVariants(
      container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph,
      productId,
    ),
  ]);

  if (!bundleVariants.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Component-derived bundle has no product variants",
    );
  }

  const plan = buildBundleVariantInventoryPlan({
    bundleVariantIds: bundleVariants.map((variant) => variant.id),
    components,
  });
  if (plan.some((variant) => !variant.links.length)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Every component-derived bundle variant must resolve to inventory components",
    );
  }

  const remoteLink = container.resolve(
    ContainerRegistrationKeys.REMOTE_LINK,
  ) as RemoteLink;
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger;
  let changes = 0;

  for (const variantPlan of plan) {
    const current =
      bundleVariants.find(
        (variant) => variant.id === variantPlan.bundleVariantId,
      )?.inventoryItems ?? [];
    const desiredByItemId = new Map(
      variantPlan.links.map((link) => [
        link.inventoryItemId,
        link.requiredQuantity,
      ]),
    );
    const currentByItemId = new Map(
      current.map((link) => [link.inventoryItemId, link.requiredQuantity]),
    );
    const linksToDismiss = current.filter(
      (link) =>
        desiredByItemId.get(link.inventoryItemId) !== link.requiredQuantity,
    );
    const linksToCreate = variantPlan.links.filter(
      (link) =>
        currentByItemId.get(link.inventoryItemId) !== link.requiredQuantity,
    );

    if (linksToDismiss.length) {
      await remoteLink.dismiss(
        linksToDismiss.map((link) =>
          buildRemoteLink(variantPlan.bundleVariantId, link.inventoryItemId),
        ),
      );
      changes += linksToDismiss.length;
    }
    if (linksToCreate.length) {
      await remoteLink.create(
        linksToCreate.map((link) =>
          buildRemoteLink(
            variantPlan.bundleVariantId,
            link.inventoryItemId,
            link.requiredQuantity,
          ),
        ),
      );
      changes += linksToCreate.length;
    }
  }

  if (changes) {
    logger.info(
      `[catalog] Synchronized ${changes} bundle inventory link change(s) for ${productId}`,
    );
  }
  return plan;
};
