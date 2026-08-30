import { z } from "zod";

import type {
  CatalogReferenceValue,
  CatalogVariantProfile,
} from "./variant-catalog-profile-query";

export type VariantCatalogWidgetData = {
  allow_backorder?: boolean | null;
  id: string;
  inventory_items?: Array<{
    inventory?: {
      location_levels?: Array<{
        available_quantity?: number | null;
        stocked_quantity?: number | null;
      }>;
    } | null;
  }>;
  inventory_quantity?: number | null;
  manage_inventory?: boolean | null;
  options?: Array<{
    option?: { title?: string | null } | null;
    value?: string | null;
  }>;
  product_id?: string | null;
  sku?: string | null;
  title?: string | null;
};

export type VariantMetadataLine = {
  id: string;
  name: string;
  value: string;
};

const isHttpUrl = (value: string): boolean => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

const metadataLineSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().max(100),
  value: z.string().max(5_000),
});

export const variantCatalogProfileFormSchema = z
  .object({
    backorderAllowed: z.boolean(),
    customerNote: z.string().trim().max(500),
    format: z
      .string()
      .trim()
      .min(1, "Choose or enter a customer-facing format.")
      .max(100),
    formatDetail: z.string().trim().max(100),
    imageUrl: z
      .string()
      .trim()
      .max(2_000)
      .refine(
        (value) => value.length === 0 || isHttpUrl(value),
        "Enter a complete http or https image URL.",
      ),
    metadata: z.array(metadataLineSchema).max(50),
    preorderAllowed: z.boolean(),
  })
  .superRefine((values, context) => {
    const names = new Set<string>();
    values.metadata.forEach((line, index) => {
      const name = line.name.trim();
      const value = line.value.trim();
      if (!name && !value) {
        return;
      }
      if (!name) {
        context.addIssue({
          code: "custom",
          message: "Enter a name for this advanced field.",
          path: ["metadata", index, "name"],
        });
        return;
      }
      const normalized = name.toLocaleLowerCase("en-US");
      if (names.has(normalized)) {
        context.addIssue({
          code: "custom",
          message: "Advanced field names must be unique.",
          path: ["metadata", index, "name"],
        });
      }
      names.add(normalized);
    });
  });

export type VariantCatalogProfileFormValues = z.infer<
  typeof variantCatalogProfileFormSchema
>;

export type VariantCatalogProfilePayload = {
  backorderAllowed: boolean;
  backorderNote: string | null;
  displayLabel: null;
  format?: { label: string; value: string };
  formatDetail?: { label: string; value: string };
  formatDetailId: string | null;
  formatDetailLabel: string | null;
  formatId: string | null;
  formatLabel: string;
  imageUrl: string | null;
  metadata: Record<string, unknown>;
  preorderAllowed: boolean;
  preorderReleaseDate: null;
  productId: string | null;
};

const nullable = (value: string): string | null => value.trim() || null;

const displayMetadataValue = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);

const parseMetadataValue = (value: string): unknown => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
};

const metadataToLines = (
  metadata: Record<string, unknown> | null | undefined,
  createId: () => string,
): VariantMetadataLine[] =>
  Object.entries(metadata ?? {}).map(([name, value]) => ({
    id: createId(),
    name,
    value: displayMetadataValue(value),
  }));

export const variantCatalogProfileValues = (
  profile: CatalogVariantProfile | null,
  createId: () => string = () => crypto.randomUUID(),
): VariantCatalogProfileFormValues => ({
  backorderAllowed: Boolean(
    profile?.backorderAllowed || profile?.availabilityStatus === "backorder",
  ),
  customerNote: profile?.backorderNote ?? "",
  format: profile?.formatLabel ?? "",
  formatDetail: profile?.formatDetailLabel ?? "",
  imageUrl: profile?.imageUrl ?? "",
  metadata: metadataToLines(profile?.metadata, createId),
  preorderAllowed: Boolean(
    profile?.preorderAllowed || profile?.availabilityStatus === "preorder",
  ),
});

const exactReference = (
  references: readonly CatalogReferenceValue[],
  kind: "format" | "format_detail",
  label: string,
): CatalogReferenceValue | undefined => {
  const normalized = label.trim().toLocaleLowerCase("en-US");
  return references.find(
    (reference) =>
      reference.kind === kind &&
      reference.label.trim().toLocaleLowerCase("en-US") === normalized,
  );
};

const namedReference = (
  references: readonly CatalogReferenceValue[],
  kind: "format" | "format_detail",
  label: string,
):
  | { id: string; reference: undefined }
  | { id: null; reference: { label: string; value: string } | undefined } => {
  const trimmed = label.trim();
  if (!trimmed) {
    return { id: null, reference: undefined };
  }
  const match = exactReference(references, kind, trimmed);
  return match
    ? { id: match.id, reference: undefined }
    : { id: null, reference: { label: trimmed, value: trimmed } };
};

const linesToMetadata = (
  lines: readonly VariantMetadataLine[],
): Record<string, unknown> =>
  Object.fromEntries(
    lines.flatMap((line) => {
      const name = line.name.trim();
      return name ? [[name, parseMetadataValue(line.value)] as const] : [];
    }),
  );

