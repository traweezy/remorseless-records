"use client"

import { memo, useCallback, type ChangeEvent } from "react"
import { Trash } from "@medusajs/icons"
import { Alert, Button, Input, Label, Text } from "@medusajs/ui"

import { AdminEmptyState } from "../../components/admin-empty-state"
import { AdminSectionHeader } from "../../components/admin-page"
import { CatalogCheckboxField } from "./catalog-shelf-fields"
import { CatalogProductPicker } from "./catalog-product-picker"
import type {
  AdminProduct,
  ShelfProductLine,
} from "./catalog-merchandising-types"

type ProductLineCardProps = {
  disabled: boolean
  index: number
  line: ShelfProductLine
  onChange: (key: string, patch: Partial<ShelfProductLine>) => void
  onMove: (key: string, direction: -1 | 1) => void
  onProductSelect: (key: string, product: AdminProduct) => void
  onRemove: (key: string) => void
  product: AdminProduct | undefined
  total: number
}

const readInputValue = (event: ChangeEvent<HTMLInputElement>): string =>
  (event.currentTarget as unknown as { value?: string }).value ?? ""

const ProductLineCard = memo<ProductLineCardProps>(
  ({
    disabled,
    index,
    line,
    onChange,
    onMove,
    onProductSelect,
    onRemove,
    product,
    total,
  }) => {
    const title = product?.title ?? (line.productId || "No product selected")
    const description = product?.handle
      ? `/${product.handle}`
      : (product?.id ?? line.productId) || "Choose a product from the catalog"

    const handleProductSelect = useCallback(
      (nextProduct: AdminProduct) => {
        onProductSelect(line.key, nextProduct)
      },
      [line.key, onProductSelect]
    )

    const handleOrderChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        onChange(line.key, { sortOrder: readInputValue(event) })
      },
      [line.key, onChange]
    )

    const handlePinnedChange = useCallback(
      (checked: boolean) => {
        onChange(line.key, { isPinned: checked })
      },
      [line.key, onChange]
    )

    const handleStartsAtChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        onChange(line.key, { startsAt: readInputValue(event) })
      },
      [line.key, onChange]
    )

    const handleEndsAtChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        onChange(line.key, { endsAt: readInputValue(event) })
      },
      [line.key, onChange]
    )

    const handleMoveUp = useCallback(() => {
      onMove(line.key, -1)
    }, [line.key, onMove])

    const handleMoveDown = useCallback(() => {
      onMove(line.key, 1)
    }, [line.key, onMove])

    const handleRemove = useCallback(() => {
      onRemove(line.key)
    }, [line.key, onRemove])

    return (
      <li className="min-w-0 rounded-lg border border-ui-border-base bg-ui-bg-base p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <Text className="truncate" size="small" weight="plus">
              {title}
            </Text>
            <Text className="truncate text-ui-fg-subtle" size="xsmall">
              {description}
            </Text>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <CatalogProductPicker
              currentProduct={product}
              currentProductId={line.productId}
              disabled={disabled}
              onSelect={handleProductSelect}
            />
            <Button
              disabled={disabled}
              onClick={handleRemove}
              size="small"
              type="button"
              variant="secondary"
            >
              <Trash aria-hidden="true" />
              Remove
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor={`shelf-product-order-${line.key}`}>Order</Label>
            <Input
              disabled={disabled}
              id={`shelf-product-order-${line.key}`}
              min="0"
              onChange={handleOrderChange}
              type="number"
              value={line.sortOrder}
            />
          </div>
          <div className="flex items-end pb-0.5">
            <CatalogCheckboxField
              checked={line.isPinned}
              disabled={disabled}
              id={`shelf-product-pinned-${line.key}`}
              label="Pin in this position"
              onChange={handlePinnedChange}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`shelf-product-start-${line.key}`}>Starts at</Label>
            <Input
              disabled={disabled}
              id={`shelf-product-start-${line.key}`}
              onChange={handleStartsAtChange}
              type="datetime-local"
              value={line.startsAt}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`shelf-product-end-${line.key}`}>Ends at</Label>
            <Input
              disabled={disabled}
              id={`shelf-product-end-${line.key}`}
              onChange={handleEndsAtChange}
              type="datetime-local"
              value={line.endsAt}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-ui-border-base pt-4">
          <Button
            disabled={disabled || index === 0}
            onClick={handleMoveUp}
            size="small"
            type="button"
            variant="transparent"
          >
            Move up
          </Button>
          <Button
            disabled={disabled || index === total - 1}
            onClick={handleMoveDown}
            size="small"
            type="button"
            variant="transparent"
          >
            Move down
          </Button>
        </div>
      </li>
    )
  }
)

ProductLineCard.displayName = "ProductLineCard"

type CatalogShelfProductsEditorProps = {
  disabled?: boolean
  lines: ShelfProductLine[]
  lookupError?: string | null
  lookupRetrying?: boolean
  onAdd: () => void
  onChange: (key: string, patch: Partial<ShelfProductLine>) => void
  onMove: (key: string, direction: -1 | 1) => void
  onProductSelect: (key: string, product: AdminProduct) => void
  onRemove: (key: string) => void
  onRetryLookup?: () => void
  productById: Map<string, AdminProduct>
}

export const CatalogShelfProductsEditor = memo<CatalogShelfProductsEditorProps>(
  ({
    disabled = false,
    lines,
    lookupError = null,
    lookupRetrying = false,
    onAdd,
    onChange,
    onMove,
    onProductSelect,
    onRemove,
    onRetryLookup,
    productById,
  }) => (
    <div className="min-w-0 p-4">
      <AdminSectionHeader
        actions={
          <Button
            disabled={disabled}
            onClick={onAdd}
            size="small"
            type="button"
            variant="secondary"
          >
            Add product
          </Button>
        }
        description="Choose products from the full catalog, then order, pin, or schedule each item."
        title="Products"
      />

      {lookupError ? (
        <Alert className="mt-4" role="alert" variant="error">
          <Text weight="plus">Selected product details could not load</Text>
          <Text size="small">{lookupError}</Text>
          {onRetryLookup ? (
            <Button
              className="mt-3"
              disabled={lookupRetrying}
              isLoading={lookupRetrying}
              onClick={onRetryLookup}
              size="small"
              type="button"
              variant="secondary"
            >
              Try again
            </Button>
          ) : null}
        </Alert>
      ) : null}

      {lines.length > 0 ? (
        <ol className="mt-4 min-w-0 space-y-3">
          {lines.map((line, index) => (
            <ProductLineCard
              disabled={disabled}
              index={index}
              key={line.key}
              line={line}
              onChange={onChange}
              onMove={onMove}
              onProductSelect={onProductSelect}
              onRemove={onRemove}
              product={productById.get(line.productId)}
              total={lines.length}
            />
          ))}
        </ol>
      ) : (
        <AdminEmptyState
          action={
            <Button
              disabled={disabled}
              onClick={onAdd}
              size="small"
              type="button"
              variant="secondary"
            >
              Add the first product
            </Button>
          }
          className="mt-4 min-h-44 rounded-lg border border-dashed border-ui-border-base"
          description="Automatic shelves can stay empty. Add products when you want manual or pinned placements."
          headingLevel="h3"
          title="No manual products"
        />
      )}
    </div>
  )
)

CatalogShelfProductsEditor.displayName = "CatalogShelfProductsEditor"
