"use client"

import { memo, type ChangeEvent, type MouseEvent } from "react"
import { Button, Container, Heading, Input, Skeleton, Text } from "@medusajs/ui"
import { Trash } from "@medusajs/icons"

import { AdminFormField } from "../../components/admin-form-field"
import { AdminSectionHeader } from "../../components/admin-page"
import { AdminRetryState } from "../../components/admin-retry-state"
import { getAdminRequestErrorMessage } from "../../lib/admin-request"
import {
  CatalogCreationAvailability,
  type CatalogCreationAvailabilityPreview,
} from "./catalog-creation-availability"
import type { CatalogControlledOption } from "./catalog-controlled-input"
import { CatalogMerchandiseTemplates } from "./catalog-merchandise-templates"
import { CatalogMusicReleaseTemplates } from "./catalog-music-release-templates"
import {
  catalogCreationAvailabilityPolicies,
  type CatalogCreationBundleComponent,
  type CatalogCreationFormValues,
  type CatalogCreationKind,
  type CatalogCreationMerchandiseTemplateId,
  type CatalogCreationMusicReleaseTemplateId,
} from "./catalog-product-create-form"
import type { CatalogCreationProductChoiceWithStock } from "./catalog-product-create-query"

const offeringLabel = (kind: CatalogCreationKind): string => {
  if (kind === "merch") {
    return "Size and color combination"
  }
  if (kind === "fixed_bundle") {
    return "Bundle format"
  }
  if (kind === "mystery_bundle") {
    return "Mystery box option"
  }
  return "Release format"
}

const availabilityPolicyLabels = {
  backorder: "Accept backorders",
  inventory_only: "Stop at zero",
  preorder: "Accept preorders",
} as const

const availabilityPolicyHints = {
  backorder:
    "Native backorders keep ordering open after exact inventory reaches zero.",
  inventory_only: "Ordering stops when exact native inventory reaches zero.",
  preorder:
    "Preorders use the future release date and native backorders so zero-stock orders can be accepted.",
} as const

const stockLabel = (quantity: number | null, managed: boolean): string => {
  if (!managed || quantity === null) {
    return "Stock unavailable"
  }
  if (quantity === 0) {
    return "Sold out"
  }
  return `${quantity} in stock`
}

const selectedProduct = (
  choices: CatalogCreationProductChoiceWithStock[],
  productId: string
): CatalogCreationProductChoiceWithStock | undefined =>
  choices.find((choice) => choice.id === productId)

const selectedVariant = (
  choices: CatalogCreationProductChoiceWithStock[],
  component: CatalogCreationBundleComponent
) =>
  selectedProduct(choices, component.productId)?.variants.find(
    (variant) => variant.id === component.variantId
  )

