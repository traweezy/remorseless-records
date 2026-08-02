"use client"

import { memo, useMemo, type ReactNode } from "react"
import {
  CheckCircleSolid,
  ExclamationCircle,
  Photo,
} from "@medusajs/icons"
import { Badge, Container, Heading, Tabs, Text } from "@medusajs/ui"

import type { CatalogCreationAvailabilityPreview } from "./catalog-creation-availability"
import {
  catalogCreationFormSchema,
  catalogCreationKindLabels,
  resolveCatalogCreationHandle,
  type CatalogCreationFormValues,
} from "./catalog-product-create-form"

type PublicationCheck = {
  id: string
  label: string
  ready: boolean
}

export type CatalogCreationReadiness = {
  draftIssueCount: number
  draftReady: boolean
  publicationChecks: PublicationCheck[]
  publishReady: boolean
}

export const resolveCatalogCreationReadiness = (
  values: CatalogCreationFormValues,
): CatalogCreationReadiness => {
  const validation = catalogCreationFormSchema.safeParse(values)
  const publicationChecks: PublicationCheck[] = [
    {
      id: "image",
      label: "Primary customer image",
      ready: values.media.length > 0,
    },
    {
      id: "description",
      label: "Store description",
      ready: Boolean(values.description.trim()),
    },
    {
      id: "price",
      label: "Non-zero price for every offering",
      ready: values.offerings.every(
        (offering) => Number(offering.priceUsd) > 0,
      ),
    },
  ]
  if (values.kind === "music_release") {
    publicationChecks.push({
      id: "tracklist",
      label: "Customer tracklist",
      ready: Boolean(values.tracklist.trim()),
    })
  }
  if (values.kind === "mystery_bundle") {
    publicationChecks.push({
      id: "mystery-promise",
      label: "Clear mystery-box promise",
      ready: Boolean(values.mysteryPromise.trim()),
    })
  }
  const draftReady = validation.success
  return {
    draftIssueCount: validation.success ? 0 : validation.error.issues.length,
    draftReady,
    publicationChecks,
    publishReady:
      draftReady && publicationChecks.every((check) => check.ready),
  }
}

const formatUsd = (value: string): string => {
  const amount = Number(value)
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("en-US", {
        currency: "USD",
        style: "currency",
      }).format(amount)
    : value
}

const uniqueOfferingLabels = (values: CatalogCreationFormValues): string[] =>
  Array.from(
    new Map(
      values.offerings.map((offering) => [
        offering.title.trim().toLowerCase(),
        offering.title.trim() || "Untitled",
      ]),
    ).values(),
  )

const aggregateAvailability = (
  values: CatalogCreationFormValues,
  availabilityByOfferingId: ReadonlyMap<
    string,
    CatalogCreationAvailabilityPreview
  >,
): CatalogCreationAvailabilityPreview | null => {
  const availability = values.offerings
    .map((offering) => availabilityByOfferingId.get(offering.id))
    .filter(
      (item): item is CatalogCreationAvailabilityPreview => item !== undefined,
    )
  if (!availability.length) {
    return null
  }
  const preferredStatus = [
    "unknown",
    "sold_out",
    "preorder",
    "backorder",
    "low_stock",
    "in_stock",
  ].find((status) => availability.every((item) => item.status === status))
  if (preferredStatus) {
    return availability[0] ?? null
  }
  return (
    availability.find((item) => item.status === "in_stock") ??
    availability.find((item) => item.status === "low_stock") ??
    availability[0] ??
    null
  )
}

