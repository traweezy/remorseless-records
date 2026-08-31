"use client"

import { memo, useCallback, useMemo, useState, type MouseEvent } from "react"
import { Button, Text } from "@medusajs/ui"

import { ConfirmAction } from "../../components/confirm-action"
import {
  catalogCreationMerchandiseTemplates,
  type CatalogCreationMerchandiseTemplateId,
} from "./catalog-product-create-form"

type CatalogMerchandiseTemplatesProps = {
  currentCount: number
  onApply: (templateId: CatalogCreationMerchandiseTemplateId) => void
}

export const CatalogMerchandiseTemplates =
  memo<CatalogMerchandiseTemplatesProps>(({ currentCount, onApply }) => {
    const [pendingTemplateId, setPendingTemplateId] =
      useState<CatalogCreationMerchandiseTemplateId | null>(null)
    const pendingTemplate = useMemo(
      () =>
        catalogCreationMerchandiseTemplates.find(
          (template) => template.id === pendingTemplateId
        ) ?? null,
      [pendingTemplateId]
    )
    const handleChoose = useCallback((event: MouseEvent<HTMLButtonElement>) => {
      const templateId = event.currentTarget.dataset.templateId
      if (
        catalogCreationMerchandiseTemplates.some(
          (template) => template.id === templateId
        )
      ) {
        setPendingTemplateId(templateId as CatalogCreationMerchandiseTemplateId)
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
        aria-labelledby="catalog-merchandise-template-title"
        className="rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4"
      >
        <Text
          id="catalog-merchandise-template-title"
          size="small"
          weight="plus"
        >
          Start from a merchandise template
        </Text>
        <Text className="mt-1 text-ui-fg-subtle" size="xsmall">
          Templates replace the variant rows below. The first row’s price is
          copied; stock resets to zero, and colors, SKUs, and backorders are
          cleared so nothing can be oversold accidentally.
        </Text>
        <div className="mt-3 flex flex-wrap gap-2">
          {catalogCreationMerchandiseTemplates.map((template) => (
            <Button
              aria-label={`${template.label}, ${template.sizes.length} variants. ${template.description}`}
              data-template-id={template.id}
              key={template.id}
              onClick={handleChoose}
              size="small"
              type="button"
              variant="secondary"
            >
              {template.label} · {template.sizes.length}
            </Button>
          ))}
        </div>
        <ConfirmAction
          confirmLabel="Replace variants"
          description={
            pendingTemplate
              ? `${pendingTemplate.label} will replace ${currentCount} current ${currentCount === 1 ? "variant" : "variants"} with ${pendingTemplate.sizes.length}. The existing first-row price is retained; stock, colors, SKUs, and backorders are reset.`
              : "Choose a merchandise template first."
          }
          onCancel={handleCancel}
          onConfirm={handleConfirm}
          open={pendingTemplate !== null}
          title="Replace merchandise variants?"
        />
      </section>
    )
  })

CatalogMerchandiseTemplates.displayName = "CatalogMerchandiseTemplates"
