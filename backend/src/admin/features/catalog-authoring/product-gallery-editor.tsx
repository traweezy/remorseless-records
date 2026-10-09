"use client"

import { memo, useCallback, useEffect, useRef, useState } from "react"
import { ArrowDownMini, ArrowUpMini } from "@medusajs/icons"
import { Alert, Badge, Button, Heading, Text } from "@medusajs/ui"

import {
  catalogAdminActions,
  nativeAdminActions,
} from "../../../lib/admin-permissions"
import { AdminPermissionBoundary } from "../../components/admin-permission-boundary"
import { useAdminPermissions } from "../../lib/admin-permissions"
import {
  beginGallery,
  clearConfirmedGallery,
  galleryStorageKey,
  restoreGallery,
  retryGallery,
  scheduleGalleryRestore,
  type SavedGallery,
} from "./product-gallery-command-state"
import {
  fetchProductGallery,
  galleryPreflight,
  makeGalleryPrimary,
  moveGalleryLink,
  orderGalleryLinks,
  type GalleryLink,
  type ProductGallery,
} from "./product-gallery-query"

export const productGalleryReadActions = [
  catalogAdminActions.authoring.read,
  nativeAdminActions.product.read,
] as const
export const productGalleryWriteActions = [
  catalogAdminActions.authoring.update,
  nativeAdminActions.product.read,
  nativeAdminActions.productVariant.read,
] as const

type GalleryVariant = { id: string; title?: string | null | undefined }
export type ProductGalleryEditorProps = {
  productId: string
  profileId: string | null | undefined
  variants: readonly GalleryVariant[]
  disabled?: boolean
}

