"use client"

import { memo, type MouseEvent } from "react"
import { Button, Container, Text } from "@medusajs/ui"

import { AdminSectionHeader } from "../../components/admin-page"
import {
  CatalogCreationAvailability,
  type CatalogCreationAvailabilityPreview,
} from "./catalog-creation-availability"
import { CatalogCreationReview } from "./catalog-creation-review"
import {
  catalogCreationKindLabels,
  type CatalogCreationFormValues,
} from "./catalog-product-create-form"

type CatalogCreationReviewStepProps = {
  availabilityByOfferingId: ReadonlyMap<
    string,
    CatalogCreationAvailabilityPreview
  >
  onChangeStep: (event: MouseEvent<HTMLButtonElement>) => void
  values: CatalogCreationFormValues
}

export const CatalogCreationReviewStep = memo<CatalogCreationReviewStepProps>(
  ({ availabilityByOfferingId, onChangeStep, values }) => (
    <div className="flex flex-col gap-4">
      <Container className="p-6">
        <AdminSectionHeader
          description="Review the customer-facing result before creating the product draft. Uploaded images already exist in managed storage and will be linked on creation."
          title="Review draft"
        />
        <div className="mt-5 divide-y rounded-lg border border-ui-border-base">
          <div className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div>
              <Text className="text-ui-fg-subtle" size="xsmall">
                Product
              </Text>
              <Text weight="plus">{values.title || "Untitled"}</Text>
              <Text className="text-ui-fg-subtle" size="small">
                {catalogCreationKindLabels[values.kind]} · {values.productType}
              </Text>
            </div>
            <Button
              data-step="1"
              onClick={onChangeStep}
              size="small"
              type="button"
              variant="secondary"
            >
              Change basics
            </Button>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="min-w-0 flex-1">
              <Text className="text-ui-fg-subtle" size="xsmall">
                Offerings
              </Text>
              <Text weight="plus">
                {values.offerings.length}{" "}
                {values.offerings.length === 1 ? "variant" : "variants"}
              </Text>
              <Text
                className="break-words text-ui-fg-subtle"
                size="small"
              >
                {values.offerings
                  .map(
                    (offering) =>
                      `${offering.title} · $${offering.priceUsd}${
                        values.kind === "fixed_bundle"
                          ? " · component stock"
                          : ` · ${offering.stockQuantity} stock`
                      }`,
                  )
                  .join("; ")}
              </Text>
              <div className="mt-3 grid gap-2">
                {values.offerings.map((offering) => (
                  <CatalogCreationAvailability
                    key={offering.id}
                    preview={availabilityByOfferingId.get(offering.id)!}
                  />
                ))}
              </div>
            </div>
            <Button
              data-step="2"
              onClick={onChangeStep}
              size="small"
              type="button"
              variant="secondary"
            >
              Change offerings
            </Button>
          </div>
          {values.kind === "fixed_bundle" ? (
            <div className="p-4">
              <Text className="text-ui-fg-subtle" size="xsmall">
                Bundle mapping
              </Text>
              <Text weight="plus">
                {values.bundleComponents.length} included{" "}
                {values.bundleComponents.length === 1 ? "product" : "products"}
              </Text>
              <Text className="text-ui-fg-subtle" size="small">
                Every offering must have a required component before this draft
                can be created.
              </Text>
            </div>
          ) : null}
          <div className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="min-w-0 flex-1">
              <Text className="text-ui-fg-subtle" size="xsmall">
                Product images
              </Text>
              <Text weight="plus">
                {values.media.length}{" "}
                {values.media.length === 1 ? "image" : "images"}
              </Text>
              <Text className="text-ui-fg-subtle" size="small">
                {values.media.length
                  ? "The first image is primary; every image has required alt text."
                  : "No images will be linked to this draft."}
              </Text>
            </div>
            <Button
              data-step="3"
              onClick={onChangeStep}
              size="small"
              type="button"
              variant="secondary"
            >
              Change images
            </Button>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div>
              <Text className="text-ui-fg-subtle" size="xsmall">
                Storefront details
              </Text>
              <Text size="small">
                {values.description || "No short description yet."}
              </Text>
            </div>
            <Button
              data-step="3"
              onClick={onChangeStep}
              size="small"
              type="button"
              variant="secondary"
            >
              Change details
            </Button>
          </div>
        </div>
      </Container>
      <CatalogCreationReview
        availabilityByOfferingId={availabilityByOfferingId}
        values={values}
      />
    </div>
  ),
)

CatalogCreationReviewStep.displayName = "CatalogCreationReviewStep"