type CatalogCreationOfferingsStepProps = {
  availabilityByOfferingId: ReadonlyMap<
    string,
    CatalogCreationAvailabilityPreview
  >
  choicesData: CatalogCreationProductChoiceWithStock[] | undefined
  choicesError: unknown
  choicesFetching: boolean
  choicesIsError: boolean
  choicesPending: boolean
  formatDetailOptions: CatalogControlledOption[]
  formatOptions: CatalogControlledOption[]
  onAddBundleComponent: () => void
  onAddOffering: () => void
  onApplyMusicReleaseTemplate: (
    templateId: CatalogCreationMusicReleaseTemplateId
  ) => void
  onApplyMerchandiseTemplate: (
    templateId: CatalogCreationMerchandiseTemplateId
  ) => void
  onChoicesRetry: () => void
  onFillMissingSkus: () => void
  onRemoveBundleComponent: (event: MouseEvent<HTMLButtonElement>) => void
  onRemoveOffering: (event: MouseEvent<HTMLButtonElement>) => void
  onUpdateBundleComponent: (
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => void
  onUpdateBundleMapping: (event: ChangeEvent<HTMLInputElement>) => void
  onUpdateOffering: (
    event: ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >
  ) => void
  values: CatalogCreationFormValues
}

export const CatalogCreationOfferingsStep =
  memo<CatalogCreationOfferingsStepProps>(
    ({
      availabilityByOfferingId,
      choicesData,
      choicesError,
      choicesFetching,
      choicesIsError,
      choicesPending,
      formatDetailOptions,
      formatOptions,
      onAddBundleComponent,
      onAddOffering,
      onApplyMusicReleaseTemplate,
      onApplyMerchandiseTemplate,
      onChoicesRetry,
      onFillMissingSkus,
      onRemoveBundleComponent,
      onRemoveOffering,
      onUpdateBundleComponent,
      onUpdateBundleMapping,
      onUpdateOffering,
      values,
    }) => (
      <div className="flex flex-col gap-4">
        <Container className="p-6">
          <AdminSectionHeader
            actions={
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={onFillMissingSkus}
                  size="small"
                  type="button"
                  variant="secondary"
                >
                  Fill missing SKUs
                </Button>
                <Button
                  id="catalog-create-add-offering"
                  onClick={onAddOffering}
                  size="small"
                  type="button"
                  variant="secondary"
                >
                  Add offering
                </Button>
              </div>
            }
            description="Each row becomes a native Medusa variant. Customer labels, SKUs, and prices must be unique and intentional; new stock starts safely at zero."
            title="Offerings"
          />
          {values.kind === "music_release" ? (
            <div className="mt-5">
              <CatalogMusicReleaseTemplates
                currentCount={values.offerings.length}
                onApply={onApplyMusicReleaseTemplate}
              />
            </div>
          ) : null}
          {values.kind === "merch" ? (
            <div className="mt-5">
              <CatalogMerchandiseTemplates
                currentCount={values.offerings.length}
                onApply={onApplyMerchandiseTemplate}
              />
            </div>
          ) : null}
          <div className="mt-5 flex flex-col gap-4">
            {values.offerings.map((offering, index) => {
              const availability = availabilityByOfferingId.get(offering.id)!
              return (
                <section
                  className="rounded-lg border border-ui-border-base p-4"
                  key={offering.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Heading level="h3">
                        {offeringLabel(values.kind)} {index + 1}
                      </Heading>
                      <Text className="mt-1 text-ui-fg-subtle" size="xsmall">
                        Shown to customers as {offering.title || "Untitled"}.
                      </Text>
                    </div>
                    <Button
                      aria-label={`Remove offering ${index + 1}`}
                      data-offering-id={offering.id}
                      disabled={values.offerings.length === 1}
                      onClick={onRemoveOffering}
                      size="small"
                      type="button"
                      variant="secondary"
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {values.kind === "merch" ? (
                      <>
                        <AdminFormField
                          id={`offering-${offering.id}-size`}
                          label="Size or style"
                        >
                          {(control) => (
                            <Input
                              {...control}
                              data-offering-field="size"
                              data-offering-id={offering.id}
                              onChange={onUpdateOffering}
                              value={offering.size}
                            />
                          )}
                        </AdminFormField>
                        <AdminFormField
                          id={`offering-${offering.id}-color`}
                          label="Color"
                          optional
                        >
                          {(control) => (
                            <Input
                              {...control}
                              data-offering-field="color"
                              data-offering-id={offering.id}
                              onChange={onUpdateOffering}
                              value={offering.color}
                            />
                          )}
                        </AdminFormField>
                      </>
                    ) : (
                      <>
                        <AdminFormField
                          hint="Choose an existing base format so Storefront filtering stays consistent."
                          id={`offering-${offering.id}-format`}
                          label="Format"
                        >
                          {(control) => (
                            <Input
                              {...control}
                              data-offering-field="format"
                              data-offering-id={offering.id}
                              list="catalog-create-format-choices"
                              onChange={onUpdateOffering}
                              value={offering.format}
                            />
                          )}
                        </AdminFormField>
                        <AdminFormField
                          hint={
                            'Use a controlled detail when available, such as Black Shell, 2CD, or 12" Black.'
                          }
                          id={`offering-${offering.id}-detail`}
                          label="Format detail"
                          optional
                        >
                          {(control) => (
                            <Input
                              {...control}
                              data-offering-field="formatDetail"
                              data-offering-id={offering.id}
                              list="catalog-create-format-detail-choices"
                              onChange={onUpdateOffering}
                              value={offering.formatDetail}
                            />
                          )}
                        </AdminFormField>
                      </>
                    )}
                    <AdminFormField
                      hint="This exact label appears in the Storefront format selector. Include color or packaging when formats would otherwise look identical."
                      id={`offering-${offering.id}-title`}
                      label="Customer label"
                    >
                      {(control) => (
                        <Input
                          {...control}
                          data-offering-field="title"
                          data-offering-id={offering.id}
                          onChange={onUpdateOffering}
                          value={offering.title}
                        />
                      )}
                    </AdminFormField>
                    <AdminFormField
                      hint="Required for inventory, orders, picking, and support. Fill missing SKUs generates an editable draft from the product and offering names."
                      id={`offering-${offering.id}-sku`}
                      label="SKU"
                    >
                      {(control) => (
                        <Input
                          {...control}
                          data-offering-field="sku"
                          data-offering-id={offering.id}
                          onChange={onUpdateOffering}
                          value={offering.sku}
                        />
                      )}
                    </AdminFormField>
                    <AdminFormField
                      hint="Enter the customer price in US dollars. Zero-dollar products are blocked to prevent accidental free listings."
                      id={`offering-${offering.id}-price`}
                      label="USD price"
                    >
                      {(control) => (
                        <Input
                          {...control}
                          data-offering-field="priceUsd"
                          data-offering-id={offering.id}
                          inputMode="decimal"
                          min="0"
                          onChange={onUpdateOffering}
                          step="0.01"
                          type="number"
                          value={offering.priceUsd}
                        />
                      )}
                    </AdminFormField>
                    {values.kind === "fixed_bundle" ? (
                      <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
                        <Text size="small" weight="plus">
                          Component-derived stock
                        </Text>
                        <Text className="mt-1 text-ui-fg-subtle" size="xsmall">
                          Availability follows the products mapped below.
                        </Text>
                      </div>
                    ) : (
                      <AdminFormField
                        id={`offering-${offering.id}-stock`}
                        label="Initial stock"
                      >
                        {(control) => (
                          <Input
                            {...control}
                            data-offering-field="stockQuantity"
                            data-offering-id={offering.id}
                            inputMode="numeric"
                            min="0"
                            onChange={onUpdateOffering}
                            step="1"
                            type="number"
                            value={offering.stockQuantity}
                          />
                        )}
                      </AdminFormField>
                    )}
                    {values.kind !== "fixed_bundle" ? (
                      <AdminFormField
                        hint={
                          availabilityPolicyHints[offering.availabilityPolicy]
                        }
                        id={`offering-${offering.id}-availability-policy`}
                        label="Selling policy"
                      >
                        {(control) => (
                          <select
                            {...control}
                            className="min-h-9 w-full cursor-pointer rounded-md border border-ui-border-base bg-ui-bg-base px-2"
                            data-offering-field="availabilityPolicy"
                            data-offering-id={offering.id}
                            onChange={onUpdateOffering}
                            value={offering.availabilityPolicy}
                          >
                            {catalogCreationAvailabilityPolicies
                              .filter(
                                (policy) =>
                                  policy !== "preorder" ||
                                  values.kind === "music_release"
                              )
                              .map((policy) => (
                                <option key={policy} value={policy}>
                                  {availabilityPolicyLabels[policy]}
                                </option>
                              ))}
                          </select>
                        )}
                      </AdminFormField>
                    ) : null}
                    <div className="sm:col-span-2 lg:col-span-3">
                      <CatalogCreationAvailability preview={availability} />
                    </div>
                  </div>
                </section>
              )
            })}
          </div>
          <datalist id="catalog-create-format-choices">
            {formatOptions.map((option) => (
              <option key={option.id} value={option.label} />
            ))}
          </datalist>
          <datalist id="catalog-create-format-detail-choices">
            {formatDetailOptions.map((option) => (
              <option key={option.id} value={option.label} />
            ))}
          </datalist>
        </Container>

        {values.kind === "fixed_bundle" ? (
          <Container className="p-6">
            <AdminSectionHeader
              actions={
                <Button
                  disabled={!choicesData?.length}
                  id="catalog-create-add-bundle-component"
                  onClick={onAddBundleComponent}
                  size="small"
                  type="button"
                  variant="secondary"
                >
                  Add included product
                </Button>
              }
              description="Map each included product format to the bundle formats that consume it. Sold-out items are allowed and will make the affected bundle unavailable."
              title="Included products"
            />
            {choicesPending ? (
              <div
                aria-label="Loading product choices"
                className="mt-5 grid gap-3"
                role="status"
              >
                <Skeleton className="h-32" />
                <Skeleton className="h-32" />
              </div>
            ) : choicesIsError ? (
              <div className="mt-5">
                <AdminRetryState
                  message={getAdminRequestErrorMessage(
                    choicesError,
                    "Product choices could not be loaded."
                  )}
                  onRetry={onChoicesRetry}
                  retrying={choicesFetching}
                  title="Included products unavailable"
                />
              </div>
            ) : (
              <div className="mt-5 flex flex-col gap-4">
                {values.bundleComponents.length ? (
                  values.bundleComponents.map((component, index) => {
                    const product = selectedProduct(
                      choicesData ?? [],
                      component.productId
                    )
                    const variant = selectedVariant(
                      choicesData ?? [],
                      component
                    )
                    return (
                      <section
                        className="rounded-lg border border-ui-border-base p-4"
                        key={component.id}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <Heading level="h3">
                            Included product {index + 1}
                          </Heading>
                          <Button
                            aria-label={`Remove included product ${index + 1}`}
                            data-component-id={component.id}
                            onClick={onRemoveBundleComponent}
                            size="small"
                            type="button"
                            variant="secondary"
                          >
                            <Trash className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <AdminFormField
                            id={`component-${component.id}-product`}
                            label="Product"
                          >
                            {(control) => (
                              <select
                                {...control}
                                className="min-h-9 w-full cursor-pointer rounded-md border border-ui-border-base bg-ui-bg-base px-2"
                                data-component-field="productId"
                                data-component-id={component.id}
                                onChange={onUpdateBundleComponent}
                                value={component.productId}
                              >
                                {(choicesData ?? []).map((choice) => (
                                  <option key={choice.id} value={choice.id}>
                                    {choice.title}
                                  </option>
                                ))}
                              </select>
                            )}
                          </AdminFormField>
                          <AdminFormField
                            hint={
                              variant
                                ? stockLabel(
                                    variant.inventoryQuantity,
                                    variant.managesInventory
                                  )
                                : undefined
                            }
                            id={`component-${component.id}-variant`}
                            label="Included format"
                          >
                            {(control) => (
                              <select
                                {...control}
                                className="min-h-9 w-full cursor-pointer rounded-md border border-ui-border-base bg-ui-bg-base px-2"
                                data-component-field="variantId"
                                data-component-id={component.id}
                                onChange={onUpdateBundleComponent}
                                value={component.variantId}
                              >
                                {(product?.variants ?? []).map((choice) => (
                                  <option key={choice.id} value={choice.id}>
                                    {choice.title}
                                    {choice.sku ? ` · ${choice.sku}` : ""}
                                  </option>
                                ))}
                              </select>
                            )}
                          </AdminFormField>
                          <AdminFormField
                            id={`component-${component.id}-quantity`}
                            label="Quantity in bundle"
                          >
                            {(control) => (
                              <Input
                                {...control}
                                data-component-field="quantity"
                                data-component-id={component.id}
                                inputMode="numeric"
                                min="1"
                                onChange={onUpdateBundleComponent}
                                step="1"
                                type="number"
                                value={component.quantity}
                              />
                            )}
                          </AdminFormField>
                          <fieldset
                            className="rounded-md border border-ui-border-base p-3"
                            id={`component-${component.id}-offerings`}
                            tabIndex={-1}
                          >
                            <legend className="px-1 text-sm font-medium">
                              Used by bundle formats
                            </legend>
                            <div className="mt-2 flex flex-wrap gap-3">
                              {values.offerings.map((offering) => (
                                <label
                                  className="flex min-h-8 cursor-pointer items-center gap-2"
                                  key={offering.id}
                                >
                                  <input
                                    checked={component.offeringIds.includes(
                                      offering.id
                                    )}
                                    className="h-4 w-4"
                                    data-component-id={component.id}
                                    data-offering-id={offering.id}
                                    onChange={onUpdateBundleMapping}
                                    type="checkbox"
                                  />
                                  <span className="text-sm">
                                    {offering.title}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </fieldset>
                        </div>
                      </section>
                    )
                  })
                ) : (
                  <div className="rounded-md border border-dashed border-ui-border-base p-6 text-center">
                    <Text weight="plus">No included products yet</Text>
                    <Text className="mt-1 text-ui-fg-subtle" size="small">
                      Add at least one product and map it to every bundle
                      format.
                    </Text>
                  </div>
                )}
              </div>
            )}
          </Container>
        ) : null}
      </div>
    )
  )

CatalogCreationOfferingsStep.displayName = "CatalogCreationOfferingsStep"
