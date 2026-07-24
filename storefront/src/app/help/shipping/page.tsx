import type { Metadata } from "next"

import { Alert } from "@/components/ui/alert"
import { Card } from "@/components/ui/card"
import {
  PageContentGrid,
  PageHeader,
  PageShell,
} from "@/components/ui/page-shell"
import { siteMetadata } from "@/config/site"
import SmartLink from "@/components/ui/smart-link"
import { legalRoutes } from "@/config/legal"

export const metadata: Metadata = {
  title: "Shipping & Returns",
  description:
    "Learn about Remorseless Records shipping rates, international delivery, and return/refund policies.",
}

const ShippingPage = () => (
  <PageShell>
    <PageHeader
      eyebrow="Support"
      title="Shipping & Returns"
      description="How we ship, how we price, and how to reach us if there’s an issue. Expect fast replies and DIY-level care."
    />

    <PageContentGrid>
      <Card as="section" variant="panel" className="space-y-6 p-6">
        <div className="space-y-3">
          <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
            Shipping
          </h2>
          <Alert
            variant="accent"
            className="font-semibold uppercase tracking-[0.2rem]"
          >
            Free domestic shipping on all orders over $50
          </Alert>
          <p className="text-sm leading-relaxed text-muted-foreground">
            International shipping rates are calculated against current USPS
            rates and reflect an average cost per zone. If something looks off,
            contact us and we’ll recalc against your exact location.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Orders go out in small batches with heavy packaging and hand
            inspection. You’ll get tracking as soon as your parcel scans.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            For complete legal terms, read the{" "}
            <SmartLink
              href={legalRoutes.shipping}
              className="text-destructive underline underline-offset-4"
            >
              Shipping Policy
            </SmartLink>
            .
          </p>
        </div>

        <div className="space-y-3">
          <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
            Returns & Refunds
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Refunds are granted for damaged or unplayable items. Returns and
            exchanges for unopened products are considered case-by-case; return
            shipping is covered by the customer.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            To start a return or refund, reach out via the{" "}
            <SmartLink
              href="/contact"
              className="text-destructive underline underline-offset-4"
            >
              Contact
            </SmartLink>{" "}
            page with your order number, photos (if damaged), and a short note.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            For full terms and exclusions, read the{" "}
            <SmartLink
              href={legalRoutes.returns}
              className="text-destructive underline underline-offset-4"
            >
              Returns & Refunds Policy
            </SmartLink>
            .
          </p>
        </div>
      </Card>

      <Card as="aside" variant="panel" className="space-y-4 p-6">
        <h3 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
          Need help fast?
        </h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Email{" "}
          <a
            href={`mailto:${siteMetadata.contact.email}`}
            className="text-destructive underline underline-offset-4"
          >
            {siteMetadata.contact.email}
          </a>{" "}
          or use the contact form. We usually reply within 1–2 business days.
        </p>
      </Card>
    </PageContentGrid>
  </PageShell>
)

export default ShippingPage
