import type { MedusaRequest } from "@medusajs/framework";
import { MedusaError } from "@medusajs/framework/utils";
import { z } from "zod";

import {
  catalogBundleFulfillmentModeValues,
  type CatalogBundleFulfillmentMode,
  catalogBundleInventoryModeValues,
  type CatalogBundleInventoryMode,
  catalogBundleTypeValues,
  type CatalogBundleType,
  serializeCatalogBundleComponent,
  serializeCatalogBundleProfile,
} from "@/modules/catalog/serializers";
import { parseResolvedVariantMappings } from "@/lib/catalog/bundle-inventory";
import { sanitizeRichTextHtml } from "@/lib/content/rich-text";
import { hashCatalogCommand } from "@/modules/catalog/catalog-command";
import type {
  CatalogBundleComponentState,
  CatalogBundleMutationInput,
} from "@/modules/catalog/bundle-authoring";
import { mutateCatalogBundleWorkflow } from "../../../../workflows/catalog/mutate-bundle";
import {
  assertProductExists,
  assertQueryEntityExists,
  assertVariantBelongsToProduct,
  coerceJsonRecord,
  toNullableString,
  type CatalogService,
} from "../utils";

export const bundleComponentInputSchema = z.object({
  componentProductId: z.string().trim().min(1),
  componentVariantId: z.string().trim().optional().nullable(),
  componentInventoryItemId: z.string().trim().optional().nullable(),
  title: z.string().trim().optional().nullable(),
  variantTitle: z.string().trim().optional().nullable(),
  sku: z.string().trim().optional().nullable(),
  quantity: z.number().int().min(1).optional(),
  sortOrder: z.number().int().optional(),
  isRequired: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const bundleUpsertSchema = z.object({
  idempotencyKey: z.string().uuid(),
  expectedVersion: z.number().int().min(0),
  productProfileId: z.string().trim().optional().nullable(),
  bundleType: z.enum(catalogBundleTypeValues).optional(),
  inventoryMode: z.enum(catalogBundleInventoryModeValues).optional(),
  fulfillmentMode: z.enum(catalogBundleFulfillmentModeValues).optional(),
  displayTitle: z.string().trim().optional().nullable(),
  descriptionHtml: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  components: z.array(bundleComponentInputSchema).max(100).optional(),
});

export type BundleUpsertInput = z.infer<typeof bundleUpsertSchema>;

export const bundleDeleteSchema = z.object({
  idempotencyKey: z.string().uuid(),
  expectedVersion: z.number().int().min(0),
});

export type BundleDeleteInput = z.infer<typeof bundleDeleteSchema>;

type ResolvedBundleDefaults = {
  bundleType: CatalogBundleType;
  inventoryMode: CatalogBundleInventoryMode;
  fulfillmentMode: CatalogBundleFulfillmentMode;
};

export const resolveBundleProfile = async (
  catalogService: CatalogService,
  productId: string,
) => {
  const bundles = await catalogService.listCatalogBundleProfiles({
    product_id: productId,
  });
  return bundles.at(0) ?? null;
};

export const loadBundleComponents = async (
  catalogService: CatalogService,
  bundleProfileId: string,
) => {
  const components = await catalogService.listCatalogBundleComponents(
    { bundle_profile_id: bundleProfileId },
    { order: { sort_order: "ASC" } },
  );

  return components.map(serializeCatalogBundleComponent);
};

export const serializeBundleResponse = async (
  catalogService: CatalogService,
  bundle: NonNullable<Awaited<ReturnType<typeof resolveBundleProfile>>> | null,
) => {
  if (!bundle) {
    return {
      bundle: null,
      components: [],
    };
  }

  return {
    bundle: serializeCatalogBundleProfile(bundle),
    components: await loadBundleComponents(catalogService, bundle.id),
  };
};

const validateBundleShape = (
  productId: string,
  input: BundleUpsertInput,
  existingComponentsCount: number,
  existingBundleType: unknown,
): void => {
  const preservedBundleType = catalogBundleTypeValues.find(
    (type) => type === existingBundleType,
  );
  const bundleType = input.bundleType ?? preservedBundleType ?? "fixed";
  const componentCount = input.components?.length ?? existingComponentsCount;
  const requiresComponents = bundleType !== "mystery";

  if (requiresComponents && componentCount < 1) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Fixed, deal, and selectable bundles require at least one component",
    );
  }

  const includesBundleProduct = input.components?.some(
    (component) => component.componentProductId === productId,
  );
  if (includesBundleProduct) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A bundle cannot include itself as a component",
    );
  }
};

