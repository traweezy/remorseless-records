"use client"

import {
  createContext,
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react"

type ProductVariantSelectionContextValue = {
  selectedVariantId: string
  selectVariant: (variantId: string) => void
}

const ProductVariantSelectionContext =
  createContext<ProductVariantSelectionContextValue | null>(null)

type ProductVariantSelectionProviderProps = {
  children: ReactNode
  initialVariantId: string
}

export const ProductVariantSelectionProvider =
  memo<ProductVariantSelectionProviderProps>(
    ({ children, initialVariantId }) => {
      const [selectedVariantId, setSelectedVariantId] =
        useState(initialVariantId)
      const selectVariant = useCallback((variantId: string) => {
        setSelectedVariantId(variantId)
      }, [])
      const value = useMemo(
        () => ({ selectedVariantId, selectVariant }),
        [selectVariant, selectedVariantId]
      )

      return (
        <ProductVariantSelectionContext.Provider value={value}>
          {children}
        </ProductVariantSelectionContext.Provider>
      )
    }
  )

ProductVariantSelectionProvider.displayName = "ProductVariantSelectionProvider"

export const useProductVariantSelection =
  (): ProductVariantSelectionContextValue | null =>
    useContext(ProductVariantSelectionContext)
