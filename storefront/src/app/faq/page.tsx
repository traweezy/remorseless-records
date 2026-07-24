import type { Metadata } from "next"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Card } from "@/components/ui/card"
import {
  PageContentGrid,
  PageHeader,
  PageShell,
} from "@/components/ui/page-shell"
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
  <PageShell>
    <PageHeader
      eyebrow="Support"
      title="Frequently asked questions"
      description={
        <>
          Quick answers about shipping, returns, variants, and how to reach us.
          Need more?{" "}
          <SmartLink
            href="/contact"
            className="text-destructive underline underline-offset-4"
          >
            Contact the label
          </SmartLink>
          .
        </>
      }
    />

    <PageContentGrid>
      <Card as="section" variant="panel" className="p-6">
        <Accordion
          type="multiple"
          defaultValue={faqs.map((item) => item.q)}
          className="space-y-4"
        >
          {faqs.map((item) => (
            <AccordionItem
              key={item.q}
              value={item.q}
              className="rounded-2xl border border-border/60 bg-background/85 px-4"
            >
              <AccordionTrigger
                headingLevel="h2"
                className="text-sm font-semibold uppercase tracking-[0.28rem] text-foreground"
              >
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="pt-0 text-sm leading-relaxed text-muted-foreground">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Card>

      <Card as="aside" variant="panel" className="space-y-4 p-6">
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
          <SmartLink
            href="/contact"
            className="text-destructive underline underline-offset-4"
          >
            contact form
          </SmartLink>
          . We answer within 1–2 business days.
        </p>
        <Card
          variant="inset"
          className="p-4 text-sm leading-relaxed text-muted-foreground"
        >
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
        </Card>
      </Card>
    </PageContentGrid>
  </PageShell>
)

export default FAQPage
