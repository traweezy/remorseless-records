"use client"

import { memo } from "react"
import { Badge, Text } from "@medusajs/ui"

import {
  resolveAuthoringVariantStatus,
  type AuthoringCustomerStatus,
} from "../../../lib/catalog/product-authoring-status"
import {
  normalizeCatalogCreationReleaseDate,
  type CatalogCreationBundleComponent,
  type CatalogCreationKind,
  type CatalogCreationOffering,
  type CatalogCreationReleaseDatePrecision,
} from "./catalog-product-create-form"
import type { CatalogCreationProductChoiceWithStock } from "./catalog-product-create-query"

type AvailabilityColor = "blue" | "green" | "grey" | "orange" | "purple" | "red"

export type CatalogCreationAvailabilityPreview = {
  color: AvailabilityColor
  label: string
  reason: string
  status: AuthoringCustomerStatus
}

const statusPresentation = {
  backorder: { color: "purple", label: "Backorder" },
  coming_soon: { color: "blue", label: "Coming soon" },
  hidden: { color: "grey", label: "Hidden" },
  in_stock: { color: "green", label: "In stock" },
  low_stock: { color: "orange", label: "Low stock" },
  preorder: { color: "blue", label: "Preorder" },
  sold_out: { color: "red", label: "Sold out" },
  unknown: { color: "grey", label: "Stock unavailable" },
} as const satisfies Record<
  AuthoringCustomerStatus,
  { color: AvailabilityColor; label: string }
>

const preview = (
  status: AuthoringCustomerStatus,
  reason: string,
): CatalogCreationAvailabilityPreview => ({
  ...statusPresentation[status],
  reason,
  status,
})

const bundlePreview = ({
  bundleComponents,
  choices,
  offering,
}: {
  bundleComponents: CatalogCreationBundleComponent[]
  choices: CatalogCreationProductChoiceWithStock[]
  offering: CatalogCreationOffering
}): CatalogCreationAvailabilityPreview => {
  const mappings = bundleComponents.filter((component) =>
    component.offeringIds.includes(offering.id),
  )
  if (!mappings.length) {
    return preview(
      "unknown",
      "Map at least one required component before bundle stock can be calculated.",
    )
  }

  const capacities: Array<{ capacity: number; label: string }> = []
  const unavailable: string[] = []
  mappings.forEach((component) => {
    const product = choices.find((choice) => choice.id === component.productId)
    const variant = product?.variants.find(
      (choice) => choice.id === component.variantId,
    )
    const label =
      [product?.title, variant?.title].filter(Boolean).join(" · ") ||
      "A selected component"
    if (
      !variant ||
      (variant.managesInventory && variant.inventoryQuantity === null)
    ) {
      unavailable.push(label)
      return
    }
    if (!variant.managesInventory) {
      return
    }
    const requiredQuantity = Math.max(1, Number(component.quantity) || 1)
    capacities.push({
      capacity: Math.floor((variant.inventoryQuantity ?? 0) / requiredQuantity),
      label,
    })
  })

  if (unavailable.length) {
    return preview(
      "unknown",
      `${unavailable.join(", ")} does not have readable component stock.`,
    )
  }
  if (!capacities.length) {
    return preview(
      "in_stock",
      "Every mapped component has inventory tracking disabled, so Medusa treats this bundle as continuously available.",
    )
  }

  const capacity = Math.min(...capacities.map((item) => item.capacity))
  const limiting = capacities
    .filter((item) => item.capacity === capacity)
    .map((item) => item.label)
    .join(", ")
  if (capacity <= 0) {
    return preview(
      "sold_out",
      `No complete bundles can be assembled; ${limiting} is the limiting component.`,
    )
  }
  if (capacity <= 5) {
    return preview(
      "low_stock",
      `Only ${capacity} complete bundle${capacity === 1 ? "" : "s"} can be assembled; ${limiting} is the limiting component.`,
    )
  }
  return preview(
    "in_stock",
    `${capacity} complete bundles can be assembled from current component stock.`,
  )
}

export const resolveCatalogCreationAvailability = ({
  bundleComponents,
  choices,
  kind,
  now = Date.now(),
  offering,
  releaseDate,
  releaseDatePrecision,
}: {
  bundleComponents: CatalogCreationBundleComponent[]
  choices: CatalogCreationProductChoiceWithStock[]
  kind: CatalogCreationKind
  now?: number
  offering: CatalogCreationOffering
  releaseDate: string
  releaseDatePrecision: CatalogCreationReleaseDatePrecision
}): CatalogCreationAvailabilityPreview => {
  if (kind === "fixed_bundle") {
    return bundlePreview({ bundleComponents, choices, offering })
  }

  const normalizedReleaseDate = normalizeCatalogCreationReleaseDate(
    releaseDate,
    releaseDatePrecision,
  )
  if (
    offering.availabilityPolicy === "preorder" &&
    (!normalizedReleaseDate || Date.parse(normalizedReleaseDate) <= now)
  ) {
    return preview(
      "unknown",
      "Choose a future release date before this offering can be presented as a preorder.",
    )
  }

  const inventoryQuantity = /^\d+$/.test(offering.stockQuantity.trim())
    ? Number(offering.stockQuantity)
    : null
  const status = resolveAuthoringVariantStatus({
    allowBackorder: offering.availabilityPolicy !== "inventory_only",
    inventoryQuantity,
    manageInventory: true,
    now,
    preorderAllowed: offering.availabilityPolicy === "preorder",
    productStatus: "published",
    releaseDate: normalizedReleaseDate,
  })
  const policyReason =
    offering.availabilityPolicy === "backorder" &&
    (status.customerStatus === "in_stock" || status.customerStatus === "low_stock")
      ? `${status.reason} Native backorders keep ordering open after stock reaches zero.`
      : offering.availabilityPolicy === "preorder" &&
          status.customerStatus === "preorder"
        ? `${status.reason} Native backorders keep ordering open at zero stock.`
        : status.reason
  return preview(status.customerStatus, policyReason)
}

export const CatalogCreationAvailability = memo<{
  preview: CatalogCreationAvailabilityPreview
}>(({ preview: availability }) => (
  <div
    aria-label={`Customer availability after publish: ${availability.label}`}
    className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-3"
  >
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Text size="xsmall" weight="plus">
        Customer availability after publish
      </Text>
      <Badge color={availability.color} size="2xsmall">
        {availability.label}
      </Badge>
    </div>
    <Text className="mt-1 text-ui-fg-subtle" size="xsmall">
      {availability.reason}
    </Text>
  </div>
))

CatalogCreationAvailability.displayName = "CatalogCreationAvailability"