const ReadinessPanel = memo<{ values: CatalogCreationFormValues }>(
  ({ values }) => {
    const readiness = useMemo(
      () => resolveCatalogCreationReadiness(values),
      [values],
    )
    const missingPublicationDetails = readiness.publicationChecks.filter(
      (check) => !check.ready,
    ).length
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <div
          className={`rounded-lg border p-4 ${
            readiness.draftReady
              ? "border-ui-border-interactive bg-ui-bg-highlight"
              : "border-ui-border-error bg-ui-bg-subtle"
          }`}
        >
          <div className="flex items-start gap-3">
            {readiness.draftReady ? (
              <CheckCircleSolid
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-ui-fg-interactive"
              />
            ) : (
              <ExclamationCircle
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-ui-fg-error"
              />
            )}
            <div>
              <Text size="small" weight="plus">
                {readiness.draftReady
                  ? "Ready to create a draft"
                  : `${readiness.draftIssueCount} required ${readiness.draftIssueCount === 1 ? "detail needs" : "details need"} attention`}
              </Text>
              <Text className="mt-1 text-ui-fg-subtle" size="xsmall">
                Creation writes a Medusa draft only. It never publishes this
                product automatically.
              </Text>
            </div>
          </div>
        </div>
        <div
          className={`rounded-lg border p-4 ${
            readiness.publishReady
              ? "border-ui-border-interactive bg-ui-bg-highlight"
              : "border-ui-border-base bg-ui-bg-subtle"
          }`}
        >
          <div className="flex items-start gap-3">
            {readiness.publishReady ? (
              <CheckCircleSolid
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-ui-fg-interactive"
              />
            ) : (
              <ExclamationCircle
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-ui-fg-subtle"
              />
            )}
            <div className="min-w-0 flex-1">
              <Text size="small" weight="plus">
                {readiness.publishReady
                  ? "Customer content is publication-ready"
                  : `${missingPublicationDetails} customer ${missingPublicationDetails === 1 ? "detail" : "details"} recommended before publishing`}
              </Text>
              <ul className="mt-2 grid gap-1">
                {readiness.publicationChecks.map((check) => (
                  <li className="flex items-center gap-2" key={check.id}>
                    <span
                      aria-hidden="true"
                      className={
                        check.ready
                          ? "text-ui-fg-interactive"
                          : "text-ui-fg-subtle"
                      }
                    >
                      {check.ready ? "✓" : "○"}
                    </span>
                    <Text size="xsmall">{check.label}</Text>
                  </li>
                ))}
              </ul>
              <Text className="mt-2 text-ui-fg-subtle" size="xsmall">
                Exact stock is intentionally not a requirement; a sold-out
                product can still be published deliberately.
              </Text>
            </div>
          </div>
        </div>
      </div>
    )
  },
)

ReadinessPanel.displayName = "ReadinessPanel"

const CatalogCardPreview = memo<{
  availabilityByOfferingId: ReadonlyMap<
    string,
    CatalogCreationAvailabilityPreview
  >
  values: CatalogCreationFormValues
}>(({ availabilityByOfferingId, values }) => {
  const aggregate = aggregateAvailability(values, availabilityByOfferingId)
  const formats = uniqueOfferingLabels(values)
  const isBundle =
    values.kind === "fixed_bundle" || values.kind === "mystery_bundle"
  return (
    <div className="mx-auto w-full max-w-sm py-2">
      <article
        aria-label="Non-interactive storefront card preview"
        className="relative overflow-hidden rounded-[1.75rem] border-2 border-ui-border-base bg-ui-bg-base shadow-elevation-card-rest"
      >
        {aggregate && aggregate.status !== "in_stock" ? (
          <Badge
            className="absolute left-4 top-4 z-10"
            color={aggregate.color}
          >
            {aggregate.label}
          </Badge>
        ) : null}
        {isBundle && values.bundleComponents.length ? (
          <Badge className="absolute right-4 top-4 z-10" color="grey">
            {values.bundleComponents.length} items
          </Badge>
        ) : null}
        <div className="aspect-square overflow-hidden bg-ui-bg-subtle">
          {values.media[0] ? (
            <img
              alt={values.media[0].altText}
              className="h-full w-full object-cover"
              height="420"
              src={values.media[0].sourceUrl}
              width="420"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-ui-fg-muted">
              <Photo aria-hidden="true" className="h-8 w-8" />
              <Text size="small">No artwork</Text>
            </div>
          )}
        </div>
        <div className="p-5">
          <Text
            className="truncate uppercase tracking-wider text-ui-fg-subtle"
            size="xsmall"
          >
            {values.kind === "music_release"
              ? values.artistName || "Artist"
              : values.productType || catalogCreationKindLabels[values.kind]}
          </Text>
          <Heading className="mt-2 break-words uppercase" level="h2">
            {values.title || "Untitled product"}
          </Heading>
          <div className="mt-4 flex flex-wrap gap-2">
            {formats.map((format) => (
              <Badge color="grey" key={format}>
                {format.toUpperCase()}
              </Badge>
            ))}
          </div>
        </div>
      </article>
    </div>
  )
})

