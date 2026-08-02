"use client"

import { memo, type MouseEvent } from "react"
import {
  ArchiveBox,
  GiftSolid,
  ShoppingBag,
  Sparkles,
} from "@medusajs/icons"
import { Container, Text } from "@medusajs/ui"

import { AdminSectionHeader } from "../../components/admin-page"
import {
  catalogCreationKindDescriptions,
  catalogCreationKindLabels,
  catalogCreationKinds,
  type CatalogCreationKind,
} from "./catalog-product-create-form"

const kindIcons = {
  music_release: ArchiveBox,
  merch: ShoppingBag,
  fixed_bundle: GiftSolid,
  mystery_bundle: Sparkles,
} satisfies Record<CatalogCreationKind, typeof ArchiveBox>

type CatalogCreationKindStepProps = {
  kind: CatalogCreationKind
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void
}

export const CatalogCreationKindStep = memo<CatalogCreationKindStepProps>(
  ({ kind: selectedKind, onSelect }) => (
    <Container className="p-6">
      <AdminSectionHeader
        description="Choose the closest match. This controls the questions, inventory behavior, and bundle rules that follow."
        title="What are you selling?"
      />
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {catalogCreationKinds.map((kind) => {
          const Icon = kindIcons[kind]
          const selected = selectedKind === kind
          return (
            <button
              aria-pressed={selected}
              className={`min-h-32 cursor-pointer rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-border-interactive ${
                selected
                  ? "border-ui-border-interactive bg-ui-bg-highlight"
                  : "border-ui-border-base bg-ui-bg-base hover:bg-ui-bg-subtle"
              }`}
              data-kind={kind}
              key={kind}
              onClick={onSelect}
              type="button"
            >
              <Icon className="h-5 w-5 text-ui-fg-interactive" />
              <Text className="mt-3" weight="plus">
                {catalogCreationKindLabels[kind]}
              </Text>
              <Text className="mt-1 text-ui-fg-subtle" size="small">
                {catalogCreationKindDescriptions[kind]}
              </Text>
            </button>
          )
        })}
      </div>
    </Container>
  ),
)

CatalogCreationKindStep.displayName = "CatalogCreationKindStep"
