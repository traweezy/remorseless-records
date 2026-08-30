import { z } from "zod";

import type { AdminFormIssue } from "../../components/admin-form-contract";
import {
  automationTypes,
  shelfModes,
  type CreateShelfState,
  type ShelfFormState,
} from "./catalog-merchandising-types";

const optionalWholeNumber = ({
  minimum,
  minimumMessage,
}: {
  minimum: number;
  minimumMessage: string;
}) =>
  z
    .string()
    .trim()
    .refine(
      (value) => !value || (/^\d+$/u.test(value) && Number(value) >= minimum),
      minimumMessage,
    );

const dateTimeInput = z.string().refine(
  (value) => !value || !Number.isNaN(new Date(value).getTime()),
  "Choose a valid date and time.",
);

const shelfBaseSchema = z.object({
  automationType: z.enum(automationTypes),
  handle: z
    .string()
    .trim()
    .min(1, "Enter a storefront handle.")
    .max(255)
    .refine(
      (value) => !value || /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value),
      "Use lowercase letters, numbers, and single hyphens.",
    ),
  mode: z.enum(shelfModes),
  productLimit: optionalWholeNumber({
    minimum: 1,
    minimumMessage: "Product limit must be a whole number of at least 1.",
  }),
  ribbonLabel: z.string().trim().max(120),
  ribbonPriority: optionalWholeNumber({
    minimum: 0,
    minimumMessage: "Ribbon priority must be a whole number of at least 0.",
  }),
  showRibbon: z.boolean(),
  title: z.string().trim().min(1, "Enter a shelf title.").max(160),
});

const validateShelfRules = (
  shelf: z.infer<typeof shelfBaseSchema>,
  context: z.RefinementCtx,
): void => {
  if (shelf.mode === "automatic" && shelf.automationType === "none") {
    context.addIssue({
      code: "custom",
      message: "Choose an automation rule for an automatic shelf.",
      path: ["automationType"],
    });
  }
  if (shelf.showRibbon && !shelf.ribbonLabel) {
    context.addIssue({
      code: "custom",
      message: "Enter the ribbon text customers will see.",
      path: ["ribbonLabel"],
    });
  }
};

export const catalogShelfCreateSchema = shelfBaseSchema.superRefine(
  validateShelfRules,
);

export const catalogShelfFormSchema = shelfBaseSchema
  .extend({
    description: z.string().max(2_000),
    endsAt: dateTimeInput,
    isActive: z.boolean(),
    products: z.array(
      z.object({
        endsAt: dateTimeInput,
        isPinned: z.boolean(),
        key: z.string().min(1),
        productId: z.string().min(1, "Choose a product or remove this row."),
        sortOrder: optionalWholeNumber({
          minimum: 0,
          minimumMessage: "Product order must be a whole number of at least 0.",
        }).refine((value) => value.length > 0, "Enter a product order."),
        startsAt: dateTimeInput,
      }),
    ),
    startsAt: dateTimeInput,
    version: z.number().int().nonnegative(),
  })
  .superRefine((shelf, context) => {
    validateShelfRules(shelf, context);
    if (
      shelf.startsAt &&
      shelf.endsAt &&
      new Date(shelf.endsAt).getTime() <= new Date(shelf.startsAt).getTime()
    ) {
      context.addIssue({
        code: "custom",
        message: "Shelf end time must be later than its start time.",
        path: ["endsAt"],
      });
    }
    const productIds = new Set<string>();
    shelf.products.forEach((product, index) => {
      if (productIds.has(product.productId)) {
        context.addIssue({
          code: "custom",
          message: "Each product can appear only once on a shelf.",
          path: ["products", index, "productId"],
        });
      }
      productIds.add(product.productId);
      if (
        product.startsAt &&
        product.endsAt &&
        new Date(product.endsAt).getTime() <=
          new Date(product.startsAt).getTime()
      ) {
        context.addIssue({
          code: "custom",
          message: "Product end time must be later than its start time.",
          path: ["products", index, "endsAt"],
        });
      }
    });
  });

const shelfTargetByField: Record<string, string> = {
  automationType: "shelf-automation",
  endsAt: "shelf-end",
  handle: "shelf-handle",
  productLimit: "shelf-limit",
  ribbonLabel: "shelf-ribbon-label",
  ribbonPriority: "shelf-priority",
  startsAt: "shelf-start",
  title: "shelf-title",
};

const createTargetByField: Record<string, string> = {
  automationType: "new-shelf-automation",
  handle: "new-shelf-handle",
  productLimit: "new-shelf-limit",
  ribbonLabel: "new-shelf-ribbon",
  ribbonPriority: "new-shelf-priority",
  title: "new-shelf-title",
};

const issuesFor = (
  result: z.ZodSafeParseResult<unknown>,
  targets: Record<string, string>,
): AdminFormIssue[] => {
  if (result.success) {
    return [];
  }
  return result.error.issues.map((issue) => {
    const root = String(issue.path[0] ?? "");
    return {
      key: `${issue.path.join(".")}:${issue.message}`,
      message: issue.message,
      targetId: root === "products" ? "shelf-products" : (targets[root] ?? null),
    };
  });
};

export const catalogShelfValidationIssues = (
  value: ShelfFormState,
): AdminFormIssue[] =>
  issuesFor(catalogShelfFormSchema.safeParse(value), shelfTargetByField);

export const catalogShelfCreateValidationIssues = (
  value: CreateShelfState,
): AdminFormIssue[] =>
  issuesFor(catalogShelfCreateSchema.safeParse(value), createTargetByField);

export const catalogShelfFingerprint = (value: ShelfFormState): string =>
  JSON.stringify({
    ...value,
    products: value.products.map(({ key: _key, ...product }) => product),
    version: undefined,
  });
