"use client"

import { useQuery } from "@tanstack/react-query"
import { memo } from "react"

import BundleAvailabilityBadge from "@/components/bundle-availability-badge"
import { Badge } from "@/components/ui/badge"
import SmartLink from "@/components/ui/smart-link"
import {
  buildBundleItemPresentation,
  hasUnavailableBundleComponents,
} from "@/lib/products/bundle-availability"
import { getCartBundleComposition } from "@/lib/cart/bundle-client"
import { buildPublicProductPath } from "@/lib/products/routes"

type CartBundleDetailsProps = {
  handle: string
  selectedVariantId: string | null
}

const CartBundleDetails = memo<CartBundleDetailsProps>(
  ({ handle, selectedVariantId }) => {
    const bundleQuery = useQuery({
      queryKey: ["cart", "bundle", handle],
      queryFn: ({ signal }) => getCartBundleComposition(handle, signal),
      staleTime: 60_000,
      meta: { persist: false },
    })
    const bundle = bundleQuery.data

    if (bundleQuery.isPending) {
      return (
        <p
          className="border-t border-border/50 pt-3 text-xs text-muted-foreground"
          role="status"
        >
          Loading bundle contents…
        </p>
      )
    }
    if (!bundle) {
      return null
    }

    const hasUnavailable = hasUnavailableBundleComponents(
      bundle,
      selectedVariantId
    )

    return (
      <section
        className="space-y-2.5 border-t border-border/50 pt-3"
        aria-label="Bundle contents"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18rem] text-muted-foreground">
            Includes {bundle.componentCount} item
            {bundle.componentCount === 1 ? "" : "s"}
          </p>
          {hasUnavailable ? (
            <Badge variant="warning" className="px-2 py-0.5 text-[0.6rem]">
              Includes sold-out item
            </Badge>
          ) : null}
        </div>
        <ul className="space-y-2">
          {bundle.components.map((component) => {
            const presentation = buildBundleItemPresentation(
              component,
              selectedVariantId
            )
            const title = component.title
            const content = (
              <>
                <span className="min-w-0">
                  <span className="block break-words text-xs text-foreground">
                    {component.quantity > 1 ? `${component.quantity}× ` : ""}
                    {title}
                  </span>
                  {presentation.formatLabel ? (
                    <span className="mt-0.5 block text-[0.65rem] uppercase tracking-[0.12rem] text-muted-foreground">
                      {presentation.formatLabel}
                    </span>
                  ) : null}
                </span>
                <BundleAvailabilityBadge
                  status={presentation.status}
                  compact
                  className="shrink-0"
                />
              </>
            )

            return (
              <li key={component.id}>
                {component.product.handle ? (
                  <SmartLink
                    href={buildPublicProductPath({
                      handle: component.product.handle,
                    })}
                    nativePrefetch
                    className="flex min-h-6 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-sm hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {content}
                  </SmartLink>
                ) : (
                  <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    {content}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </section>
    )
  }
)
CartBundleDetails.displayName = "CartBundleDetails"

export default CartBundleDetails
