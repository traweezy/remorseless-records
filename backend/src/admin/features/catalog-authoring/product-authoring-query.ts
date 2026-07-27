import {
  queryOptions,
  type QueryFunctionContext,
} from "@tanstack/react-query";
import { z } from "zod";

import { requestAdminJson } from "../../lib/admin-request";

const authoringProductKindSchema = z.enum([
  "music_release",
  "merch",
  "fixed_bundle",
  "mystery_bundle",
]);

const authoringCustomerStatusSchema = z.enum([
  "hidden",
  "coming_soon",
  "preorder",
  "backorder",
  "sold_out",
  "low_stock",
  "in_stock",
  "unknown",
]);

const authoringInventoryStatusSchema = z.enum([
  "not_managed",
  "unknown",
  "sold_out",
  "low_stock",
  "in_stock",
]);

const referenceSummarySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

const productAuthoringViewSchema = z.object({
  catalog: z.object({
    artists: z.array(
      z.object({
        artist: z
          .object({
            id: z.string().min(1),
            name: z.string().min(1),
          })
          .nullable(),
        assignment: z.object({
          displayName: z.string(),
          role: z.string().min(1),
        }),
      }),
    ),
    bundle: z
      .object({
        components: z.array(
          z.object({
            id: z.string().min(1),
          }),
        ),
        profile: z.object({
          bundleType: z.string().min(1),
          id: z.string().min(1),
          isActive: z.boolean(),
        }),
      })
      .nullable(),
    label: referenceSummarySchema.nullable(),
    media: z.array(
      z.object({
        asset: z
          .object({
            altText: z.string().nullable(),
            lifecycleStatus: z.string().min(1),
          })
          .nullable(),
        isPrimary: z.boolean(),
        mediaAssetId: z.string().min(1),
      }),
    ),
    productType: referenceSummarySchema.nullable(),
    profile: z
      .object({
        id: z.string().min(1),
        releaseDate: z.string().nullable(),
        releaseDatePrecision: z.string().min(1),
        releaseTitle: z.string().nullable(),
        releaseYear: z.number().int().nullable(),
      })
      .nullable(),
    variants: z.array(
      z.object({
        format: referenceSummarySchema.nullable(),
        formatDetail: referenceSummarySchema.nullable(),
        status: z.object({
          customerStatus: authoringCustomerStatusSchema,
          inventoryQuantity: z.number().nullable(),
          inventoryStatus: authoringInventoryStatusSchema,
          reason: z.string().min(1),
        }),
        variantId: z.string().min(1),
      }),
    ),
  }),
  classification: z.object({
    issues: z.array(
      z.object({
        code: z.string().min(1),
        message: z.string().min(1),
        severity: z.enum(["info", "warning", "error"]),
      }),
    ),
    kind: authoringProductKindSchema.nullable(),
    status: z.enum(["classified", "needs_review", "conflict"]),
  }),
  commerce: z.object({
    handle: z.string().nullable(),
    id: z.string().min(1),
    status: z.string().nullable(),
    title: z.string().min(1),
    variants: z.array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
      }),
    ),
  }),
  diagnostics: z.object({
    duplicateBundleProfileIds: z.array(z.string().min(1)),
    duplicateProductProfileIds: z.array(z.string().min(1)),
    inventoryAvailability: z.enum(["available", "unavailable"]),
    missingArtistIds: z.array(z.string().min(1)),
    missingMediaAssetIds: z.array(z.string().min(1)),
    missingReferenceValueIds: z.array(z.string().min(1)),
    missingVariantProfileIds: z.array(z.string().min(1)),
    orphanVariantProfileIds: z.array(z.string().min(1)),
  }),
});

export const productAuthoringViewPayloadSchema = z.object({
  view: productAuthoringViewSchema,
});

export type ProductAuthoringView = z.infer<
  typeof productAuthoringViewSchema
>;

export const productAuthoringViewQueryKey = (productId: string) =>
  ["catalog", "product-authoring-view", productId] as const;

const loadProductAuthoringView = async ({
  queryKey,
  signal,
}: QueryFunctionContext<
  ReturnType<typeof productAuthoringViewQueryKey>
>): Promise<ProductAuthoringView> => {
  const [, , productId] = queryKey;
  const payload = await requestAdminJson({
    path: `/admin/catalog/products/${encodeURIComponent(productId)}/authoring-view`,
    schema: productAuthoringViewPayloadSchema,
    signal,
  });
  return payload.view;
};

export const productAuthoringViewQueryOptions = (productId: string) =>
  queryOptions({
    queryFn: loadProductAuthoringView,
    queryKey: productAuthoringViewQueryKey(productId),
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 30_000,
  });
