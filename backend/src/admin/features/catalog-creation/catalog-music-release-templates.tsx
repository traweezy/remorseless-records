"use client"

import { memo, useCallback, useMemo, useState, type MouseEvent } from "react"
import { Button, Text } from "@medusajs/ui"

import { ConfirmAction } from "../../components/confirm-action"
import {
  catalogCreationMusicReleaseTemplates,
  type CatalogCreationMusicReleaseTemplateId,
} from "./catalog-product-create-form"

type CatalogMusicReleaseTemplatesProps = {
  currentCount: number
  onApply: (templateId: CatalogCreationMusicReleaseTemplateId) => void
}

export const CatalogMusicReleaseTemplates =
  memo<CatalogMusicReleaseTemplatesProps>(({ currentCount, onApply }) => {
    const [pendingTemplateId, setPendingTemplateId] =
      useState<CatalogCreationMusicReleaseTemplateId | null>(null)
    const pendingTemplate = useMemo(
      () =>
        catalogCreationMusicReleaseTemplates.find(
          (template) => template.id === pendingTemplateId
        ) ?? null,
      [pendingTemplateId]
    )
    const handleChoose = useCallback((event: MouseEvent<HTMLButtonElement>) => {
      const templateId = event.currentTarget.dataset.templateId
      if (
        catalogCreationMusicReleaseTemplates.some(
          (template) => template.id === templateId
        )
      ) {
        setPendingTemplateId(
          templateId as CatalogCreationMusicReleaseTemplateId
        )
      }
    }, [])
    const handleCancel = useCallback(() => setPendingTemplateId(null), [])
    const handleConfirm = useCallback(() => {
      if (!pendingTemplateId) {
        return
      }
      onApply(pendingTemplateId)
      setPendingTemplateId(null)
    }, [onApply, pendingTemplateId])

    return (
      <section
        aria-labelledby="catalog-release-template-title"
        className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4"
      >
        <Text id="catalog-release-template-title" size="small" weight="plus">
          Start from a catalog format set
        </Text>
        <Text className="mt-1 text-ui-fg-subtle" size="xsmall">
          These are the format combinations used most often in the current
          catalog. A template replaces the rows below; price, stock, SKU, and
          format detail remain deliberate so a draft cannot be published with
          copied inventory or pricing.
        </Text>
        <div className="mt-3 flex flex-wrap gap-2">
          {catalogCreationMusicReleaseTemplates.map((template) => (
            <Button
              aria-label={`${template.label}, ${template.formats.length} ${template.formats.length === 1 ? "offering" : "offerings"}. ${template.description}`}
              data-template-id={template.id}
              key={template.id}
              onClick={handleChoose}
              size="small"
              type="button"
              variant="secondary"
            >
              {template.label}
            </Button>
          ))}
        </div>
        <ConfirmAction
          confirmLabel="Replace offerings"
          description={
            pendingTemplate
              ? `${pendingTemplate.label} will replace ${currentCount} current ${currentCount === 1 ? "offering" : "offerings"} with ${pendingTemplate.formats.length}. Prices and SKUs will be blank, stock will be zero, and selling policies will reset to stop at zero.`
              : "Choose a release format set first."
          }
          onCancel={handleCancel}
          onConfirm={handleConfirm}
          open={pendingTemplate !== null}
          title="Replace release offerings?"
        />
      </section>
    )
  })

CatalogMusicReleaseTemplates.displayName = "CatalogMusicReleaseTemplates"
