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
): { label: string; className: string } => {
  const mappings = item.availabilityByBundleVariant
  if (mappings.length && mappings.every((mapping) => !mapping.available)) {
    return {
      label: "Sold out",
      className: "border-destructive/70 bg-destructive/20 text-destructive",
    }
  }
  if (mappings.some((mapping) => !mapping.available)) {
    return {
      label: "Some formats sold out",
      className: "border-amber-400/70 bg-amber-500/15 text-amber-200",
    }
  }
  return {
    label: "In stock",
    className: "border-emerald-400/60 bg-emerald-500/15 text-emerald-200",
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
    className="space-y-4 rounded-3xl border border-border/70 bg-surface/90 p-6"
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
        <span
          className="rounded-full border border-amber-400/70 bg-amber-500/15 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.22rem] text-amber-200"
          role="status"
          aria-live="polite"
        >
          Includes sold-out items
        </span>
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
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/65 p-4"
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
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-[0.6rem] uppercase tracking-[0.22rem]",
                status.className
              )}
            >
              {status.label}
            </span>
          </li>
        )
      })}
    </ol>
  </section>
)

export default BundleComposition
