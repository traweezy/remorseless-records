import type { Metadata } from "next"
import { siteMetadata } from "@/config/site"
import SmartLink from "@/components/ui/smart-link"

export const metadata: Metadata = {
  title: "Shipping & Returns",
  description:
    "Learn about Remorseless Records shipping rates, international delivery, and return/refund policies.",
}

const ShippingPage = () => (
  <div className="bg-background">
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8 px-4 pb-16 pt-12 lg:gap-10 lg:px-8">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.35rem] text-muted-foreground">
          Support
        </p>
        <h1 className="font-display text-5xl uppercase tracking-[0.3rem] text-foreground">
          Shipping & Returns
        </h1>
        <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">
          How we ship, how we price, and how to reach us if there’s an issue. Expect fast replies and DIY-level care.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-start lg:gap-8">
        <section className="space-y-6 rounded-3xl border border-border/70 bg-surface/90 p-6 shadow-[0_28px_60px_-42px_rgba(0,0,0,0.8)]">
          <div className="space-y-3">
            <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
              Shipping
            </h2>
            <div className="rounded-2xl border border-border/60 bg-destructive/10 px-4 py-3 text-sm font-semibold uppercase tracking-[0.2rem] text-destructive">
              Free domestic shipping on all orders over $50
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              International shipping rates are calculated against current USPS rates and reflect an average cost per zone. If something looks off, contact us and we’ll recalc against your exact location.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Orders go out in small batches with heavy packaging and hand inspection. You’ll get tracking as soon as your parcel scans.
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
              Returns & Refunds
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Refunds are granted for damaged or unplayable items. Returns and exchanges for unopened products are considered case-by-case; return shipping is covered by the customer.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              To start a return or refund, reach out via the{" "}
              <SmartLink href="/contact" className="text-destructive underline underline-offset-4">
                Contact
              </SmartLink>{" "}
              page with your order number, photos (if damaged), and a short note.
            </p>
          </div>
        </section>

        <aside className="space-y-4 rounded-3xl border border-border/70 bg-surface/90 p-6 shadow-[0_28px_60px_-42px_rgba(0,0,0,0.8)]">
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
        </aside>
      </div>
    </div>
  </div>
)

export default ShippingPage
