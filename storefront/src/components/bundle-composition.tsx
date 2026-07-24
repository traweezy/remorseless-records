"use client"

import { Badge, type BadgeProps } from "@/components/ui/badge"
import { Card, cardVariants } from "@/components/ui/card"
import { useProductVariantSelection } from "@/components/providers/product-variant-selection-provider"
import SmartLink from "@/components/ui/smart-link"
import { buildPublicProductPath } from "@/lib/products/routes"
import {
  buildBundleItemPresentation,
  hasUnavailableBundleComponents,
  type BundleItemAvailabilityStatus,
} from "@/lib/products/bundle-availability"
import { cn } from "@/lib/ui/cn"
import type { BundleComposition as BundleCompositionData } from "@/types/bundle"

type BundleCompositionProps = {
  bundle: BundleCompositionData
}

const itemStatuses: Record<
  BundleItemAvailabilityStatus,
  { label: string; variant: BadgeProps["variant"] }
> = {
  in_stock: {
    label: "In stock",
    variant: "success",
  },
  sold_out: {
    label: "Sold out",
    variant: "danger",
  },
  unknown: {
    label: "Availability unknown",
    variant: "default",
  },
}

const BundleComposition = ({ bundle }: BundleCompositionProps) => {
  const variantSelection = useProductVariantSelection()
  const selectedVariantId = variantSelection?.selectedVariantId ?? null
  const hasUnavailableComponents = hasUnavailableBundleComponents(
    bundle,
    selectedVariantId
  )

  return (
    <section
      className={cn(cardVariants({ variant: "panel" }), "space-y-4 p-6")}
      aria-labelledby="bundle-composition-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2
            id="bundle-composition-heading"
            className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground"
          >
            Bundle contents
          </h2>
          <p className="text-sm text-muted-foreground">
            {bundle.componentCount} included item
            {bundle.componentCount === 1 ? "" : "s"}; contents stay fixed even
            when stock changes.
          </p>
        </div>
        {hasUnavailableComponents ? (
          <Badge
            variant="warning"
            className="px-3 py-1 text-[0.65rem] tracking-[0.22rem]"
            role="status"
            aria-live="polite"
          >
            Includes sold-out items
          </Badge>
        ) : null}
      </div>

      <ol className="space-y-3">
        {bundle.components.map((item) => {
          const presentation = buildBundleItemPresentation(
            item,
            selectedVariantId
          )
          const status = itemStatuses[presentation.status]
          const content = (
            <span className="min-w-0">
              <span className="block font-headline text-sm uppercase tracking-[0.2rem] text-foreground">
                {item.quantity > 1 ? `${item.quantity}× ` : ""}
                {item.title}
              </span>
              {presentation.formatLabel ? (
                <span className="mt-1 block text-xs uppercase tracking-[0.2rem] text-muted-foreground">
                  {presentation.formatLabel}
                </span>
              ) : null}
            </span>
          )
          return (
            <li key={item.id}>
              <Card
                variant="subtle"
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                {item.product.handle ? (
                  <SmartLink
                    href={buildPublicProductPath({
                      handle: item.product.handle,
                    })}
                    className="min-w-0 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
                  >
                    {content}
                  </SmartLink>
                ) : (
                  content
                )}
                <Badge
                  variant={status.variant}
                  className="px-2.5 py-1 tracking-[0.22rem]"
                >
                  {status.label}
                </Badge>
              </Card>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export default BundleComposition
