"use client"

import { memo } from "react"
import { Button, Text } from "@medusajs/ui"

export const catalogCreationSteps = [
  "Kind",
  "Basics",
  "Offerings",
  "Details",
  "Review",
] as const

export const CatalogCreationProgress = memo<{ current: number }>(
  ({ current }) => (
    <ol
      aria-label="Product creation progress"
      className="grid grid-cols-2 gap-2 sm:grid-cols-5"
    >
      {catalogCreationSteps.map((step, index) => (
        <li
          aria-current={current === index ? "step" : undefined}
          className={`rounded-md border px-3 py-2 ${
            current === index
              ? "border-ui-border-interactive bg-ui-bg-highlight text-ui-fg-base"
              : index < current
                ? "border-ui-border-base bg-ui-bg-subtle text-ui-fg-base"
                : "border-ui-border-base text-ui-fg-subtle"
          }`}
          key={step}
        >
          <Text size="xsmall" weight="plus">
            {index + 1}. {step}
          </Text>
        </li>
      ))}
    </ol>
  ),
)

CatalogCreationProgress.displayName = "CatalogCreationProgress"

type CatalogCreationActionsProps = {
  busy: boolean
  currentStep: number
  onBack: () => void
  onCancel: () => void
  onNext: () => void
  onSave: () => void
}

const primaryActionClassName =
  "hover:!bg-ui-button-inverted active:!bg-ui-button-inverted"

export const CatalogCreationActions = memo<CatalogCreationActionsProps>(
  ({ busy, currentStep, onBack, onCancel, onNext, onSave }) => (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-ui-border-base bg-ui-bg-base px-1 py-4">
      <Button
        disabled={busy}
        onClick={onCancel}
        type="button"
        variant="secondary"
      >
        Cancel
      </Button>
      <div className="flex flex-wrap gap-2">
        {currentStep > 0 ? (
          <Button
            disabled={busy}
            onClick={onBack}
            type="button"
            variant="secondary"
          >
            Back
          </Button>
        ) : null}
        {currentStep < catalogCreationSteps.length - 1 ? (
          <Button
            className={primaryActionClassName}
            disabled={busy}
            onClick={onNext}
            type="button"
          >
            Continue
          </Button>
        ) : (
          <Button
            className={primaryActionClassName}
            disabled={busy}
            isLoading={busy}
            onClick={onSave}
            type="button"
          >
            Create draft
          </Button>
        )}
      </div>
      <div aria-live="polite" className="sr-only">
        {busy ? "Creating draft product" : ""}
      </div>
    </div>
  ),
)

CatalogCreationActions.displayName = "CatalogCreationActions"
