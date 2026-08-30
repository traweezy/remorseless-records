"use client"

import {
  memo,
  useCallback,
  useId,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import {
  Alert,
  Button,
  FocusModal,
  Input,
  Label,
  RadioGroup,
  Skeleton,
  Text,
} from "@medusajs/ui"

import { AdminEmptyState } from "../../components/admin-empty-state"
import { AdminFocusModalHeader } from "../../components/admin-focus-modal-header"
import { getAdminRequestErrorMessage } from "../../lib/admin-request"
import {
  catalogProductPageQueryOptions,
  catalogProductPageSize,
  normalizeCatalogProductSearch,
} from "./catalog-merchandising-query"
import type { AdminProduct } from "./catalog-merchandising-types"

const ProductPageSkeleton = memo(() => (
  <div aria-label="Loading products" className="space-y-2" role="status">
    {Array.from({ length: 6 }, (_, index) => (
      <Skeleton className="h-16 w-full" key={index} />
    ))}
  </div>
))

ProductPageSkeleton.displayName = "ProductPageSkeleton"

type CatalogProductPickerProps = {
  currentProduct: AdminProduct | undefined
  currentProductId: string
  disabled?: boolean
  onSelect: (product: AdminProduct) => void
}

const readInputValue = (event: ChangeEvent<HTMLInputElement>): string =>
  (event.currentTarget as unknown as { value?: string }).value ?? ""

export const CatalogProductPicker = memo<CatalogProductPickerProps>(
  ({ currentProduct, currentProductId, disabled = false, onSelect }) => {
    const searchId = useId()
    const [open, setOpen] = useState(false)
    const [draftSearch, setDraftSearch] = useState("")
    const [appliedSearch, setAppliedSearch] = useState("")
    const [pageIndex, setPageIndex] = useState(0)
    const [selectedProductId, setSelectedProductId] = useState(currentProductId)
    const offset = pageIndex * catalogProductPageSize
    const pageQuery = useQuery({
      ...catalogProductPageQueryOptions({
        offset,
        search: appliedSearch,
      }),
      enabled: open,
      placeholderData: keepPreviousData,
    })
    const page = pageQuery.data
    const productsById = useMemo(() => {
      const values = new Map<string, AdminProduct>()
      if (currentProduct) {
        values.set(currentProduct.id, currentProduct)
      }
      page?.products.forEach((product) => {
        values.set(product.id, product)
      })
      return values
    }, [currentProduct, page?.products])
    const selectedProduct = productsById.get(selectedProductId)
    const firstResult = page ? page.offset + 1 : 0
    const lastResult = page
      ? Math.min(page.offset + page.products.length, page.count)
      : 0
    const hasPrevious = pageIndex > 0
    const hasNext = Boolean(page && lastResult < page.count)

    const handleOpenChange = useCallback(
      (nextOpen: boolean) => {
        setOpen(nextOpen)
        if (nextOpen) {
          setSelectedProductId(currentProductId)
        }
      },
      [currentProductId]
    )

    const handleDraftSearchChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        setDraftSearch(readInputValue(event))
      },
      []
    )

    const handleSearch = useCallback(
      (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setAppliedSearch(normalizeCatalogProductSearch(draftSearch))
        setPageIndex(0)
      },
      [draftSearch]
    )

    const handleClear = useCallback(() => {
      setDraftSearch("")
      setAppliedSearch("")
      setPageIndex(0)
    }, [])

    const handlePrevious = useCallback(() => {
      setPageIndex((current) => Math.max(0, current - 1))
    }, [])

    const handleNext = useCallback(() => {
      setPageIndex((current) => current + 1)
    }, [])

    const handleConfirm = useCallback(() => {
      if (!selectedProduct) {
        return
      }
      onSelect(selectedProduct)
      setOpen(false)
    }, [onSelect, selectedProduct])

    const handleRetry = useCallback(() => {
      void pageQuery.refetch()
    }, [pageQuery])

    return (
      <FocusModal onOpenChange={handleOpenChange} open={open}>
        <FocusModal.Trigger asChild>
          <Button
            disabled={disabled}
            size="small"
            type="button"
            variant="secondary"
          >
            {currentProductId ? "Change product" : "Choose product"}
          </Button>
        </FocusModal.Trigger>
        <FocusModal.Content className="sm:inset-x-1/2 sm:inset-y-8 sm:w-full sm:max-w-3xl sm:-translate-x-1/2">
          <AdminFocusModalHeader
            description="Search the full catalog. Selecting a product here does not save the shelf until you choose Save shelf."
            title="Choose a shelf product"
          />
          <FocusModal.Body className="overflow-y-auto px-6 py-5">
            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
              onSubmit={handleSearch}
            >
              <div className="min-w-0 flex-1">
                <Label htmlFor={searchId}>Search products</Label>
                <Input
                  className="mt-2"
                  id={searchId}
                  maxLength={100}
                  onChange={handleDraftSearchChange}
                  placeholder="Search by product name or description"
                  value={draftSearch}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="secondary">
                  Search
                </Button>
                <Button
                  disabled={!draftSearch && !appliedSearch}
                  onClick={handleClear}
                  type="button"
                  variant="transparent"
                >
                  Clear
                </Button>
              </div>
            </form>

            <div className="mt-5" aria-busy={pageQuery.isFetching}>
              {pageQuery.error ? (
                <Alert role="alert" variant="error">
                  <Text weight="plus">Products could not load</Text>
                  <Text size="small">
                    {getAdminRequestErrorMessage(
                      pageQuery.error,
                      "Unable to search products."
                    )}
                  </Text>
                  <Button
                    className="mt-3"
                    isLoading={pageQuery.isFetching}
                    onClick={handleRetry}
                    size="small"
                    type="button"
                    variant="secondary"
                  >
                    Try again
                  </Button>
                </Alert>
              ) : pageQuery.isPending ? (
                <ProductPageSkeleton />
              ) : page && page.products.length > 0 ? (
                <RadioGroup
                  className="space-y-2"
                  disabled={pageQuery.isFetching}
                  onValueChange={setSelectedProductId}
                  value={selectedProductId}
                >
                  {page.products.map((product) => (
                    <RadioGroup.ChoiceBox
                      description={
                        product.handle ? `/${product.handle}` : product.id
                      }
                      key={product.id}
                      label={product.title}
                      value={product.id}
                    />
                  ))}
                </RadioGroup>
              ) : (
                <AdminEmptyState
                  className="min-h-60"
                  description="Try a shorter product name or clear the search to browse the catalog."
                  headingLevel="h3"
                  title="No products match this search"
                />
              )}
            </div>
          </FocusModal.Body>
          <FocusModal.Footer className="flex-wrap">
            <Text
              aria-live="polite"
              className="w-full text-ui-fg-subtle sm:mr-auto sm:w-auto"
              size="small"
            >
              {page
                ? page.count === 0
                  ? "0 products"
                  : `${firstResult}–${lastResult} of ${page.count} products`
                : "Loading products…"}
            </Text>
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
              <Button
                disabled={!hasPrevious || pageQuery.isFetching}
                onClick={handlePrevious}
                size="small"
                type="button"
                variant="secondary"
              >
                Previous
              </Button>
              <Button
                disabled={!hasNext || pageQuery.isFetching}
                onClick={handleNext}
                size="small"
                type="button"
                variant="secondary"
              >
                Next
              </Button>
              <FocusModal.Close asChild>
                <Button size="small" type="button" variant="secondary">
                  Cancel
                </Button>
              </FocusModal.Close>
              <Button
                disabled={!selectedProduct}
                onClick={handleConfirm}
                size="small"
                type="button"
              >
                Use product
              </Button>
            </div>
          </FocusModal.Footer>
        </FocusModal.Content>
      </FocusModal>
    )
  }
)

CatalogProductPicker.displayName = "CatalogProductPicker"