const resolveDefaults = (
  input: BundleUpsertInput,
  existing?: {
    bundle_type?: unknown;
    inventory_mode?: unknown;
    fulfillment_mode?: unknown;
  } | null,
): ResolvedBundleDefaults => {
  const existingBundleType = catalogBundleTypeValues.find(
    (type) => type === existing?.bundle_type,
  );
  const bundleType = input.bundleType ?? existingBundleType ?? "fixed";
  if (bundleType === "mystery") {
    return {
      bundleType,
      inventoryMode: "manual",
      fulfillmentMode: "manual",
    };
  }

  return {
    bundleType,
    inventoryMode:
      input.inventoryMode ??
      catalogBundleInventoryModeValues.find(
        (mode) => mode === existing?.inventory_mode,
      ) ??
      "component_derived",
    fulfillmentMode:
      input.fulfillmentMode ??
      catalogBundleFulfillmentModeValues.find(
        (mode) => mode === existing?.fulfillment_mode,
      ) ??
      "ship_components",
  };
};

const validateBundleComponent = async (
  req: MedusaRequest,
  productId: string,
  component: z.infer<typeof bundleComponentInputSchema>,
): Promise<void> => {
  if (component.componentProductId === productId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A bundle cannot include itself as a component",
    );
  }

  await assertProductExists(req, component.componentProductId);
  const componentVariantId = toNullableString(component.componentVariantId);
  if (componentVariantId) {
    await assertVariantBelongsToProduct(
      req,
      component.componentProductId,
      componentVariantId,
    );
  }
  const componentInventoryItemId = toNullableString(
    component.componentInventoryItemId,
  );
  if (componentInventoryItemId) {
    await assertQueryEntityExists(
      req,
      "inventory_item",
      componentInventoryItemId,
      "Component inventory item not found",
    );
  }

  const mappings = parseResolvedVariantMappings({
    metadata: component.metadata,
  });
  for (const mapping of mappings) {
    for (const variant of mapping.componentVariants) {
      await assertVariantBelongsToProduct(
        req,
        component.componentProductId,
        variant.variantId,
      );
      await assertQueryEntityExists(
        req,
        "inventory_item",
        variant.inventoryItemId,
        "Mapped component inventory item not found",
      );
    }
  }
};

const normalizeInputComponents = async (
  req: MedusaRequest,
  productId: string,
  components: z.infer<typeof bundleComponentInputSchema>[],
): Promise<CatalogBundleMutationInput["components"]> => {
  await Promise.all(
    components.map((component) =>
      validateBundleComponent(req, productId, component),
    ),
  );
  return components.map((component, index) => ({
    component_product_id: component.componentProductId,
    component_variant_id: toNullableString(component.componentVariantId),
    component_inventory_item_id: toNullableString(
      component.componentInventoryItemId,
    ),
    title: toNullableString(component.title),
    variant_title: toNullableString(component.variantTitle),
    sku: toNullableString(component.sku),
    quantity: component.quantity ?? 1,
    sort_order: component.sortOrder ?? index,
    is_required: component.isRequired ?? true,
    metadata: coerceJsonRecord(component.metadata),
  }));
};

