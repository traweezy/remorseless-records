"use client"

import { memo, type ChangeEvent } from "react"
import { Button, Container, Input, Select, Text, Textarea } from "@medusajs/ui"

import { AdminFormField } from "../../components/admin-form-field"
import { AdminSectionHeader } from "../../components/admin-page"
import {
  CatalogControlledInput,
  type CatalogControlledOption,
} from "./catalog-controlled-input"
import {
  catalogCreationKindLabels,
  catalogCreationReleaseDatePrecisions,
  type CatalogCreationFormValues,
  type CatalogCreationReleaseDatePrecision,
} from "./catalog-product-create-form"

const releaseDatePrecisionLabels: Record<
  CatalogCreationReleaseDatePrecision,
  string
> = {
  day: "Exact day",
  month: "Month only",
  unknown: "Not known",
  year: "Year only",
}

const releaseDateInputType = (
  precision: CatalogCreationReleaseDatePrecision,
): "date" | "month" | "number" => {
  if (precision === "day") {
    return "date"
  }
  if (precision === "month") {
    return "month"
  }
  return "number"
}

export type CatalogCreationReferenceOptions = {
  format: CatalogControlledOption[]
  formatDetail: CatalogControlledOption[]
  genre: CatalogControlledOption[]
  label: CatalogControlledOption[]
  merchType: CatalogControlledOption[]
  productType: CatalogControlledOption[]
}

type CatalogCreationBasicsStepProps = {
  artistOptions: CatalogControlledOption[]
  onArtistChange: (value: string, selectedId: string) => void
  onGenreChange: (value: string, selectedId: string) => void
  onLabelChange: (value: string, selectedId: string) => void
  onMerchandiseTypeChange: (value: string, selectedId: string) => void
  onProductTypeChange: (value: string, selectedId: string) => void
  onReleaseDatePrecisionChange: (precision: string) => void
  onTextChange: (
    event: ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) => void
  onVocabularyRetry: () => void
  referenceOptions: CatalogCreationReferenceOptions
  values: CatalogCreationFormValues
  vocabularyLoading: boolean
  vocabularyUnavailable: boolean
}

