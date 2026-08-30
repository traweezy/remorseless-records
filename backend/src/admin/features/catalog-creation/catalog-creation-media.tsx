"use client"

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent,
} from "react"
import { ArrowDownMini, ArrowUpMini, Photo, Trash } from "@medusajs/icons"
import { Badge, Button, Input, Text } from "@medusajs/ui"

import { AdminFormField } from "../../components/admin-form-field"
import {
  MAX_CATALOG_MEDIA_ALT_TEXT_LENGTH,
  MAX_CATALOG_PRODUCT_MEDIA_ITEMS,
} from "../../../lib/catalog/product-media-constraints"
import {
  MANAGED_IMAGE_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_TOTAL_BYTES,
} from "../../../lib/uploads/constraints"
import {
  uploadCatalogCreationMedia,
  type CatalogCreationUploadedFile,
} from "./catalog-creation-media-query"
import type { CatalogCreationMedia } from "./catalog-product-create-form"

const supportedImageTypes = new Set<string>(MANAGED_IMAGE_MIME_TYPES)

type CatalogCreationMediaProps = {
  media: CatalogCreationMedia[]
  onChange: (media: CatalogCreationMedia[]) => void
  onUploadingChange: (uploading: boolean) => void
}

type MediaRowProps = {
  count: number
  index: number
  item: CatalogCreationMedia
  onAltTextChange: (event: ChangeEvent<HTMLInputElement>) => void
  onMove: (event: MouseEvent<HTMLButtonElement>) => void
  onRemove: (event: MouseEvent<HTMLButtonElement>) => void
}

type MediaButtonTarget = {
  dataset?: Record<string, string | undefined>
}

const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
    : `${Math.ceil(bytes / 1024)} KiB`

const validateUploadSelection = (
  files: File[],
  existingCount: number
): string | null => {
  if (!files.length) {
    return null
  }
  if (files.length > MAX_UPLOAD_FILES) {
    return `Choose no more than ${MAX_UPLOAD_FILES} images at once.`
  }
  if (existingCount + files.length > MAX_CATALOG_PRODUCT_MEDIA_ITEMS) {
    return `A product can have no more than ${MAX_CATALOG_PRODUCT_MEDIA_ITEMS} images.`
  }
  if (files.some((file) => !supportedImageTypes.has(file.type))) {
    return "Choose only JPEG, PNG, WebP, or GIF images."
  }
  if (files.some((file) => file.size <= 0)) {
    return "Empty images cannot be uploaded."
  }
  if (files.some((file) => file.size > MAX_UPLOAD_BYTES)) {
    return "Each image must be 12 MiB or smaller."
  }
  if (
    files.reduce((total, file) => total + file.size, 0) > MAX_UPLOAD_TOTAL_BYTES
  ) {
    return "The selected images must total 20 MiB or less."
  }
  return null
}

const toDraftMedia = (
  uploaded: CatalogCreationUploadedFile
): CatalogCreationMedia => ({
  altText: "",
  byteSize: uploaded.size,
  id: crypto.randomUUID(),
  mediaAssetId: uploaded.mediaAssetId,
  mimeType: uploaded.mimeType,
  originalFilename: uploaded.filename,
  sourceFileKey: uploaded.id,
  sourceUrl: uploaded.url,
})