CatalogCardPreview.displayName = "CatalogCardPreview"

const PreviewSection = memo<{
  children: ReactNode
  title: string
}>(({ children, title }) => (
  <section className="rounded-lg border border-ui-border-base bg-ui-bg-base p-4">
    <Text className="uppercase tracking-wider" size="xsmall" weight="plus">
      {title}
    </Text>
    <div className="mt-3">{children}</div>
  </section>
))

PreviewSection.displayName = "PreviewSection"

const CatalogDetailPreview = memo<{
  availabilityByOfferingId: ReadonlyMap<
    string,
    CatalogCreationAvailabilityPreview
  >
  values: CatalogCreationFormValues
}>(({ availabilityByOfferingId, values }) => {
  const tracklist = values.tracklist
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
  const isMusic = values.kind === "music_release"
  return (
    <div
      aria-label="Non-interactive storefront detail preview"
      className="grid min-w-0 gap-5 py-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
    >
      <div className="min-w-0">
        <div className="aspect-square overflow-hidden rounded-xl border border-ui-border-base bg-ui-bg-subtle">
          {values.media[0] ? (
            <img
              alt={values.media[0].altText}
              className="h-full w-full object-cover"
              height="680"
              src={values.media[0].sourceUrl}
              width="680"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-ui-fg-muted">
              <Photo aria-hidden="true" className="h-10 w-10" />
              <Text>No product image</Text>
            </div>
          )}
        </div>
        {values.media.length > 1 ? (
          <div className="mt-3 grid grid-cols-4 gap-2">
            {values.media.slice(0, 4).map((item) => (
              <img
                alt={item.altText}
                className="aspect-square w-full rounded-md border border-ui-border-base object-cover"
                height="120"
                key={item.id}
                src={item.sourceUrl}
                width="120"
              />
            ))}
          </div>
        ) : null}
      </div>
      <div className="min-w-0 space-y-4">
        <PreviewSection title="Product">
          <Heading className="break-words uppercase" level="h2">
            {values.title || "Untitled product"}
          </Heading>
          {isMusic && values.artistName ? (
            <Text className="mt-1 uppercase tracking-wider">
              {values.artistName}
            </Text>
          ) : null}
          {values.genre ? (
            <Badge className="mt-3" color="grey">
              {values.genre}
            </Badge>
          ) : null}
          <div className="mt-4 grid gap-2">
            {values.offerings.map((offering, index) => {
              const availability = availabilityByOfferingId.get(offering.id)
              return (
                <div
                  className={`flex min-w-0 items-center justify-between gap-3 rounded-md border p-3 ${
                    index === 0
                      ? "border-ui-border-interactive bg-ui-bg-highlight"
                      : "border-ui-border-base"
                  }`}
                  key={offering.id}
                >
                  <div className="min-w-0">
                    <Text className="break-words" size="small" weight="plus">
                      {offering.title || "Untitled offering"}
                    </Text>
                    {availability ? (
                      <Text className="text-ui-fg-subtle" size="xsmall">
                        {availability.label}
                      </Text>
                    ) : null}
                  </div>
                  <Text className="shrink-0" size="small" weight="plus">
                    {formatUsd(offering.priceUsd)}
                  </Text>
                </div>
              )
            })}
          </div>
        </PreviewSection>
        <PreviewSection title="Description">
          <Text className="whitespace-pre-line text-ui-fg-subtle" size="small">
            {values.description ||
              "Add a store description before publishing so customers know what they are buying."}
          </Text>
        </PreviewSection>
        {tracklist.length ? (
          <PreviewSection title="Tracklist">
            <ol className="grid gap-2">
              {tracklist.map((entry, index) => (
                <li className="flex gap-3" key={`${index}-${entry}`}>
                  <Text className="text-ui-fg-base" size="xsmall">
                    {(index + 1).toString().padStart(2, "0")}
                  </Text>
                  <Text size="small">{entry}</Text>
                </li>
              ))}
            </ol>
          </PreviewSection>
        ) : null}
        {values.kind === "fixed_bundle" ? (
          <PreviewSection title="Bundle contents">
            <Text size="small">
              {values.bundleComponents.length} included{" "}
              {values.bundleComponents.length === 1 ? "product" : "products"};
              content changes with the selected bundle format.
            </Text>
          </PreviewSection>
        ) : null}
        {values.kind === "merch" &&
        (values.material ||
          values.merchandiseFit ||
          values.sizeGuide ||
          values.merchandiseCare) ? (
          <PreviewSection title="Product details">
            <div className="grid gap-2 text-ui-fg-subtle">
              {values.material ? <Text size="small">{values.material}</Text> : null}
              {values.merchandiseFit ? <Text size="small">{values.merchandiseFit}</Text> : null}
              {values.sizeGuide ? <Text size="small">{values.sizeGuide}</Text> : null}
              {values.merchandiseCare ? <Text size="small">{values.merchandiseCare}</Text> : null}
            </div>
          </PreviewSection>
        ) : null}
        {values.kind === "mystery_bundle" && values.mysteryPromise ? (
          <PreviewSection title="What to expect">
            <Text className="whitespace-pre-line" size="small">
              {values.mysteryPromise}
            </Text>
            {values.mysteryDisclaimer ? (
              <Text className="mt-2 text-ui-fg-subtle" size="xsmall">
                {values.mysteryDisclaimer}
              </Text>
            ) : null}
          </PreviewSection>
        ) : null}
      </div>
    </div>
  )
})

