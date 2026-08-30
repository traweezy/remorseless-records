"use client"

import { memo, type ChangeEvent } from "react"
import { Container, Text, Textarea } from "@medusajs/ui"

import { AdminFormField } from "../../components/admin-form-field"
import { AdminSectionHeader } from "../../components/admin-page"
import { CatalogCreationMediaEditor } from "./catalog-creation-media"
import type {
  CatalogCreationFormValues,
  CatalogCreationMedia,
} from "./catalog-product-create-form"

type CatalogCreationDetailsStepProps = {
  onMediaChange: (media: CatalogCreationMedia[]) => void
  onTextChange: (
    event: ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
  ) => void
  onUploadingChange: (uploading: boolean) => void
  values: CatalogCreationFormValues
}

export const CatalogCreationDetailsStep = memo<CatalogCreationDetailsStepProps>(
  ({ onMediaChange, onTextChange, onUploadingChange, values }) => (
    <Container className="p-6">
      <AdminSectionHeader
        description="Add the storefront information and ordered product gallery customers will use to understand this item."
        title="Storefront details"
      />
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {values.kind === "music_release" ? (
          <>
            <AdminFormField
              hint="One track per line."
              id="catalog-create-tracklist"
              label="Tracklist"
              optional
            >
              {(control) => (
                <Textarea
                  {...control}
                  name="tracklist"
                  onChange={onTextChange}
                  rows={8}
                  value={values.tracklist}
                />
              )}
            </AdminFormField>
            <AdminFormField
              hint="Plain-language performer, recording, and production credits."
              id="catalog-create-credits"
              label="Credits"
              optional
            >
              {(control) => (
                <Textarea
                  {...control}
                  name="credits"
                  onChange={onTextChange}
                  rows={8}
                  value={values.credits}
                />
              )}
            </AdminFormField>
          </>
        ) : null}
        {values.kind === "merch" ? (
          <>
            <AdminFormField
              id="catalog-create-material"
              label="Material"
              optional
            >
              {(control) => (
                <Textarea
                  {...control}
                  name="material"
                  onChange={onTextChange}
                  rows={4}
                  value={values.material}
                />
              )}
            </AdminFormField>
            <AdminFormField
              id="catalog-create-fit"
              label="Fit and measurements"
              optional
            >
              {(control) => (
                <Textarea
                  {...control}
                  name="merchandiseFit"
                  onChange={onTextChange}
                  rows={4}
                  value={values.merchandiseFit}
                />
              )}
            </AdminFormField>
            <AdminFormField
              hint="List customer-facing measurements by size, one size per line."
              id="catalog-create-size-guide"
              label="Size guide"
              optional
            >
              {(control) => (
                <Textarea
                  {...control}
                  name="sizeGuide"
                  onChange={onTextChange}
                  rows={4}
                  value={values.sizeGuide}
                />
              )}
            </AdminFormField>
            <AdminFormField
              className="md:col-span-2"
              id="catalog-create-care"
              label="Care instructions"
              optional
            >
              {(control) => (
                <Textarea
                  {...control}
                  name="merchandiseCare"
                  onChange={onTextChange}
                  rows={4}
                  value={values.merchandiseCare}
                />
              )}
            </AdminFormField>
          </>
        ) : null}
        {values.kind === "fixed_bundle" ? (
          <div className="md:col-span-2 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
            <Text weight="plus">Included-content presentation</Text>
            <Text className="mt-1 text-ui-fg-subtle" size="small">
              The customer-facing bundle content is generated from the product
              and format mappings reviewed in the previous step.
            </Text>
          </div>
        ) : null}
        {values.kind === "mystery_bundle" ? (
          <>
            <AdminFormField
              hint="Explain the type or minimum value of contents without revealing exact items."
              id="catalog-create-promise"
              label="Customer promise"
            >
              {(control) => (
                <Textarea
                  {...control}
                  name="mysteryPromise"
                  onChange={onTextChange}
                  rows={5}
                  value={values.mysteryPromise}
                />
              )}
            </AdminFormField>
            <AdminFormField
              hint="Clarify substitutions, duplicates, and other expectations."
              id="catalog-create-disclaimer"
              label="Mystery box disclaimer"
              optional
            >
              {(control) => (
                <Textarea
                  {...control}
                  name="mysteryDisclaimer"
                  onChange={onTextChange}
                  rows={5}
                  value={values.mysteryDisclaimer}
                />
              )}
            </AdminFormField>
          </>
        ) : null}
      </div>
      <CatalogCreationMediaEditor
        media={values.media}
        onChange={onMediaChange}
        onUploadingChange={onUploadingChange}
      />
    </Container>
  )
)

CatalogCreationDetailsStep.displayName = "CatalogCreationDetailsStep"
