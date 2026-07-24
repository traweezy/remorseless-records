import { Badge, type BadgeProps } from "@/components/ui/badge"
import { Card, cardVariants } from "@/components/ui/card"
import SmartLink from "@/components/ui/smart-link"
import { buildPublicProductPath } from "@/lib/products/routes"
import { cn } from "@/lib/ui/cn"
import type {
  BundleComposition as BundleCompositionData,
  BundleCompositionItem,
} from "@/types/bundle"

type BundleCompositionProps = {
  bundle: BundleCompositionData
}

const resolveItemStatus = (
  item: BundleCompositionItem
): { label: string; variant: BadgeProps["variant"] } => {
  const mappings = item.availabilityByBundleVariant
  if (mappings.length && mappings.every((mapping) => !mapping.available)) {
    return {
      label: "Sold out",
      variant: "danger",
    }
  }
  if (mappings.some((mapping) => !mapping.available)) {
    return {
      label: "Some formats sold out",
      variant: "warning",
    }
  }
  return {
    label: "In stock",
    variant: "success",
  }
}

export const buildBundleAvailabilityNotices = (
  bundle: BundleCompositionData
): Record<string, string> => {
  const unavailableNamesByVariantId = new Map<string, string[]>()
  bundle.components.forEach((component) => {
    component.availabilityByBundleVariant.forEach((mapping) => {
      if (mapping.available) {
        return
      }
      mapping.bundleVariantIds.forEach((variantId) => {
        const names = unavailableNamesByVariantId.get(variantId) ?? []
        names.push(component.title)
        unavailableNamesByVariantId.set(variantId, names)
      })
    })
  })

  return Object.fromEntries(
    Array.from(unavailableNamesByVariantId, ([variantId, names]) => [
      variantId,
      `${names.length} included item${names.length === 1 ? " is" : "s are"} sold out: ${names.join(", ")}.`,
    ])
  )
}

const BundleComposition = ({ bundle }: BundleCompositionProps) => (
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
      {bundle.hasUnavailableComponents ? (
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
        const status = resolveItemStatus(item)
        const content = (
          <span className="min-w-0">
            <span className="block font-headline text-sm uppercase tracking-[0.2rem] text-foreground">
              {item.quantity > 1 ? `${item.quantity}× ` : ""}
              {item.title}
            </span>
            {item.availabilityByBundleVariant.length > 1 ? (
              <span className="mt-1 block text-xs text-muted-foreground">
                {item.availabilityByBundleVariant
                  .map(
                    (mapping) =>
                      `${mapping.bundleVariantTitles.join(" / ")}: ${mapping.available ? "in stock" : "sold out"}`
                  )
                  .join(" · ")}
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
                  href={buildPublicProductPath({ handle: item.product.handle })}
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

export default BundleComposition
