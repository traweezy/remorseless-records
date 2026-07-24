import type { Metadata } from "next"

import { Card } from "@/components/ui/card"
import {
  PageContentGrid,
  PageHeader,
  PageShell,
} from "@/components/ui/page-shell"
import { siteMetadata } from "@/config/site"
import SmartLink from "@/components/ui/smart-link"

export const metadata: Metadata = {
  title: "About",
  description:
    "Remorseless Records is a DIY underground metal label curating limited runs of doom, death, and sludge with archival-grade packaging.",
}

const ABOUT_PARAGRAPHS = [
  "Remorseless Records was founded in 2024 in Stamford, Connecticut with a singular goal: release and distribute the best in underground death and doom metal. Every release is personally vetted, mastered for maximum impact, and packed in small batches to keep quality brutal and uncompromised.",
  "If you want to be considered for a release or want to carry Remorseless titles in your distro, reach out via the Contact page. All messages get answered as quickly as possible.",
  "International shipping rates are calculated against current USPS rates and reflect an average cost per zone. If a rate looks off, reach out and we’ll recalc against your exact location.",
  "Refunds are granted for damaged or unplayable items. Returns and exchanges for unopened products are considered case-by-case; return shipping is covered by the customer. Contact us to request a return or refund.",
]

const AboutPage = () => {
  return (
    <PageShell>
      <PageHeader
        eyebrow="About Remorseless"
        title="Death. Doom. Grind."
        description={siteMetadata.description}
      />

      <PageContentGrid className="lg:grid-cols-[1.15fr_0.85fr]">
        <Card as="section" variant="panel" className="space-y-6 p-6">
          {ABOUT_PARAGRAPHS.map((para, idx) => (
            <p
              key={`about-${idx}`}
              className="text-sm leading-relaxed text-muted-foreground"
            >
              {para.includes("Contact page") ? (
                <>
                  If you want to be considered for a release or want to carry
                  Remorseless titles in your distro, reach out via the{" "}
                  <SmartLink
                    href="/contact"
                    className="text-destructive underline underline-offset-4"
                  >
                    Contact
                  </SmartLink>{" "}
                  page. All messages get answered as quickly as possible.
                </>
              ) : (
                para
              )}
            </p>
          ))}
        </Card>

        <Card as="aside" variant="panel" className="space-y-4 p-6">
          <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
            Quick facts
          </h2>
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li className="flex items-start gap-3">
              <span
                className="mt-1 h-2 w-2 rounded-full bg-destructive"
                aria-hidden
              />
              <div>
                <p className="font-semibold text-foreground">Founded</p>
                <p>2024, Stamford, CT — proudly DIY.</p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span
                className="mt-1 h-2 w-2 rounded-full bg-destructive"
                aria-hidden
              />
              <div>
                <p className="font-semibold text-foreground">Formats</p>
                <p>Micro-batch vinyl, cassettes, limited merch drops.</p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span
                className="mt-1 h-2 w-2 rounded-full bg-destructive"
                aria-hidden
              />
              <div>
                <p className="font-semibold text-foreground">Promise</p>
                <p>Vetted releases only — no compromises, no fillers.</p>
              </div>
            </li>
          </ul>
        </Card>
      </PageContentGrid>
    </PageShell>
  )
}

export default AboutPage