const preserveExistingComponents = (
  components: Awaited<
    ReturnType<CatalogService["listCatalogBundleComponents"]>
  >,
): CatalogBundleMutationInput["components"] =>
  components.map((component) => ({
    id: component.id,
    component_product_id: component.component_product_id,
    component_variant_id: component.component_variant_id ?? null,
    component_inventory_item_id:
      component.component_inventory_item_id ?? null,
    title: component.title ?? null,
    variant_title: component.variant_title ?? null,
    sku: component.sku ?? null,
    quantity: component.quantity,
    sort_order: component.sort_order,
    is_required: component.is_required,
    metadata: coerceJsonRecord(component.metadata),
  }));

const actorId = (req: MedusaRequest): string | null =>
  (
    req as MedusaRequest & {
      auth_context?: { actor_id?: string | null };
    }
  ).auth_context?.actor_id ?? null;

const runBundleMutation = async (
  req: MedusaRequest,
  input: CatalogBundleMutationInput,
) => {
  const { result } = await mutateCatalogBundleWorkflow(req.scope).run({
    input,
    context: {
      idempotencyKey: input.idempotencyKey,
      requestId: input.idempotencyKey,
    },
  });
  return result;
};

export const upsertBundleForProduct = async (
  req: MedusaRequest,
  catalogService: CatalogService,
  productId: string,
  input: BundleUpsertInput,
) => {
  await assertProductExists(req, productId);

  const existing = await resolveBundleProfile(catalogService, productId);
  const existingComponents = existing
    ? await catalogService.listCatalogBundleComponents({
        bundle_profile_id: existing.id,
      })
    : [];
  const existingComponentsCount = existingComponents.length;
  validateBundleShape(
    productId,
    input,
    existingComponentsCount,
    existing?.bundle_type,
  );

  const defaults = resolveDefaults(input, existing);
  const components =
    input.components === undefined
      ? preserveExistingComponents(existingComponents)
      : await normalizeInputComponents(req, productId, input.components);
  const descriptionHtml = toNullableString(input.descriptionHtml);
  const profile = {
    product_id: productId,
    product_profile_id:
      input.productProfileId === undefined
        ? (existing?.product_profile_id ?? null)
        : toNullableString(input.productProfileId),
    bundle_type: defaults.bundleType,
    inventory_mode: defaults.inventoryMode,
    fulfillment_mode: defaults.fulfillmentMode,
    display_title:
      input.displayTitle === undefined
        ? (existing?.display_title ?? null)
        : toNullableString(input.displayTitle),
    description_html:
      input.descriptionHtml === undefined
        ? (existing?.description_html ?? null)
        : descriptionHtml
          ? sanitizeRichTextHtml(descriptionHtml)
          : null,
    is_active: input.isActive ?? existing?.is_active ?? true,
    metadata:
      input.metadata === undefined
        ? coerceJsonRecord(existing?.metadata)
        : coerceJsonRecord(input.metadata),
  } satisfies CatalogBundleMutationInput["profile"];
  const commandPayload = {
    aggregateId: productId,
    command: "catalog.bundle.upsert" as const,
    expectedVersion: input.expectedVersion,
    profile,
    components,
  };
  await runBundleMutation(req, {
    ...commandPayload,
    actorId: actorId(req),
    idempotencyKey: input.idempotencyKey,
    requestSha256: hashCatalogCommand(commandPayload),
  });

  const refreshed = await resolveBundleProfile(catalogService, productId);
  return {
    status: existing ? 200 : 201,
    body: await serializeBundleResponse(catalogService, refreshed),
  };
};

export const deleteBundleForProduct = async (
  req: MedusaRequest,
  catalogService: CatalogService,
  productId: string,
  input: BundleDeleteInput,
): Promise<void> => {
  await assertProductExists(req, productId);
  const commandPayload = {
    aggregateId: productId,
    command: "catalog.bundle.delete" as const,
    expectedVersion: input.expectedVersion,
    profile: null,
    components: [] as CatalogBundleComponentState[],
  };
  await runBundleMutation(req, {
    ...commandPayload,
    actorId: actorId(req),
    idempotencyKey: input.idempotencyKey,
    requestSha256: hashCatalogCommand(commandPayload),
  });
};
