import type { Metadata } from "next"
import { siteMetadata } from "@/config/site"
import SmartLink from "@/components/ui/smart-link"

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Answers about shipping, returns, variants, and how to reach Remorseless Records for support.",
}

const faqs = [
  {
    q: "Do you ship internationally?",
    a: "Yes. Rates are based on current USPS pricing and averaged per zone. If a rate seems high, contact us and we'll recalc against your exact address.",
  },
  {
    q: "When will my order ship?",
    a: "Orders leave in small batches with heavy packaging. You’ll receive tracking as soon as your parcel scans. Expect 1–3 business days to depart.",
  },
  {
    q: "What’s your return policy?",
    a: "Refunds are granted for damaged or unplayable items. Returns/exchanges for unopened products are case-by-case; return shipping is covered by the customer.",
  },
  {
    q: "Do you press limited variants?",
    a: "Yes. Micro-batch variants are noted on each product page. Once sold out, we typically do not repress the same variant.",
  },
  {
    q: "How do I submit my band?",
    a: "Head to the Submissions page with streaming links, project bio, and format preferences. We reply to every serious pitch.",
  },
  {
    q: "Can I carry Remorseless titles in my distro?",
    a: "Yes. Reach out via Contact with your shop details, location, and quantities. We’ll get you wholesale info.",
  },
]

const FAQPage = () => (
  <div className="bg-background">
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-10 px-4 pb-16 pt-12 lg:px-8">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.35rem] text-muted-foreground">Support</p>
        <h1 className="font-display text-5xl uppercase tracking-[0.3rem] text-foreground">
          Frequently asked questions
        </h1>
        <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">
          Quick answers about shipping, returns, variants, and how to reach us. Need more?{" "}
          <SmartLink href="/contact" className="text-destructive underline underline-offset-4">
            Contact the label
          </SmartLink>
          .
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
        <section className="space-y-4 rounded-3xl border border-border/70 bg-surface/90 p-6 shadow-[0_28px_60px_-42px_rgba(0,0,0,0.8)]">
          <ul className="space-y-4">
            {faqs.map((item) => (
              <li
                key={item.q}
                className="rounded-2xl border border-border/60 bg-background/85 px-4 py-4"
              >
                <p className="text-sm font-semibold uppercase tracking-[0.28rem] text-foreground">
                  {item.q}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
              </li>
            ))}
          </ul>
        </section>

        <aside className="space-y-4 rounded-3xl border border-border/70 bg-surface/90 p-6 shadow-[0_28px_60px_-42px_rgba(0,0,0,0.8)]">
          <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
            Still need help?
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Email{" "}
            <a
              href={`mailto:${siteMetadata.contact.email}`}
              className="text-destructive underline underline-offset-4"
            >
              {siteMetadata.contact.email}
            </a>{" "}
            or use the{" "}
            <SmartLink href="/contact" className="text-destructive underline underline-offset-4">
              contact form
            </SmartLink>
            . We answer within 1–2 business days.
          </p>
          <div className="rounded-2xl border border-border/60 bg-background/80 p-4 text-sm leading-relaxed text-muted-foreground">
            <p className="font-semibold text-foreground">Shipping & Returns</p>
            <p className="mt-1">
              See the{" "}
              <SmartLink
                href="/help/shipping"
                className="text-destructive underline underline-offset-4"
              >
                Shipping & Returns
              </SmartLink>{" "}
              page for detailed policies.
            </p>
          </div>
        </aside>
      </div>
    </div>
  </div>
)

export default FAQPage
