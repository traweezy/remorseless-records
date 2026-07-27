import type { ProductAuthoringView } from "./product-authoring-query";

export type ProductCatalogCompletion = {
  color: "green" | "orange" | "red";
  description: string;
  label: "Blocked" | "Needs review" | "Ready";
};

export type ProductCatalogAvailability = {
  color: "blue" | "green" | "orange" | "red";
  description: string;
  label: string;
};

export type ProductCatalogBundleHealth = {
  color: "blue" | "green" | "orange" | "red";
  description: string;
  label: string;
};

export type ProductCatalogSummary = {
  artistLabel: string;
  availability: ProductCatalogAvailability;
  bundleHealth: ProductCatalogBundleHealth | null;
  completion: ProductCatalogCompletion;
  kindLabel: string;
  media: {
    description: string;
    missingAltText: number;
    total: number;
  };
  releaseLabel: string;
};

const kindLabels: Record<
  NonNullable<ProductAuthoringView["classification"]["kind"]>,
  string
> = {
  fixed_bundle: "Fixed bundle",
  merch: "Merchandise",
  music_release: "Music release",
  mystery_bundle: "Mystery box",
};

const customerStatusLabels: Record<
  ProductAuthoringView["catalog"]["variants"][number]["status"]["customerStatus"],
  string
> = {
  backorder: "backorder",
  coming_soon: "coming soon",
  hidden: "hidden",
  in_stock: "in stock",
  low_stock: "low stock",
  preorder: "preorder",
  sold_out: "sold out",
  unknown: "unknown",
};

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const formatReleaseDate = (
  value: string | null,
  releaseYear: number | null,
): string => {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(parsed);
    }
  }
  return releaseYear?.toString() ?? "Release details not set";
};

const buildCompletion = (
  view: ProductAuthoringView,
): ProductCatalogCompletion => {
  const hasBlockingIssue =
    view.classification.status === "conflict" ||
    view.classification.issues.some(({ severity }) => severity === "error") ||
    view.diagnostics.duplicateBundleProfileIds.length > 0 ||
    view.diagnostics.duplicateProductProfileIds.length > 0;
  if (hasBlockingIssue) {
    return {
      color: "red",
      description:
        "Conflicting or duplicate catalog records must be resolved before publishing changes.",
      label: "Blocked",
    };
  }

  const diagnosticCount = [
    view.diagnostics.missingArtistIds,
    view.diagnostics.missingMediaAssetIds,
    view.diagnostics.missingReferenceValueIds,
    view.diagnostics.missingVariantProfileIds,
    view.diagnostics.orphanVariantProfileIds,
  ].reduce((count, values) => count + values.length, 0);
  const hasReviewIssue =
    view.classification.status === "needs_review" ||
    view.catalog.profile === null ||
    view.classification.issues.some(
      ({ severity }) => severity === "warning",
    ) ||
    diagnosticCount > 0 ||
    view.diagnostics.inventoryAvailability === "unavailable";

  return hasReviewIssue
    ? {
        color: "orange",
        description:
          "Some catalog fields or linked records still need review.",
        label: "Needs review",
      }
    : {
        color: "green",
        description:
          "Catalog classification and linked records are internally consistent.",
        label: "Ready",
      };
};

const buildAvailability = (
  view: ProductAuthoringView,
): ProductCatalogAvailability => {
  const statuses = view.catalog.variants.map(
    ({ status }) => status.customerStatus,
  );
  if (statuses.length === 0) {
    return {
      color: "orange",
      description: "No sellable offerings are linked to this product.",
      label: "No offerings",
    };
  }

  const counts = new Map<string, number>();
  for (const status of statuses) {
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const description = [...counts.entries()]
    .map(([status, count]) =>
      pluralize(
        count,
        `${customerStatusLabels[
          status as keyof typeof customerStatusLabels
        ]} offering`,
      ),
    )
    .join(" · ");

  if (statuses.every((status) => status === "hidden")) {
    return { color: "blue", description, label: "Hidden" };
  }
  if (statuses.some((status) => status === "in_stock")) {
    return { color: "green", description, label: "Available" };
  }
  if (statuses.some((status) => status === "low_stock")) {
    return { color: "orange", description, label: "Low stock" };
  }
  if (statuses.some((status) => status === "preorder")) {
    return { color: "blue", description, label: "Preorder" };
  }
  if (statuses.some((status) => status === "backorder")) {
    return { color: "orange", description, label: "Backorder" };
  }
  if (statuses.every((status) => status === "sold_out")) {
    return { color: "red", description, label: "Sold out" };
  }
  if (statuses.some((status) => status === "coming_soon")) {
    return { color: "blue", description, label: "Coming soon" };
  }
  return { color: "orange", description, label: "Needs review" };
};

const buildBundleHealth = (
  view: ProductAuthoringView,
): ProductCatalogBundleHealth | null => {
  const kind = view.classification.kind;
  if (kind !== "fixed_bundle" && kind !== "mystery_bundle") {
    return null;
  }
  if (!view.catalog.bundle) {
    return {
      color: "red",
      description: "The product is classified as a bundle but has no setup.",
      label: "Bundle setup missing",
    };
  }
  if (kind === "mystery_bundle") {
    return {
      color: "blue",
      description:
        "Mystery boxes use native manual inventory and do not require component mappings.",
      label: "Manual inventory",
    };
  }

  const componentCount = view.catalog.bundle.components.length;
  return componentCount === 0
    ? {
        color: "orange",
        description:
          "Add included items before this fixed bundle is customer-ready.",
        label: "No items mapped",
      }
    : {
        color: "green",
        description: `${pluralize(componentCount, "included item")} mapped to this bundle.`,
        label: "Mapping present",
      };
};

export const buildProductCatalogSummary = (
  view: ProductAuthoringView,
): ProductCatalogSummary => {
  const artistNames = view.catalog.artists
    .map(({ artist, assignment }) => artist?.name ?? assignment.displayName)
    .map((name) => name.trim())
    .filter(Boolean);
  const missingAltText = view.catalog.media.filter(
    ({ asset }) => !asset?.altText?.trim(),
  ).length;
  const releaseTitle =
    view.catalog.profile?.releaseTitle?.trim() || view.commerce.title;
  const releaseDate = formatReleaseDate(
    view.catalog.profile?.releaseDate ?? null,
    view.catalog.profile?.releaseYear ?? null,
  );

  return {
    artistLabel: artistNames.join(", ") || "No artist assigned",
    availability: buildAvailability(view),
    bundleHealth: buildBundleHealth(view),
    completion: buildCompletion(view),
    kindLabel: view.classification.kind
      ? kindLabels[view.classification.kind]
      : "Unclassified",
    media: {
      description:
        view.catalog.media.length === 0
          ? "No managed catalog media"
          : missingAltText > 0
            ? `${pluralize(missingAltText, "image")} missing alternative text`
            : "Alternative text is complete",
      missingAltText,
      total: view.catalog.media.length,
    },
    releaseLabel: `${releaseTitle} · ${releaseDate}`,
  };
};