export const ProductGalleryRows = memo<{
  media: readonly GalleryLink[]
  variants: readonly GalleryVariant[]
  disabled: boolean
  onPrimary: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
}>(({ media, variants, disabled, onPrimary, onMove }) => {
  const ordered = orderGalleryLinks(media)
  const scopes = [...new Set(ordered.map((item) => item.variantId))]
  if (!ordered.length)
    return <Text size="small">This product has no managed gallery images.</Text>
  return (
    <div className="space-y-5">
      {scopes.map((scope) => {
        const group = ordered.filter((item) => item.variantId === scope)
        const primaryCount = group.filter(
          (item) => item.isPrimary || item.role === "primary"
        ).length
        const variant = variants.find((item) => item.id === scope)
        return (
          <section
            className="min-w-0 space-y-3"
            key={
              scope === null ? "product-gallery" : `variant-gallery:${scope}`
            }
            aria-label={
              scope
                ? `Variant gallery ${variant?.title ?? scope}`
                : "Product gallery"
            }
          >
            <h4 className="text-sm font-medium text-ui-fg-base">
              {scope ? `Variant: ${variant?.title ?? scope}` : "Product images"}
            </h4>
            <ol className="space-y-3">
              {group.map((item, index) => (
                <li
                  className="min-w-0 rounded-lg border border-ui-border-base p-4"
                  key={item.id}
                >
                  <div className="grid min-w-0 gap-4 sm:grid-cols-[6rem_minmax(0,1fr)]">
                    <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-md border border-ui-border-base bg-ui-bg-subtle">
                      {item.asset ? (
                        <img
                          alt=""
                          aria-hidden="true"
                          className="h-full w-full object-contain"
                          height={96}
                          width={96}
                          loading="lazy"
                          src={item.asset.sourceUrl}
                        />
                      ) : (
                        <Text size="xsmall">File unavailable</Text>
                      )}
                    </div>
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Text weight="plus">Image {index + 1}</Text>
                        {item.isPrimary ? (
                          <Badge color="blue">Primary</Badge>
                        ) : null}
                        {item.asset?.lifecycleStatus !== "active" ? (
                          <Badge color="orange">Unavailable</Badge>
                        ) : null}
                      </div>
                      <Text
                        className="break-all text-ui-fg-subtle"
                        size="small"
                      >
                        {item.asset?.originalFilename ?? item.mediaAssetId}
                      </Text>
                      <Text
                        className="break-words text-ui-fg-subtle"
                        size="small"
                      >
                        {item.asset?.altText ||
                          "No alt text is recorded for this file."}
                      </Text>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          aria-label={`Make image ${index + 1} primary in ${scope ? (variant?.title ?? scope) : "product gallery"}`}
                          disabled={
                            disabled ||
                            (item.isPrimary && primaryCount === 1) ||
                            item.asset?.lifecycleStatus !== "active"
                          }
                          onClick={() => onPrimary(item.id)}
                          size="small"
                          type="button"
                          variant="secondary"
                        >
                          Make primary
                        </Button>
                        <Button
                          aria-label={`Move image ${index + 1} earlier in ${scope ? (variant?.title ?? scope) : "product gallery"}`}
                          disabled={disabled || index === 0}
                          onClick={() => onMove(item.id, -1)}
                          size="small"
                          type="button"
                          variant="secondary"
                        >
                          <ArrowUpMini aria-hidden="true" />
                          Earlier
                        </Button>
                        <Button
                          aria-label={`Move image ${index + 1} later in ${scope ? (variant?.title ?? scope) : "product gallery"}`}
                          disabled={disabled || index === group.length - 1}
                          onClick={() => onMove(item.id, 1)}
                          size="small"
                          type="button"
                          variant="secondary"
                        >
                          <ArrowDownMini aria-hidden="true" />
                          Later
                        </Button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )
      })}
    </div>
  )
})
ProductGalleryRows.displayName = "ProductGalleryRows"

export const ProductGalleryFeedback = memo<{
  error: string | null
  record: SavedGallery | null
  preflight: string | null
}>(({ error, record, preflight }) => (
  <>
    {error ? (
      <Alert role="alert" variant="error">
        {error}
      </Alert>
    ) : null}
    {record ? (
      <Alert
        role={record.status === "confirmed" ? "status" : "alert"}
        variant={record.status === "confirmed" ? "success" : "warning"}
      >
        <Text size="small">
          {record.status === "confirmed"
            ? "Gallery saved and its current images confirmed."
            : "The saved request needs confirmation. Keep this request and retry it using the same administrator. Its version and images will stay unchanged."}
        </Text>
        <details className="mt-2 min-w-0">
          <summary className="cursor-pointer py-2">
            Saved gallery request
          </summary>
          <Text className="break-all" size="xsmall">
            {record.body.idempotencyKey}
          </Text>
          <Text size="xsmall">
            Gallery version {record.body.expectedVersion} →{" "}
            {record.body.expectedVersion + 1}; {record.body.media.length} images
          </Text>
        </details>
      </Alert>
    ) : null}
    {!record && preflight ? (
      <Alert role="alert" variant="warning">
        {preflight}
      </Alert>
    ) : null}
  </>
))
ProductGalleryFeedback.displayName = "ProductGalleryFeedback"

const message = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : "The gallery request could not be verified. Keep its saved request."

const ProductGalleryEditorContent = memo<ProductGalleryEditorProps>(
  ({ productId, profileId, variants, disabled = false }) => {
    const permissions = useAdminPermissions()
    const canWrite =
      !permissions.isPending &&
      !permissions.error &&
      productGalleryWriteActions.every(permissions.hasPermission)
    const [gallery, setGallery] = useState<ProductGallery | null>(null)
    const [draft, setDraft] = useState<GalleryLink[]>([])
    const [record, setRecord] = useState<SavedGallery | null>(null)
    const [ready, setReady] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const epoch = useRef(0)
    const mounted = useRef(true)
    const backendOrigin =
      typeof window === "undefined" ? "" : window.location.origin
    const current = useCallback(
      (version: number) => mounted.current && epoch.current === version,
      []
    )
    const boundary = useCallback(
      (version: number) => ({
        storage: window.localStorage,
        locks: navigator.locks,
        isCurrent: () => current(version),
      }),
      [current]
    )

    const load = useCallback(async () => {
      const version = ++epoch.current
      setReady(false)
      setBusy(true)
      setError(null)
      try {
        const saved = await restoreGallery(
          { productId, backendOrigin },
          boundary(version)
        )
        const snapshot = await fetchProductGallery(productId, boundary(version))
        if (!current(version)) return
        setRecord(saved)
        setGallery(snapshot)
        setDraft(snapshot.media)
        setReady(true)
      } catch (failure) {
        if (current(version)) setError(message(failure))
      } finally {
        if (current(version)) setBusy(false)
      }
    }, [backendOrigin, boundary, current, productId])

    useEffect(() => {
      mounted.current = true
      const version = ++epoch.current
      void scheduleGalleryRestore(() => current(version), load)
      const changed = (event: StorageEvent) => {
        if (
          event.storageArea === window.localStorage &&
          (event.key === galleryStorageKey(productId) || event.key === null)
        )
          void load()
      }
      window.addEventListener("storage", changed)
      return () => {
        mounted.current = false
        ++epoch.current
        window.removeEventListener("storage", changed)
      }
    }, [current, load, productId])

    const perform = useCallback(
      async (kind: "save" | "retry" | "clear") => {
        if (!canWrite || disabled || busy || !ready) return
        const version = ++epoch.current
        setBusy(true)
        setError(null)
        try {
          if (kind === "clear") {
            if (!record) return
            await clearConfirmedGallery(
              record,
              { productId, backendOrigin },
              boundary(version)
            )
            // Fetch only this gallery. The other authoring form drafts stay intact.
            const snapshot = await fetchProductGallery(
              productId,
              boundary(version)
            )
            if (!current(version)) return
            setRecord(null)
            setGallery(snapshot)
            setDraft(snapshot.media)
          } else {
            const result =
              kind === "retry"
                ? record
                  ? await retryGallery(
                      record,
                      { productId, backendOrigin },
                      boundary(version)
                    )
                  : null
                : gallery
                  ? await beginGallery(
                      { productId, backendOrigin },
                      gallery,
                      draft,
                      profileId,
                      variants.map((item) => item.id),
                      boundary(version)
                    )
                  : null
            if (!result || !current(version)) return
            setRecord(result.record)
            if (result.error) setError(message(result.error))
            else if (result.record.projection) {
              setGallery(result.record.projection)
              setDraft(result.record.projection.media)
            }
          }
        } catch (failure) {
          if (current(version)) {
            setReady(false)
            setError(message(failure))
          }
        } finally {
          if (current(version)) setBusy(false)
        }
      },
      [
        backendOrigin,
        boundary,
        busy,
        canWrite,
        current,
        disabled,
        draft,
        gallery,
        productId,
        profileId,
        ready,
        record,
        variants,
      ]
    )

    const preflight = galleryPreflight(
      draft,
      profileId,
      variants.map((item) => item.id)
    )
    const editingDisabled =
      disabled || busy || !ready || !canWrite || record !== null
    return (
      <section
        className="scroll-mt-24 space-y-4 outline-none"
        id="product-authoring-gallery"
        tabIndex={-1}
        aria-busy={busy}
      >
        <Heading level="h3">Gallery</Heading>
        <Text className="text-ui-fg-subtle" size="small">
          Choose primary artwork and order the existing images for this product
          and its variants. Save gallery also synchronizes their Medusa
          thumbnails. Gallery saves are separate from the other product fields.
        </Text>
        <ProductGalleryFeedback
          error={error}
          record={record}
          preflight={gallery ? preflight : null}
        />
        {!canWrite && !permissions.isPending ? (
          <Text size="small">
            Your role can view these images but cannot save gallery changes.
          </Text>
        ) : null}
        {gallery ? (
          <ProductGalleryRows
            disabled={editingDisabled}
            media={draft}
            onMove={(id, direction) =>
              setDraft((value) => moveGalleryLink(value, id, direction))
            }
            onPrimary={(id) =>
              setDraft((value) => makeGalleryPrimary(value, id))
            }
            variants={variants}
          />
        ) : (
          <Text size="small">
            {busy
              ? "Loading gallery…"
              : "Refresh the gallery to load its current images."}
          </Text>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={disabled || busy}
            onClick={() => void load()}
            size="small"
            type="button"
            variant="secondary"
          >
            Refresh gallery
          </Button>
          {canWrite ? (
            record ? (
              <>
                <Button
                  disabled={disabled || busy || !ready}
                  onClick={() => void perform("retry")}
                  size="small"
                  type="button"
                  variant="secondary"
                >
                  {record.status === "confirmed"
                    ? "Verify saved request again"
                    : "Retry saved gallery request"}
                </Button>
                {record.status === "confirmed" ? (
                  <Button
                    disabled={disabled || busy || !ready}
                    onClick={() => void perform("clear")}
                    size="small"
                    type="button"
                  >
                    Edit gallery again
                  </Button>
                ) : null}
              </>
            ) : (
              <Button
                disabled={
                  disabled || busy || !ready || !gallery || Boolean(preflight)
                }
                isLoading={busy}
                onClick={() => void perform("save")}
                size="small"
                type="button"
              >
                Save gallery
              </Button>
            )
          ) : null}
        </div>
      </section>
    )
  }
)
ProductGalleryEditorContent.displayName = "ProductGalleryEditorContent"

export const ProductGalleryEditor = memo<ProductGalleryEditorProps>((props) => (
  <AdminPermissionBoundary
    actions={productGalleryReadActions}
    surface="widget"
    workspace="Product Gallery"
  >
    <ProductGalleryEditorContent key={props.productId} {...props} />
  </AdminPermissionBoundary>
))
ProductGalleryEditor.displayName = "ProductGalleryEditor"
