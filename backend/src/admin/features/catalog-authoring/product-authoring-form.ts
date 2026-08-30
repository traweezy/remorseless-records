import { z } from "zod";

import type { AdminFormIssue } from "../../components/admin-form-contract";

const productStatuses = ["draft", "published", "proposed", "rejected"] as const;
const availabilityStatuses = [
  "available",
  "in_stock",
  "low_stock",
  "coming_soon",
  "preorder",
  "backorder",
  "sold_out",
  "unknown",
] as const;
const bundleTypes = ["fixed", "mystery", "deal", "selectable"] as const;
const referenceKinds = [
  "format",
  "format_detail",
  "genre",
  "label",
  "merch_type",
  "product_type",
  "utility_tag",
] as const;

const optionalHttpUrlSchema = z
  .string()
  .trim()
  .max(2_000)
  .refine((value) => {
    if (!value) {
      return true;
    }
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "Enter a complete http or https URL.");

const jsonTextSchema = (shape: "array" | "object") =>
  z.string().max(200_000).superRefine((value, context) => {
    try {
      const parsed = JSON.parse(value) as unknown;
      const valid = shape === "array"
        ? Array.isArray(parsed)
        : parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
      if (!valid) {
        context.addIssue({
          code: "custom",
          message: `Enter a JSON ${shape}.`,
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        message: `Enter valid JSON for this ${shape}.`,
      });
    }
  });

export const productAuthoringDraftSchema = z
  .object({
    bundle: z.object({
      bundleType: z.enum(bundleTypes),
      components: z.array(
        z.object({
          componentProductId: z.string(),
          componentVariantId: z.string(),
          key: z.string().min(1),
          quantity: z.string(),
          sku: z.string(),
          title: z.string(),
          variantTitle: z.string(),
        }),
      ),
      descriptionHtml: z.string().max(200_000),
      displayTitle: z.string().trim().max(300),
      enabled: z.boolean(),
      fulfillmentMode: z.enum(["ship_components", "manual"]),
      inventoryMode: z.enum(["component_derived", "manual"]),
      isActive: z.boolean(),
    }),
    product: z.object({
      description: z.string().max(20_000),
      handle: z.string().trim().min(1, "Enter a product handle.").max(255),
      status: z.enum(productStatuses),
      title: z.string().trim().min(1, "Enter a product title.").max(300),
    }),
    profile: z.object({
      artists: z.array(
        z.object({
          artistId: z.string(),
          displayName: z.string().trim().max(300),
          key: z.string().min(1),
          name: z.string().trim().max(300),
          role: z.string().trim().max(100),
        }),
      ),
      creditsJson: jsonTextSchema("object"),
      descriptionHtml: z.string().max(200_000),
      labelId: z.string(),
      labelLabel: z.string().trim().max(300),
      merchDetailsJson: jsonTextSchema("object"),
      pressingNotesJson: jsonTextSchema("object"),
      productTypeId: z.string(),
      productTypeLabel: z.string().trim().max(300),
      references: z.array(
        z.object({
          key: z.string().min(1),
          kind: z.enum(referenceKinds),
          label: z.string().trim().max(300),
          referenceValueId: z.string(),
        }),
      ),
      releaseDate: z.string(),
      releaseTitle: z.string().trim().max(300),
      releaseYear: z
        .string()
        .trim()
        .refine(
          (value) =>
            !value ||
            (/^\d{4}$/u.test(value) &&
              Number(value) >= 1000 &&
              Number(value) <= 2200),
          "Enter a four-digit release year.",
        ),
      searchKeywords: z.string().max(5_000),
      tracklistJson: jsonTextSchema("array"),
    }),
    variants: z.array(
      z.object({
        availabilityStatus: z.enum(availabilityStatuses),
        backorderAllowed: z.boolean(),
        backorderNote: z.string().trim().max(500),
        displayLabel: z.string().trim().max(300),
        formatDetailId: z.string(),
        formatDetailLabel: z.string().trim().max(100),
        formatId: z.string(),
        formatLabel: z
          .string()
          .trim()
          .min(1, "Choose or enter a format for every variant.")
          .max(100),
        imageUrl: optionalHttpUrlSchema,
        preorderReleaseDate: z.string(),
        variantId: z.string().min(1),
        version: z.number().int().nonnegative(),
      }),
    ),
  })
  .superRefine((draft, context) => {
    if (!draft.profile.labelId && !draft.profile.labelLabel) {
      context.addIssue({
        code: "custom",
        message: "Choose or enter a label/source.",
        path: ["profile", "labelLabel"],
      });
    }
    if (!draft.profile.productTypeId && !draft.profile.productTypeLabel) {
      context.addIssue({
        code: "custom",
        message: "Choose or enter a product type.",
        path: ["profile", "productTypeLabel"],
      });
    }
    draft.profile.artists.forEach((artist, index) => {
      if (!artist.artistId && !artist.displayName && !artist.name) {
        context.addIssue({
          code: "custom",
          message: "Choose an artist or enter the customer-facing name.",
          path: ["profile", "artists", index],
        });
      }
    });
    draft.variants.forEach((variant, index) => {
      if (
        variant.availabilityStatus === "preorder" &&
        !variant.preorderReleaseDate
      ) {
        context.addIssue({
          code: "custom",
          message: "Choose a release time for a preorder variant.",
          path: ["variants", index, "preorderReleaseDate"],
        });
      }
    });
    if (
      draft.bundle.enabled &&
      draft.bundle.bundleType !== "mystery" &&
      draft.bundle.components.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Add at least one included product to this bundle.",
        path: ["bundle", "components"],
      });
    }
    draft.bundle.components.forEach((component, index) => {
      if (!component.componentProductId) {
        context.addIssue({
          code: "custom",
          message: "Choose an included product.",
          path: ["bundle", "components", index, "componentProductId"],
        });
      }
      if (!/^\d+$/u.test(component.quantity) || Number(component.quantity) < 1) {
        context.addIssue({
          code: "custom",
          message: "Quantity must be a whole number of at least 1.",
          path: ["bundle", "components", index, "quantity"],
        });
      }
    });
  });