export const CatalogCreationBasicsStep = memo<CatalogCreationBasicsStepProps>(
  ({
    artistOptions,
    onArtistChange,
    onGenreChange,
    onLabelChange,
    onMerchandiseTypeChange,
    onProductTypeChange,
    onReleaseDatePrecisionChange,
    onTextChange,
    onVocabularyRetry,
    referenceOptions,
    values,
    vocabularyLoading,
    vocabularyUnavailable,
  }) => (
    <Container className="p-6">
      <AdminSectionHeader
        description={`Customer-facing basics for this ${catalogCreationKindLabels[values.kind].toLowerCase()}.`}
        title="Product basics"
      />
      {vocabularyUnavailable ? (
        <div
          className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-ui-border-error bg-ui-bg-error p-3"
          role="alert"
        >
          <Text className="text-ui-fg-error" size="small">
            Existing catalog choices could not be loaded. Typed names are still
            deduplicated safely when the draft is created.
          </Text>
          <Button
            onClick={onVocabularyRetry}
            size="small"
            type="button"
            variant="secondary"
          >
            Retry choices
          </Button>
        </div>
      ) : null}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <AdminFormField
          id="catalog-create-title"
          label={
            values.kind === "music_release" ? "Release title" : "Product name"
          }
        >
          {(control) => (
            <Input
              {...control}
              name="title"
              onChange={onTextChange}
              value={values.title}
            />
          )}
        </AdminFormField>
        <AdminFormField
          hint="Preselected from the product kind; change it only when a more specific customer-facing type is useful."
          id="catalog-create-product-type"
          label="Product type"
        >
          {(control) => (
            <CatalogControlledInput
              control={control}
              entityLabel="product type"
              loading={vocabularyLoading}
              name="productType"
              onChange={onProductTypeChange}
              options={referenceOptions.productType}
              unavailable={vocabularyUnavailable}
              value={values.productType}
            />
          )}
        </AdminFormField>
        {values.kind === "music_release" ? (
          <>
            <AdminFormField id="catalog-create-artist" label="Primary artist">
              {(control) => (
                <CatalogControlledInput
                  control={control}
                  entityLabel="artist"
                  loading={vocabularyLoading}
                  name="artistName"
                  onChange={onArtistChange}
                  options={artistOptions}
                  unavailable={vocabularyUnavailable}
                  value={values.artistName}
                />
              )}
            </AdminFormField>
            <AdminFormField
              id="catalog-create-label"
              label="Label or source"
              optional
            >
              {(control) => (
                <CatalogControlledInput
                  control={control}
                  entityLabel="label"
                  loading={vocabularyLoading}
                  name="label"
                  onChange={onLabelChange}
                  options={referenceOptions.label}
                  unavailable={vocabularyUnavailable}
                  value={values.label}
                />
              )}
            </AdminFormField>
            <AdminFormField id="catalog-create-genre" label="Genre" optional>
              {(control) => (
                <CatalogControlledInput
                  control={control}
                  entityLabel="genre"
                  loading={vocabularyLoading}
                  name="genre"
                  onChange={onGenreChange}
                  options={referenceOptions.genre}
                  unavailable={vocabularyUnavailable}
                  value={values.genre}
                />
              )}
            </AdminFormField>
            <AdminFormField
              id="catalog-create-date-precision"
              label="Release date detail"
            >
              {(control) => (
                <Select
                  onValueChange={onReleaseDatePrecisionChange}
                  value={values.releaseDatePrecision}
                >
                  <Select.Trigger {...control}>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    {catalogCreationReleaseDatePrecisions.map((precision) => (
                      <Select.Item key={precision} value={precision}>
                        {releaseDatePrecisionLabels[precision]}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              )}
            </AdminFormField>
            {values.releaseDatePrecision !== "unknown" ? (
              <AdminFormField
                id="catalog-create-date"
                label={`Release ${values.releaseDatePrecision}`}
              >
                {(control) => (
                  <Input
                    {...control}
                    inputMode={
                      values.releaseDatePrecision === "year"
                        ? "numeric"
                        : undefined
                    }
                    max={
                      values.releaseDatePrecision === "year" ? 2200 : undefined
                    }
                    min={
                      values.releaseDatePrecision === "year" ? 1900 : undefined
                    }
                    name="releaseDate"
                    onChange={onTextChange}
                    type={releaseDateInputType(values.releaseDatePrecision)}
                    value={values.releaseDate}
                  />
                )}
              </AdminFormField>
            ) : null}
            <AdminFormField
              id="catalog-create-number"
              label="Catalog number"
              optional
            >
              {(control) => (
                <Input
                  {...control}
                  name="catalogNumber"
                  onChange={onTextChange}
                  value={values.catalogNumber}
                />
              )}
            </AdminFormField>
          </>
        ) : null}
        {values.kind === "merch" ? (
          <AdminFormField
            hint="Examples include shirt, hoodie, patch, pin, and poster."
            id="catalog-create-merch-type"
            label="Merchandise type"
          >
            {(control) => (
              <CatalogControlledInput
                control={control}
                entityLabel="merchandise type"
                loading={vocabularyLoading}
                name="merchandiseType"
                onChange={onMerchandiseTypeChange}
                options={referenceOptions.merchType}
                unavailable={vocabularyUnavailable}
                value={values.merchandiseType}
              />
            )}
          </AdminFormField>
        ) : null}
        <AdminFormField
          className="md:col-span-2"
          id="catalog-create-description"
          label="Store description"
          optional
        >
          {(control) => (
            <Textarea
              {...control}
              name="description"
              onChange={onTextChange}
              rows={5}
              value={values.description}
            />
          )}
        </AdminFormField>
        <details className="md:col-span-2 rounded-md border border-ui-border-base p-4">
          <summary className="flex min-h-6 cursor-pointer items-center text-sm font-medium">
            Advanced URL
          </summary>
          <div className="mt-4">
            <AdminFormField
              hint="Leave blank to generate it from the product name."
              id="catalog-create-handle"
              label="URL handle"
              optional
            >
              {(control) => (
                <Input
                  {...control}
                  name="handle"
                  onChange={onTextChange}
                  value={values.handle}
                />
              )}
            </AdminFormField>
          </div>
        </details>
      </div>
    </Container>
  ),
)

CatalogCreationBasicsStep.displayName = "CatalogCreationBasicsStep"
