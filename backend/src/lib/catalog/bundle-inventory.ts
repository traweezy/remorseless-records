import type { MedusaRequest } from "@medusajs/framework/http";
import {
  ContainerRegistrationKeys,
  getTotalVariantAvailability,
  getVariantAvailability,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils";

type JsonRecord = Record<string, unknown>;
type MedusaContainer = MedusaRequest["scope"];
type VariantAvailabilityQuery = Parameters<typeof getVariantAvailability>[0];

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
  availabilityByVariantId?: Readonly<Record<string, number | null | undefined>>;
  requestedQuantityByBundleVariantId?: Readonly<
    Record<string, number | undefined>
  >;
};

type SyncOptions = {
  salesChannelId?: string | null;
  requestedQuantityByBundleVariantId?: Readonly<
    Record<string, number | undefined>
  >;
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
  requiredQuantity: number,
  availabilityByVariantId: Readonly<Record<string, number | null | undefined>>,
): ResolvedComponentVariant[] => {
  if (mapping.selectionMode === "exact") {
    return mapping.componentVariants;
  }

  const selected =
    mapping.componentVariants.find((variant) => {
      const availability = availabilityByVariantId[variant.variantId];
      return (
        typeof availability === "number" && availability >= requiredQuantity
      );
    }) ?? mapping.componentVariants[0];

  return selected ? [selected] : [];
};

export const buildBundleVariantInventoryPlan = ({
  bundleVariantIds,
  components,
  availabilityByVariantId = {},
  requestedQuantityByBundleVariantId = {},
}: BuildPlanInput): BundleVariantInventoryPlan[] =>
  bundleVariantIds.map((bundleVariantId) => {
    const requestedQuantity = asPositiveInteger(
      requestedQuantityByBundleVariantId[bundleVariantId],
    );
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
        const selected = selectComponentVariants(
          mapping,
          componentQuantity * requestedQuantity,
          availabilityByVariantId,
        );
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

const collectMappedVariantIds = (
  components: CatalogBundleComponentRecord[],
): string[] =>
  Array.from(
    new Set(
      components.flatMap((component) =>
        parseResolvedVariantMappings(component).flatMap((mapping) =>
          mapping.componentVariants.map((variant) => variant.variantId),
        ),
      ),
    ),
  );

const toAvailabilityMap = (
  availability: Record<string, { availability: number | null }>,
): Record<string, number | null> =>
  Object.fromEntries(
    Object.entries(availability).map(([variantId, value]) => [
      variantId,
      value.availability,
    ]),
  );

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
  options: SyncOptions = {},
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

  const mappedVariantIds = collectMappedVariantIds(components);
  const query = container.resolve(
    ContainerRegistrationKeys.QUERY,
  ) as QueryGraph;
  const availabilityByVariantId = mappedVariantIds.length
    ? toAvailabilityMap(
        options.salesChannelId
          ? await getVariantAvailability(query as VariantAvailabilityQuery, {
              variant_ids: mappedVariantIds,
              sales_channel_id: options.salesChannelId,
            })
          : await getTotalVariantAvailability(
              query as VariantAvailabilityQuery,
              {
                variant_ids: mappedVariantIds,
              },
            ),
      )
    : {};

  const plan = buildBundleVariantInventoryPlan({
    bundleVariantIds: bundleVariants.map((variant) => variant.id),
    components,
    availabilityByVariantId,
    ...(options.requestedQuantityByBundleVariantId
      ? {
          requestedQuantityByBundleVariantId:
            options.requestedQuantityByBundleVariantId,
        }
      : {}),
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

const loadVariantProductIds = async (
  query: QueryGraph,
  variantIds: string[],
): Promise<Record<string, string>> => {
  if (!variantIds.length) {
    return {};
  }
  const result = await query.graph({
    entity: "product_variant",
    fields: ["id", "product_id", "product.id"],
    filters: { id: variantIds },
  });

  return Object.fromEntries(
    result.data.flatMap((variant) => {
      const variantId = asString(variant.id);
      const nestedProduct = isRecord(variant.product) ? variant.product : null;
      const productId =
        asString(variant.product_id) ?? asString(nestedProduct?.id);
      return variantId && productId ? [[variantId, productId]] : [];
    }),
  );
};

export const reconcileBundleVariants = async (
  container: MedusaContainer,
  input: {
    salesChannelId: string;
    quantitiesByVariantId: Readonly<Record<string, number | undefined>>;
  },
): Promise<BundleVariantInventoryPlan[]> => {
  const variantIds = Object.keys(input.quantitiesByVariantId);
  const query = container.resolve(
    ContainerRegistrationKeys.QUERY,
  ) as QueryGraph;
  const productIdByVariantId = await loadVariantProductIds(query, variantIds);
  const quantitiesByProductId = new Map<string, Record<string, number>>();

  variantIds.forEach((variantId) => {
    const productId = productIdByVariantId[variantId];
    if (!productId) {
      return;
    }
    const productQuantities = quantitiesByProductId.get(productId) ?? {};
    productQuantities[variantId] = asPositiveInteger(
      input.quantitiesByVariantId[variantId],
    );
    quantitiesByProductId.set(productId, productQuantities);
  });

  const plans: BundleVariantInventoryPlan[] = [];
  for (const [
    productId,
    requestedQuantityByBundleVariantId,
  ] of quantitiesByProductId) {
    plans.push(
      ...(await syncComponentDerivedBundleInventory(container, productId, {
        salesChannelId: input.salesChannelId,
        requestedQuantityByBundleVariantId,
      })),
    );
  }
  return plans;
};

export const reconcileCartBundles = async (
  container: MedusaContainer,
  input: { cartId: string; salesChannelId: string },
): Promise<BundleVariantInventoryPlan[]> => {
  const query = container.resolve(
    ContainerRegistrationKeys.QUERY,
  ) as QueryGraph;
  const result = await query.graph({
    entity: "cart",
    fields: ["id", "items.variant_id", "items.quantity"],
    filters: { id: input.cartId },
    pagination: { take: 1 },
  });
  const cart = result.data[0];
  if (!cart) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Cart not found");
  }
  const items = Array.isArray(cart.items) ? cart.items : [];
  const quantitiesByVariantId: Record<string, number> = {};
  items.forEach((rawItem) => {
    if (!isRecord(rawItem)) {
      return;
    }
    const variantId = asString(rawItem.variant_id);
    if (variantId) {
      quantitiesByVariantId[variantId] = asPositiveInteger(rawItem.quantity);
    }
  });

  return reconcileBundleVariants(container, {
    salesChannelId: input.salesChannelId,
    quantitiesByVariantId,
  });
};
