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
import { syncComponentDerivedBundleInventory } from "@/lib/catalog/bundle-inventory";
import {
  assertProductExists,
  assertVariantExists,
  coerceJsonRecord,
  firstResult,
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
  metadata: z.record(z.unknown()).optional(),
});

export const bundleUpsertSchema = z.object({
  productProfileId: z.string().trim().optional().nullable(),
  bundleType: z.enum(catalogBundleTypeValues).optional(),
  inventoryMode: z.enum(catalogBundleInventoryModeValues).optional(),
  fulfillmentMode: z.enum(catalogBundleFulfillmentModeValues).optional(),
  displayTitle: z.string().trim().optional().nullable(),
  descriptionHtml: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
  components: z.array(bundleComponentInputSchema).max(100).optional(),
});

export type BundleUpsertInput = z.infer<typeof bundleUpsertSchema>;

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

const deleteBundleComponents = async (
  catalogService: CatalogService,
  bundleProfileId: string,
): Promise<void> => {
  const existing = await catalogService.listCatalogBundleComponents({
    bundle_profile_id: bundleProfileId,
  });
  const ids = existing.map((component) => component.id);
  if (ids.length) {
    await catalogService.deleteCatalogBundleComponents(ids);
  }
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

const resolveDefaults = (input: BundleUpsertInput): ResolvedBundleDefaults => {
  const bundleType = input.bundleType ?? "fixed";
  if (bundleType === "mystery") {
    return {
      bundleType,
      inventoryMode: "manual",
      fulfillmentMode: "manual",
    };
  }

  return {
    bundleType,
    inventoryMode: input.inventoryMode ?? "component_derived",
    fulfillmentMode: input.fulfillmentMode ?? "ship_components",
  };
};

const replaceBundleComponents = async (
  req: MedusaRequest,
  catalogService: CatalogService,
  productId: string,
  bundleProfileId: string,
  components: z.infer<typeof bundleComponentInputSchema>[],
): Promise<void> => {
  await deleteBundleComponents(catalogService, bundleProfileId);

  const payloads = [];
  for (const [index, component] of components.entries()) {
    if (component.componentProductId === productId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "A bundle cannot include itself as a component",
      );
    }

    await assertProductExists(req, component.componentProductId);
    const componentVariantId = toNullableString(component.componentVariantId);
    if (componentVariantId) {
      await assertVariantExists(req, componentVariantId);
    }

    payloads.push({
      bundle_profile_id: bundleProfileId,
      component_product_id: component.componentProductId,
      component_variant_id: componentVariantId,
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
    });
  }

  if (payloads.length) {
    await catalogService.createCatalogBundleComponents(payloads);
  }
};

export const upsertBundleForProduct = async (
  req: MedusaRequest,
  catalogService: CatalogService,
  productId: string,
  input: BundleUpsertInput,
) => {
  await assertProductExists(req, productId);

  const existing = await resolveBundleProfile(catalogService, productId);
  const existingComponentsCount = existing
    ? (
        await catalogService.listCatalogBundleComponents({
          bundle_profile_id: existing.id,
        })
      ).length
    : 0;
  validateBundleShape(
    productId,
    input,
    existingComponentsCount,
    existing?.bundle_type,
  );

  const defaults = resolveDefaults(input);
  const payload: Record<string, unknown> = {
    product_id: productId,
  };

  if (input.productProfileId !== undefined) {
    payload.product_profile_id = toNullableString(input.productProfileId);
  }
  if (input.bundleType !== undefined || !existing) {
    payload.bundle_type = defaults.bundleType;
  }
  if (input.inventoryMode !== undefined || !existing) {
    payload.inventory_mode = defaults.inventoryMode;
  }
  if (input.fulfillmentMode !== undefined || !existing) {
    payload.fulfillment_mode = defaults.fulfillmentMode;
  }
  if (input.displayTitle !== undefined) {
    payload.display_title = toNullableString(input.displayTitle);
  }
  if (input.descriptionHtml !== undefined) {
    payload.description_html = toNullableString(input.descriptionHtml);
  }
  if (input.isActive !== undefined) {
    payload.is_active = input.isActive;
  }
  if (input.metadata !== undefined) {
    payload.metadata = coerceJsonRecord(input.metadata);
  }

  const savedResult = existing
    ? await catalogService.updateCatalogBundleProfiles([
        {
          id: existing.id,
          ...payload,
        },
      ])
    : await catalogService.createCatalogBundleProfiles([payload]);
  const saved = firstResult(savedResult);
  if (!saved) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Unable to save catalog bundle",
    );
  }

  if (input.components !== undefined) {
    await replaceBundleComponents(
      req,
      catalogService,
      productId,
      saved.id,
      input.components,
    );
  }

  await syncComponentDerivedBundleInventory(req.scope, productId);

  const refreshed = await resolveBundleProfile(catalogService, productId);
  return {
    status: existing ? 200 : 201,
    body: await serializeBundleResponse(catalogService, refreshed),
  };
};

export const deleteBundleForProduct = async (
  catalogService: CatalogService,
  productId: string,
): Promise<void> => {
  const existing = await resolveBundleProfile(catalogService, productId);
  if (!existing) {
    return;
  }

  await deleteBundleComponents(catalogService, existing.id);
  await catalogService.deleteCatalogBundleProfiles(existing.id);
};
