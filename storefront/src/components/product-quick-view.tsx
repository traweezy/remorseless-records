"use client"

import dynamic from "next/dynamic"
import { Component } from "react"
import type { ProductQuickViewProps as ContentProps } from "@/components/product-quick-view-content"
import type { HttpTypes } from "@medusajs/types"

import { Alert } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import Drawer, {
  DrawerCloseButton,
  DrawerEyebrow,
  DrawerHeader,
  DrawerHeading,
  DrawerTitle,
} from "@/components/ui/drawer"

export const preloadProductQuickView = () =>
  import("@/components/product-quick-view-content")

const QuickShopPlaceholder = ({
  failed = false,
  retry,
}: {
  failed?: boolean
  retry?: () => void
}) => (
  <div className="flex h-full flex-col overflow-hidden">
    <DrawerHeader>
      <DrawerHeading>
        <DrawerEyebrow>Quick shop</DrawerEyebrow>
        <DrawerTitle>
          {failed ? "Unable to load quick shop" : "Loading release"}
        </DrawerTitle>
      </DrawerHeading>
      <DrawerCloseButton label="Close quick shop" />
    </DrawerHeader>
    {failed ? (
      <Alert variant="destructive" className="m-4 space-y-4 p-6">
        <p>Quick shop could not load. Check your connection and try again.</p>
        <Button type="button" variant="outlined" onClick={retry}>
          Retry
        </Button>
      </Alert>
    ) : (
      <div className="space-y-5 p-4 sm:p-6" role="status">
        <span className="sr-only">Loading product details</span>
        <div className="h-8 rounded-full skeleton" />
        <div className="h-36 rounded-2xl skeleton" />
        <div className="h-12 rounded-full skeleton" />
      </div>
    )}
  </div>
)

const createQuickViewContent = () =>
  dynamic(preloadProductQuickView, { loading: QuickShopPlaceholder })

class QuickShopContentBoundary extends Component<ContentProps> {
  override state = { failed: false, Content: createQuickViewContent() }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  retry = () => {
    // React.lazy retains a rejected promise. A fresh lazy boundary allows a
    // failed webpack chunk request to be retried without reloading the page.
    this.setState({ failed: false, Content: createQuickViewContent() })
  }

  override render() {
    if (this.state.failed) {
      return <QuickShopPlaceholder failed retry={this.retry} />
    }
    const Content = this.state.Content
    return <Content {...this.props} />
  }
}

type ProductQuickViewProps = {
  handle: string
  initialProduct?: HttpTypes.StoreProduct
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const ProductQuickView = ({
  onOpenChange,
  ...props
}: ProductQuickViewProps) => (
  <Drawer open={props.open} onOpenChange={onOpenChange} ariaLabel="Quick shop">
    <QuickShopContentBoundary {...props} />
  </Drawer>
)

export default ProductQuickView
