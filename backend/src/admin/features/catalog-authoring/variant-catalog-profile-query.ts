import { queryOptions, type QueryFunctionContext } from "@tanstack/react-query";
import { z } from "zod";

import { requestAdminJson } from "../../lib/admin-request";
import type { VariantCatalogProfilePayload } from "./variant-catalog-profile-form";

const jsonRecordSchema = z.record(z.string(), z.unknown());
const referenceKindSchema = z.enum([
  "format",
  "format_detail",
  "genre",
  "label",
  "merch_type",
  "product_type",
  "utility_tag",
]);

const catalogReferenceValueSchema = z.object({
  id: z.string().min(1),
  isActive: z.boolean(),
  kind: referenceKindSchema,
  label: z.string().min(1),
});

const catalogVariantProfileSchema = z.object({
  availabilityStatus: z.string().min(1),
  backorderAllowed: z.boolean(),
  backorderNote: z.string().nullable(),
  displayLabel: z.string().nullable(),
  formatDetailId: z.string().nullable(),
  formatDetailLabel: z.string().nullable(),
  formatId: z.string().nullable(),
  formatLabel: z.string().nullable(),
  id: z.string().min(1),
  imageUrl: z.string().nullable(),
  metadata: jsonRecordSchema,
  preorderAllowed: z.boolean(),
  preorderReleaseDate: z.string().nullable(),
  productProfileId: z.string().nullable(),
  variantId: z.string().min(1),
  version: z.number().int().nonnegative(),
});

const variantProfileResponseSchema = z.object({
  profile: catalogVariantProfileSchema.nullable(),
});

const referenceValuesResponseSchema = z.object({
  values: z.array(catalogReferenceValueSchema),
});

const productProfileResponseSchema = z.object({
  profile: z
    .object({
      releaseDate: z.string().nullable(),
    })
    .nullable(),
});

export type CatalogReferenceValue = z.infer<
  typeof catalogReferenceValueSchema
>;
export type CatalogVariantProfile = z.infer<
  typeof catalogVariantProfileSchema
>;

export type VariantCatalogProfileData = {
  profile: CatalogVariantProfile | null;
  references: CatalogReferenceValue[];
  releaseDate: string | null;
};

export const variantCatalogProfileQueryKey = (
  variantId: string,
  productId: string | null,
) => ["catalog", "variant-profile", variantId, productId] as const;

export const loadVariantCatalogProfile = async ({
  productId,
  signal,
  variantId,
}: {
  productId: string | null;
  signal?: AbortSignal;
  variantId: string;
}): Promise<VariantCatalogProfileData> => {
  const [variantResponse, referenceResponse, productResponse] =
    await Promise.all([
      requestAdminJson({
        path: `/admin/catalog/variants/${encodeURIComponent(variantId)}/profile`,
        schema: variantProfileResponseSchema,
        ...(signal === undefined ? {} : { signal }),
      }),
      requestAdminJson({
        path: "/admin/catalog/reference-values?limit=500&active=true",
        schema: referenceValuesResponseSchema,
        ...(signal === undefined ? {} : { signal }),
      }),
      productId
        ? requestAdminJson({
            path: `/admin/catalog/products/${encodeURIComponent(productId)}/profile`,
            schema: productProfileResponseSchema,
            ...(signal === undefined ? {} : { signal }),
          })
        : Promise.resolve({ profile: null }),
    ]);
  return {
    profile: variantResponse.profile,
    references: referenceResponse.values,
    releaseDate: productResponse.profile?.releaseDate ?? null,
  };
};

const loadVariantCatalogProfileQuery = ({
  queryKey,
  signal,
}: QueryFunctionContext<
  ReturnType<typeof variantCatalogProfileQueryKey>
>): Promise<VariantCatalogProfileData> => {
  const [, , variantId, productId] = queryKey;
  return loadVariantCatalogProfile({ productId, signal, variantId });
};

export const variantCatalogProfileQueryOptions = (
  variantId: string,
  productId: string | null,
) =>
  queryOptions({
    queryFn: loadVariantCatalogProfileQuery,
    queryKey: variantCatalogProfileQueryKey(variantId, productId),
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 30_000,
  });

export const saveVariantCatalogProfile = async ({
  expectedVersion,
  idempotencyKey,
  payload,
  variantId,
}: {
  expectedVersion: number;
  idempotencyKey: string;
  payload: VariantCatalogProfilePayload;
  variantId: string;
}): Promise<CatalogVariantProfile | null> => {
  const response = await requestAdminJson({
    body: { ...payload, expectedVersion, idempotencyKey },
    method: "PUT",
    path: `/admin/catalog/variants/${encodeURIComponent(variantId)}/profile`,
    schema: variantProfileResponseSchema,
  });
  return response.profile;
};