const CatalogCreationMediaRow = memo<MediaRowProps>(
  ({ count, index, item, onAltTextChange, onMove, onRemove }) => {
    const missingAltText = !item.altText.trim()
    return (
      <li className="rounded-lg border border-ui-border-base p-4">
        <div className="grid gap-4 sm:grid-cols-[6rem_minmax(0,1fr)]">
          <div className="relative h-24 w-24 overflow-hidden rounded-md border border-ui-border-base bg-ui-bg-subtle">
            <img
              alt=""
              aria-hidden="true"
              className="h-full w-full object-cover"
              height="96"
              loading="lazy"
              src={item.sourceUrl}
              width="96"
            />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Text weight="plus">Image {index + 1}</Text>
                  {index === 0 ? <Badge color="blue">Primary</Badge> : null}
                </div>
                <Text className="break-all text-ui-fg-subtle" size="xsmall">
                  {item.originalFilename} · {formatBytes(item.byteSize)}
                </Text>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  aria-label={`Move image ${index + 1} earlier`}
                  data-direction="up"
                  data-media-id={item.id}
                  disabled={index === 0}
                  onClick={onMove}
                  size="small"
                  type="button"
                  variant="secondary"
                >
                  <ArrowUpMini aria-hidden="true" />
                  Earlier
                </Button>
                <Button
                  aria-label={`Move image ${index + 1} later`}
                  data-direction="down"
                  data-media-id={item.id}
                  disabled={index === count - 1}
                  onClick={onMove}
                  size="small"
                  type="button"
                  variant="secondary"
                >
                  <ArrowDownMini aria-hidden="true" />
                  Later
                </Button>
                <Button
                  aria-label={`Remove image ${index + 1}`}
                  data-media-id={item.id}
                  onClick={onRemove}
                  size="small"
                  type="button"
                  variant="secondary"
                >
                  <Trash aria-hidden="true" />
                  Remove
                </Button>
              </div>
            </div>
            <div className="mt-4">
              <AdminFormField
                error={
                  missingAltText
                    ? "Required before this product can be created."
                    : undefined
                }
                hint="Describe what matters in the image without starting with “image of.”"
                id={`catalog-create-media-alt-${item.id}`}
                label="Alt text"
              >
                {(control) => (
                  <Input
                    {...control}
                    data-media-id={item.id}
                    maxLength={MAX_CATALOG_MEDIA_ALT_TEXT_LENGTH}
                    onChange={onAltTextChange}
                    value={item.altText}
                  />
                )}
              </AdminFormField>
            </div>
          </div>
        </div>
      </li>
    )
  }
)

CatalogCreationMediaRow.displayName = "CatalogCreationMediaRow"

