import type { Metadata } from "next"

import LegalPageShell from "@/components/legal/legal-page-shell"
import LegalSection from "@/components/legal/legal-section"
import { LEGAL_EFFECTIVE_DATE, legalConfig } from "@/config/legal"

export const metadata: Metadata = {
  title: "Accessibility Statement",
  description:
    "Accessibility commitment for the storefront, including standards, support channels, and continuous improvement process.",
}

const AccessibilityPage = () => (
  <LegalPageShell
    eyebrow="Legal"
    title="Accessibility Statement"
    description="We are committed to an inclusive storefront experience and continuous accessibility improvements."
    effectiveDate={LEGAL_EFFECTIVE_DATE}
    aside={
      <>
        <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">Accessibility support</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Report accessibility barriers at{" "}
          <a
            href={`mailto:${legalConfig.supportEmail}`}
            className="text-destructive underline underline-offset-4"
          >
            {legalConfig.supportEmail}
          </a>
          . Include the page URL, device, and assistive technology so we can reproduce and fix quickly.
        </p>
      </>
    }
  >
    <LegalSection title="Commitment and Standard">
      <p>
        We target conformance with WCAG 2.1 AA for key storefront flows, including navigation, product discovery, cart, and checkout.
      </p>
    </LegalSection>

    <LegalSection title="Accessibility Features">
      <ul className="list-disc space-y-1 pl-5">
        <li>Keyboard-operable navigation and interactive controls</li>
        <li>Visible focus indicators for actionable elements</li>
        <li>Semantic labels and status messaging for forms</li>
        <li>Color contrast and reduced-motion support in theme styles</li>
      </ul>
    </LegalSection>

    <LegalSection title="Known Limitations and Response">
      <p>
        Some third-party embeds and integrations may have limitations outside our direct control. We monitor issues and provide alternatives when possible.
      </p>
      <p>
        Accessibility reports are reviewed in ongoing release QA and prioritized by severity and user impact.
      </p>
    </LegalSection>
  </LegalPageShell>
)

export default AccessibilityPage