export const buildVariantCatalogProfilePayload = ({
  productId,
  references,
  values,
}: {
  productId: string | null | undefined;
  references: readonly CatalogReferenceValue[];
  values: VariantCatalogProfileFormValues;
}): VariantCatalogProfilePayload => {
  const parsed = variantCatalogProfileFormSchema.parse(values);
  const format = namedReference(references, "format", parsed.format);
  const detail = namedReference(
    references,
    "format_detail",
    parsed.formatDetail,
  );
  return {
    backorderAllowed: parsed.backorderAllowed,
    backorderNote:
      parsed.backorderAllowed || parsed.preorderAllowed
        ? nullable(parsed.customerNote)
        : null,
    displayLabel: null,
    ...(format.reference ? { format: format.reference } : {}),
    ...(detail.reference ? { formatDetail: detail.reference } : {}),
    formatDetailId: detail.id,
    formatDetailLabel: nullable(parsed.formatDetail),
    formatId: format.id,
    formatLabel: parsed.format,
    imageUrl: nullable(parsed.imageUrl),
    metadata: linesToMetadata(parsed.metadata),
    preorderAllowed: parsed.preorderAllowed,
    preorderReleaseDate: null,
    productId: productId?.trim() || null,
  };
};

export const variantCatalogProfileWasApplied = ({
  profile,
  values,
}: {
  profile: CatalogVariantProfile | null;
  values: VariantCatalogProfileFormValues;
}): boolean => {
  if (!profile) {
    return false;
  }
  const parsed = variantCatalogProfileFormSchema.parse(values);
  const normalizedMetadata = linesToMetadata(parsed.metadata);
  return (
    profile.formatLabel === parsed.format &&
    (profile.formatDetailLabel ?? "") === parsed.formatDetail &&
    profile.preorderAllowed === parsed.preorderAllowed &&
    profile.backorderAllowed === parsed.backorderAllowed &&
    (profile.backorderNote ?? "") ===
      (parsed.backorderAllowed || parsed.preorderAllowed
        ? parsed.customerNote
        : "") &&
    (profile.imageUrl ?? "") === parsed.imageUrl &&
    JSON.stringify(profile.metadata) === JSON.stringify(normalizedMetadata)
  );
};

export const deriveVariantCatalogLabel = (
  format: string,
  detail: string,
): string => {
  const cleanFormat = format.trim();
  const cleanDetail = detail.trim();
  if (cleanFormat && cleanDetail) {
    return `${cleanFormat} - ${cleanDetail}`;
  }
  return cleanFormat || cleanDetail || "Set format and detail";
};

const variantAvailableQuantity = (
  variant: VariantCatalogWidgetData | undefined,
): number | null => {
  if (!variant?.manage_inventory) {
    return null;
  }
  if (typeof variant.inventory_quantity === "number") {
    return variant.inventory_quantity;
  }
  const total = variant.inventory_items?.reduce(
    (available, item) =>
      available +
      (item.inventory?.location_levels ?? []).reduce(
        (sum, level) => sum + (level.available_quantity ?? 0),
        0,
      ),
    0,
  );
  return typeof total === "number" ? total : null;
};

const dateInput = (value: string | null | undefined): string => {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

export const isFutureCatalogDate = (
  value: string | null | undefined,
  now = new Date(),
): boolean => {
  const parsed = dateInput(value);
  return parsed.length > 0 && parsed > now.toISOString().slice(0, 10);
};

export type VariantCustomerState = {
  description: string;
  label:
    | "Available"
    | "Backorder"
    | "Coming soon"
    | "In stock"
    | "Inventory managed"
    | "Low stock"
    | "Preorder"
    | "Sold out";
};

export const deriveVariantCustomerState = ({
  backorderAllowed,
  nativeBackorderAllowed,
  now,
  preorderAllowed,
  releaseDate,
  variant,
}: {
  backorderAllowed: boolean;
  nativeBackorderAllowed: boolean;
  now?: Date;
  preorderAllowed: boolean;
  releaseDate: string | null | undefined;
  variant: VariantCatalogWidgetData | undefined;
}): VariantCustomerState => {
  const releaseDateLabel = dateInput(releaseDate);
  const futureRelease = isFutureCatalogDate(releaseDate, now);
  const quantity = variantAvailableQuantity(variant);
  if (futureRelease) {
    return preorderAllowed
      ? {
          description: `Release date is ${releaseDateLabel}; customers can buy before release.`,
          label: "Preorder",
        }
      : {
          description: `Release date is ${releaseDateLabel}; preorder is not enabled.`,
          label: "Coming soon",
        };
  }
  if (!variant?.manage_inventory) {
    return {
      description: "Medusa inventory is not managed for this variant.",
      label: "Available",
    };
  }
  if (quantity === null) {
    return {
      description: "Use native inventory levels for exact storefront availability.",
      label: "Inventory managed",
    };
  }
  if (quantity > 0) {
    return {
      description: `${quantity} available through native inventory.`,
      label: quantity <= 5 ? "Low stock" : "In stock",
    };
  }
  if (backorderAllowed || nativeBackorderAllowed) {
    return {
      description: "Stock is zero and backorder eligibility is enabled.",
      label: "Backorder",
    };
  }
  return {
    description: "Stock is zero and backorder eligibility is disabled.",
    label: "Sold out",
  };
};

export const variantNativeLabel = (
  variant: VariantCatalogWidgetData | undefined,
): string => {
  const values =
    variant?.options
      ?.map((option) => option.value?.trim())
      .filter((value): value is string => Boolean(value)) ?? [];
  return values.length > 0 ? values.join(" / ") : variant?.title ?? "Variant";
};

export const variantStockSummary = (
  variant: VariantCatalogWidgetData | undefined,
): string => {
  if (!variant) {
    return "Variant data unavailable";
  }
  if (!variant.manage_inventory) {
    return "Inventory is not managed by Medusa for this variant";
  }
  const quantity = variantAvailableQuantity(variant);
  return quantity === null
    ? "Managed inventory is enabled; use the native Inventory section for quantities"
    : `${quantity} available from native inventory`;
};