export const CatalogCreationMediaEditor = memo<CatalogCreationMediaProps>(
  ({ media, onChange, onUploadingChange }) => {
    const inputRef = useRef<HTMLInputElement>(null)
    const mediaRef = useRef(media)
    const mountedRef = useRef(true)
    const uploadControllerRef = useRef<AbortController | null>(null)
    const [uploading, setUploading] = useState(false)
    const [message, setMessage] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
      mountedRef.current = true
      return () => {
        mountedRef.current = false
        uploadControllerRef.current?.abort()
      }
    }, [])

    useEffect(() => {
      mediaRef.current = media
    }, [media])

    const handleChooseImages = useCallback(() => {
      ;(inputRef.current as unknown as { click?: () => void } | null)?.click?.()
    }, [])

    const handleUpload = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        const input = event.currentTarget as unknown as {
          files?: ArrayLike<File> | null
          value: string
        }
        const files = Array.from(input.files ?? [])
        input.value = ""
        const validationError = validateUploadSelection(files, media.length)
        if (validationError) {
          setError(validationError)
          setMessage(null)
          return
        }
        if (!files.length) {
          return
        }

        const controller = new AbortController()
        uploadControllerRef.current?.abort()
        uploadControllerRef.current = controller
        setUploading(true)
        onUploadingChange(true)
        setError(null)
        setMessage(null)
        void uploadCatalogCreationMedia(files, { signal: controller.signal })
          .then((uploaded) => {
            if (!mountedRef.current) {
              return
            }
            onChange([...mediaRef.current, ...uploaded.map(toDraftMedia)])
            setMessage(
              `${uploaded.length} ${uploaded.length === 1 ? "image" : "images"} uploaded. Add alt text before continuing.`
            )
          })
          .catch((uploadError: unknown) => {
            if (mountedRef.current && !controller.signal.aborted) {
              setError(
                uploadError instanceof Error
                  ? uploadError.message
                  : "The images could not be uploaded."
              )
            }
          })
          .finally(() => {
            if (uploadControllerRef.current === controller) {
              uploadControllerRef.current = null
              if (mountedRef.current) {
                setUploading(false)
                onUploadingChange(false)
              }
            }
          })
      },
      [media, onChange, onUploadingChange]
    )

    const handleAltTextChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        const input = event.currentTarget as unknown as {
          dataset: Record<string, string | undefined>
          value: string
        }
        const mediaId = input.dataset.mediaId
        if (!mediaId) {
          return
        }
        const altText = input.value
        onChange(
          media.map((item) =>
            item.id === mediaId ? { ...item, altText } : item
          )
        )
      },
      [media, onChange]
    )

    const handleMove = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        const target = event.currentTarget as MediaButtonTarget
        const mediaId = target.dataset?.mediaId
        const direction = target.dataset?.direction
        const index = media.findIndex((item) => item.id === mediaId)
        const destination = direction === "up" ? index - 1 : index + 1
        if (index < 0 || destination < 0 || destination >= media.length) {
          return
        }
        const next = [...media]
        const [item] = next.splice(index, 1)
        if (!item) {
          return
        }
        next.splice(destination, 0, item)
        onChange(next)
      },
      [media, onChange]
    )

    const handleRemove = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        const target = event.currentTarget as MediaButtonTarget
        const mediaId = target.dataset?.mediaId
        if (!mediaId) {
          return
        }
        onChange(media.filter((item) => item.id !== mediaId))
        setMessage(
          "Image removed from this draft. Its upload remains available in Media Cleanup."
        )
      },
      [media, onChange]
    )

    return (
      <section className="mt-6 border-t border-ui-border-base pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Photo aria-hidden="true" className="text-ui-fg-interactive" />
              <Text weight="plus">Product images</Text>
            </div>
            <Text className="mt-1 max-w-2xl text-ui-fg-subtle" size="small">
              Upload the gallery in customer-facing order. The first image is
              primary, and every image needs useful alt text.
            </Text>
          </div>
          <div>
            <input
              accept="image/jpeg,image/png,image/webp,image/gif"
              aria-label="Upload product images"
              className="sr-only"
              multiple
              onChange={handleUpload}
              ref={inputRef}
              tabIndex={-1}
              type="file"
            />
            <Button
              disabled={
                uploading || media.length >= MAX_CATALOG_PRODUCT_MEDIA_ITEMS
              }
              id="catalog-create-upload-media"
              isLoading={uploading}
              onClick={handleChooseImages}
              size="small"
              type="button"
              variant="secondary"
            >
              Upload images
            </Button>
          </div>
        </div>
        <Text className="mt-3 text-ui-fg-subtle" size="xsmall">
          JPEG, PNG, WebP, or non-animated GIF · up to 10 at once · 12 MiB each
          · 20 MiB combined. Images are decoded, stripped of metadata, and saved
          as WebP before publication. Abandoned images stay in Media Cleanup for
          safe review.
        </Text>
        {error ? (
          <Text
            aria-live="polite"
            className="mt-3 text-ui-fg-error"
            role="alert"
            size="small"
          >
            {error}
          </Text>
        ) : null}
        {message ? (
          <Text
            aria-live="polite"
            className="mt-3 text-ui-fg-subtle"
            size="small"
          >
            {message}
          </Text>
        ) : null}
        {media.length ? (
          <ol className="mt-4 flex flex-col gap-3">
            {media.map((item, index) => (
              <CatalogCreationMediaRow
                count={media.length}
                index={index}
                item={item}
                key={item.id}
                onAltTextChange={handleAltTextChange}
                onMove={handleMove}
                onRemove={handleRemove}
              />
            ))}
          </ol>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-ui-border-base bg-ui-bg-subtle p-6 text-center">
            <Photo aria-hidden="true" className="mx-auto text-ui-fg-muted" />
            <Text className="mt-2" size="small" weight="plus">
              No product images yet
            </Text>
            <Text className="mt-1 text-ui-fg-subtle" size="xsmall">
              Images are optional for a draft and can be added here when ready.
            </Text>
          </div>
        )}
      </section>
    )
  }
)

CatalogCreationMediaEditor.displayName = "CatalogCreationMediaEditor"