export type ProductAuthoringDraft = z.input<typeof productAuthoringDraftSchema>;

export const createEmptyProductAuthoringDraft = (): ProductAuthoringDraft => ({
  bundle: {
    bundleType: "fixed",
    components: [],
    descriptionHtml: "",
    displayTitle: "",
    enabled: false,
    fulfillmentMode: "ship_components",
    inventoryMode: "component_derived",
    isActive: true,
  },
  product: {
    description: "",
    handle: "",
    status: "draft",
    title: "",
  },
  profile: {
    artists: [],
    creditsJson: "{}",
    descriptionHtml: "",
    labelId: "",
    labelLabel: "",
    merchDetailsJson: "{}",
    pressingNotesJson: "{}",
    productTypeId: "",
    productTypeLabel: "",
    references: [],
    releaseDate: "",
    releaseTitle: "",
    releaseYear: "",
    searchKeywords: "",
    tracklistJson: "[]",
  },
  variants: [],
});

const sectionTargets = {
  bundle: "product-authoring-bundle",
  product: "product-authoring-commerce",
  profile: "product-authoring-profile",
  variants: "product-authoring-variants",
} as const;

const exactTargets: Record<string, string> = {
  "product.handle": "product-authoring-handle",
  "product.title": "product-authoring-title",
  "profile.creditsJson": "product-authoring-credits",
  "profile.labelLabel": "product-authoring-label",
  "profile.merchDetailsJson": "product-authoring-merch-details",
  "profile.pressingNotesJson": "product-authoring-pressing-notes",
  "profile.productTypeLabel": "product-authoring-product-type",
  "profile.releaseYear": "product-authoring-release-year",
  "profile.tracklistJson": "product-authoring-tracklist",
};

export const productAuthoringValidationIssues = (
  draft: ProductAuthoringDraft,
): AdminFormIssue[] => {
  const result = productAuthoringDraftSchema.safeParse(draft);
  if (result.success) {
    return [];
  }
  return result.error.issues.map((issue) => {
    const path = issue.path.join(".");
    const root = issue.path[0];
    const targetId =
      exactTargets[path] ??
      (typeof root === "string" && root in sectionTargets
        ? sectionTargets[root as keyof typeof sectionTargets]
        : null);
    return {
      key: `${path}:${issue.message}`,
      message: issue.message,
      targetId,
    };
  });
};

export const productAuthoringFingerprint = (
  draft: ProductAuthoringDraft,
): string =>
  JSON.stringify({
    ...draft,
    bundle: {
      ...draft.bundle,
      components: draft.bundle.components.map(({ key: _key, ...component }) =>
        component
      ),
    },
    profile: {
      ...draft.profile,
      artists: draft.profile.artists.map(({ key: _key, ...artist }) => artist),
      references: draft.profile.references.map(
        ({ key: _key, ...reference }) => reference,
      ),
    },
    variants: draft.variants.map(({ version: _version, ...variant }) => variant),
  });