CatalogDetailPreview.displayName = "CatalogDetailPreview"

export const CatalogCreationReview = memo<{
  availabilityByOfferingId: ReadonlyMap<
    string,
    CatalogCreationAvailabilityPreview
  >
  values: CatalogCreationFormValues
}>(({ availabilityByOfferingId, values }) => {
  const previewRoute =
    values.kind === "music_release"
      ? "music-release"
      : values.kind === "merch"
        ? "merch"
        : "bundle"
  const previewUrl = `/${previewRoute}/${resolveCatalogCreationHandle(values.handle, values.title)}`
  return (
    <div className="flex flex-col gap-4">
      <Container className="p-6">
        <Heading level="h2">Creation readiness</Heading>
        <Text className="mt-1 text-ui-fg-subtle" size="small">
          Required draft validation and recommended publication content are
          intentionally evaluated separately.
        </Text>
        <div className="mt-4">
          <ReadinessPanel values={values} />
        </div>
      </Container>
      <Container className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Heading level="h2">Customer preview</Heading>
            <Text className="mt-1 text-ui-fg-subtle" size="small">
              A non-interactive preview of the catalog card and detail-page
              hierarchy. Final storefront fonts and live stock load after
              publication.
            </Text>
          </div>
          <Text className="break-all text-ui-fg-subtle" size="xsmall">
            {previewUrl}
          </Text>
        </div>
        <Tabs className="mt-5" defaultValue="card">
          <Tabs.List>
            <Tabs.Trigger value="card">Catalog card</Tabs.Trigger>
            <Tabs.Trigger value="detail">Product detail</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="card">
            <CatalogCardPreview
              availabilityByOfferingId={availabilityByOfferingId}
              values={values}
            />
          </Tabs.Content>
          <Tabs.Content value="detail">
            <CatalogDetailPreview
              availabilityByOfferingId={availabilityByOfferingId}
              values={values}
            />
          </Tabs.Content>
        </Tabs>
      </Container>
    </div>
  )
})

CatalogCreationReview.displayName = "CatalogCreationReview"
