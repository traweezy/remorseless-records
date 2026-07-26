import type { MedusaRequest } from "@medusajs/framework/http";
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils";

import type {
  CatalogBundleInventoryLinkState,
  CatalogBundleStateSnapshot,
} from "@/modules/catalog/bundle-authoring";

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
  listCatalogBundleInventoryLinks: (
    filters: Record<string, unknown>,
  ) => Promise<
    Array<{
      id: string;
      bundle_profile_id: string;
      bundle_variant_id: string;
      inventory_item_id: string;
      required_quantity: number;
      metadata?: unknown;
    }>
  >;
  replaceBundleInventoryLinks: (
    bundleProfileId: string,
    links: CatalogBundleInventoryLinkState[],
  ) => Promise<void>;
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

type InventoryLinkWithVariant = InventoryLink & {
  bundleVariantId: string;
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

const inventoryLinkKey = (
  variantId: string,
  inventoryItemId: string,
): string => `${variantId}:${inventoryItemId}`;

const flattenPlan = (
  plan: BundleVariantInventoryPlan[],
): InventoryLinkWithVariant[] =>
  plan.flatMap((variant) =>
    variant.links.map((link) => ({
      bundleVariantId: variant.bundleVariantId,
      ...link,
    })),
  );

const toInventoryMap = (
  links: InventoryLinkWithVariant[],
): Map<string, InventoryLinkWithVariant> =>
  new Map(
    links.map((link) => [
      inventoryLinkKey(link.bundleVariantId, link.inventoryItemId),
      link,
    ]),
  );

const flattenActualInventory = (
  variants: Awaited<ReturnType<typeof readBundleVariants>>,
): InventoryLinkWithVariant[] =>
  variants.flatMap((variant) =>
    variant.inventoryItems.map((link) => ({
      bundleVariantId: variant.id,
      ...link,
    })),
  );

const buildPlanForSnapshot = (
  snapshot: CatalogBundleStateSnapshot,
  bundleVariantIds: string[],
): BundleVariantInventoryPlan[] => {
  if (
    !snapshot.profile ||
    snapshot.profile.inventory_mode !== "component_derived" ||
    !snapshot.profile.is_active
  ) {
    return [];
  }
  return buildBundleVariantInventoryPlan({
    bundleVariantIds,
    components: snapshot.components,
  });
};

type ProvenanceSnapshot = {
  bundleProfileId: string;
  links: CatalogBundleInventoryLinkState[];
};

export type BundleInventoryReconciliationSnapshot = {
  actualBefore: InventoryLinkWithVariant[];
  affectedKeys: string[];
  provenanceBefore: ProvenanceSnapshot[];
};

const readProvenance = async (
  catalogService: CatalogService,
  bundleProfileIds: string[],
): Promise<ProvenanceSnapshot[]> =>
  Promise.all(
    bundleProfileIds.map(async (bundleProfileId) => ({
      bundleProfileId,
      links: (
        await catalogService.listCatalogBundleInventoryLinks({
          bundle_profile_id: bundleProfileId,
        })
      ).map((link) => ({
        id: link.id,
        bundle_profile_id: link.bundle_profile_id,
        bundle_variant_id: link.bundle_variant_id,
        inventory_item_id: link.inventory_item_id,
        required_quantity: link.required_quantity,
        metadata: isRecord(link.metadata) ? link.metadata : {},
      })),
    })),
  );

const restoreProvenance = async (
  catalogService: CatalogService,
  provenance: ProvenanceSnapshot[],
): Promise<void> => {
  for (const snapshot of provenance) {
    await catalogService.replaceBundleInventoryLinks(
      snapshot.bundleProfileId,
      snapshot.links,
    );
  }
};

const restoreRemoteInventory = async (
  container: MedusaContainer,
  productId: string,
  snapshot: BundleInventoryReconciliationSnapshot,
): Promise<void> => {
  const query = container.resolve(
    ContainerRegistrationKeys.QUERY,
  ) as QueryGraph;
  const remoteLink = container.resolve(
    ContainerRegistrationKeys.REMOTE_LINK,
  ) as RemoteLink;
  const current = flattenActualInventory(
    await readBundleVariants(query, productId),
  );
  const currentByKey = toInventoryMap(current);
  const beforeByKey = toInventoryMap(snapshot.actualBefore);

  for (const key of snapshot.affectedKeys) {
    const currentLink = currentByKey.get(key);
    const beforeLink = beforeByKey.get(key);
    if (
      currentLink &&
      (!beforeLink ||
        beforeLink.requiredQuantity !== currentLink.requiredQuantity)
    ) {
      await remoteLink.dismiss([
        buildRemoteLink(
          currentLink.bundleVariantId,
          currentLink.inventoryItemId,
        ),
      ]);
    }
    if (
      beforeLink &&
      (!currentLink ||
        currentLink.requiredQuantity !== beforeLink.requiredQuantity)
    ) {
      await remoteLink.create([
        buildRemoteLink(
          beforeLink.bundleVariantId,
          beforeLink.inventoryItemId,
          beforeLink.requiredQuantity,
        ),
      ]);
    }
  }
};

export const restoreBundleInventoryReconciliation = async (
  container: MedusaContainer,
  productId: string,
  snapshot: BundleInventoryReconciliationSnapshot,
): Promise<void> => {
  const catalogService = container.resolve("catalog") as CatalogService;
  await restoreRemoteInventory(container, productId, snapshot);
  await restoreProvenance(catalogService, snapshot.provenanceBefore);
};

export const reconcileComponentDerivedBundleInventory = async (
  container: MedusaContainer,
  productId: string,
  previous: CatalogBundleStateSnapshot,
): Promise<{
  plan: BundleVariantInventoryPlan[];
  snapshot: BundleInventoryReconciliationSnapshot;
}> => {
  const catalogService = container.resolve("catalog") as CatalogService;
  const profiles = await catalogService.listCatalogBundleProfiles({
    product_id: productId,
  });
  const profile = profiles[0];
  const bundleVariants = await readBundleVariants(
    container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph,
    productId,
  );

  const needsVariants =
    (profile &&
      profile.inventory_mode === "component_derived" &&
      profile.is_active !== false) ||
    (previous.profile &&
      previous.profile.inventory_mode === "component_derived" &&
      previous.profile.is_active);
  if (needsVariants && !bundleVariants.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Component-derived bundle has no product variants",
    );
  }

  const bundleVariantIds = bundleVariants.map((variant) => variant.id);
  const components =
    profile &&
    profile.inventory_mode === "component_derived" &&
    profile.is_active !== false
      ? await catalogService.listCatalogBundleComponents({
          bundle_profile_id: profile.id,
        })
      : [];
  const plan =
    profile &&
    profile.inventory_mode === "component_derived" &&
    profile.is_active !== false
      ? buildBundleVariantInventoryPlan({
          bundleVariantIds,
          components,
        })
      : [];
  if (plan.some((variant) => !variant.links.length)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Every component-derived bundle variant must resolve to inventory components",
    );
  }

  const profileIds = Array.from(
    new Set(
      [previous.profile?.id, profile?.id].filter(
        (id): id is string => typeof id === "string",
      ),
    ),
  );
  const provenanceBefore = await readProvenance(
    catalogService,
    profileIds,
  );
  const actualBefore = flattenActualInventory(bundleVariants);
  const actualByKey = toInventoryMap(actualBefore);
  const desiredLinks = flattenPlan(plan);
  const desiredByKey = toInventoryMap(desiredLinks);
  const previouslyPlanned = flattenPlan(
    buildPlanForSnapshot(previous, bundleVariantIds),
  );
  const managedBefore = toInventoryMap([
    ...provenanceBefore.flatMap((snapshot) =>
      snapshot.links.map((link) => ({
        bundleVariantId: link.bundle_variant_id,
        inventoryItemId: link.inventory_item_id,
        requiredQuantity: link.required_quantity,
      })),
    ),
    ...previouslyPlanned.filter((link) => {
      const actual = actualByKey.get(
        inventoryLinkKey(link.bundleVariantId, link.inventoryItemId),
      );
      return actual?.requiredQuantity === link.requiredQuantity;
    }),
  ]);

  desiredLinks.forEach((desired) => {
    const key = inventoryLinkKey(
      desired.bundleVariantId,
      desired.inventoryItemId,
    );
    const actual = actualByKey.get(key);
    if (
      actual &&
      actual.requiredQuantity !== desired.requiredQuantity &&
      !managedBefore.has(key)
    ) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        `Inventory link ${key} is not owned by the bundle workflow and cannot be replaced.`,
      );
    }
  });

  const linksToDismiss = Array.from(managedBefore.entries()).flatMap(
    ([key]) => {
      const actual = actualByKey.get(key);
      const desired = desiredByKey.get(key);
      return actual &&
        (!desired || desired.requiredQuantity !== actual.requiredQuantity)
        ? [actual]
        : [];
    },
  );
  const linksToCreate = desiredLinks.filter((desired) => {
    const actual = actualByKey.get(
      inventoryLinkKey(desired.bundleVariantId, desired.inventoryItemId),
    );
    return !actual || actual.requiredQuantity !== desired.requiredQuantity;
  });
  const affectedKeys = Array.from(
    new Set(
      [...linksToDismiss, ...linksToCreate].map((link) =>
        inventoryLinkKey(link.bundleVariantId, link.inventoryItemId),
      ),
    ),
  );
  const snapshot: BundleInventoryReconciliationSnapshot = {
    actualBefore,
    affectedKeys,
    provenanceBefore,
  };

  const remoteLink = container.resolve(
    ContainerRegistrationKeys.REMOTE_LINK,
  ) as RemoteLink;
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger;
  let changes = 0;
  try {
    for (const link of linksToDismiss) {
      await remoteLink.dismiss([
        buildRemoteLink(link.bundleVariantId, link.inventoryItemId),
      ]);
      changes += 1;
    }
    for (const link of linksToCreate) {
      await remoteLink.create([
        buildRemoteLink(
          link.bundleVariantId,
          link.inventoryItemId,
          link.requiredQuantity,
        ),
      ]);
      changes += 1;
    }

    for (const profileId of profileIds) {
      await catalogService.replaceBundleInventoryLinks(
        profileId,
        profile?.id === profileId
          ? desiredLinks.map((link) => ({
              bundle_profile_id: profileId,
              bundle_variant_id: link.bundleVariantId,
              inventory_item_id: link.inventoryItemId,
              required_quantity: link.requiredQuantity,
              metadata: {},
            }))
          : [],
      );
    }
  } catch (error) {
    await restoreRemoteInventory(container, productId, snapshot);
    await restoreProvenance(catalogService, provenanceBefore);
    throw error;
  }

  if (changes) {
    logger.info(
      `[catalog] Synchronized ${changes} bundle inventory link change(s) for ${productId}`,
    );
  }
  return { plan, snapshot };
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
  const previous: CatalogBundleStateSnapshot = profile
    ? {
        profile: {
          id: profile.id,
          product_id: profile.product_id,
          product_profile_id: null,
          bundle_type: "fixed",
          inventory_mode:
            profile.inventory_mode === "manual"
              ? "manual"
              : "component_derived",
          fulfillment_mode: "ship_components",
          display_title: null,
          description_html: null,
          is_active: profile.is_active !== false,
          version: 1,
          metadata: {},
        },
        components: await catalogService.listCatalogBundleComponents({
          bundle_profile_id: profile.id,
        }).then((components) =>
          components.map((component, index) => ({
            id: component.id ?? `legacy-${index}`,
            bundle_profile_id: profile.id,
            component_product_id: "",
            component_variant_id: component.component_variant_id ?? null,
            component_inventory_item_id:
              component.component_inventory_item_id ?? null,
            title: null,
            variant_title: null,
            sku: null,
            quantity: component.quantity ?? 1,
            sort_order: index,
            is_required: component.is_required !== false,
            metadata: isRecord(component.metadata) ? component.metadata : {},
          })),
        ),
      }
    : { profile: null, components: [] };
  return (
    await reconcileComponentDerivedBundleInventory(
      container,
      productId,
      previous,
    )
  ).plan;
};
