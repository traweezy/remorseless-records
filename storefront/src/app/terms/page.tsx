import type { Metadata } from "next"

import LegalPageShell from "@/components/legal/legal-page-shell"
import LegalSection from "@/components/legal/legal-section"
import SmartLink from "@/components/ui/smart-link"
import { LEGAL_EFFECTIVE_DATE, legalConfig, legalRoutes } from "@/config/legal"

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms governing the use of Remorseless Records storefront, orders, fulfillment, and customer responsibilities.",
}

const TermsPage = () => (
  <LegalPageShell
    eyebrow="Legal"
    title="Terms of Service"
    description="These terms govern your use of the storefront and all purchases made through Remorseless Records."
    effectiveDate={LEGAL_EFFECTIVE_DATE}
    aside={
      <>
        <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">Need support?</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Questions about these terms can be sent to{" "}
          <a
            href={`mailto:${legalConfig.supportEmail}`}
            className="text-destructive underline underline-offset-4"
          >
            {legalConfig.supportEmail}
          </a>
          .
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          For policy details, review our{" "}
          <SmartLink href={legalRoutes.privacy} className="text-destructive underline underline-offset-4">
            Privacy Policy
          </SmartLink>
          ,{" "}
          <SmartLink href={legalRoutes.shipping} className="text-destructive underline underline-offset-4">
            Shipping Policy
          </SmartLink>
          , and{" "}
          <SmartLink href={legalRoutes.returns} className="text-destructive underline underline-offset-4">
            Returns & Refunds Policy
          </SmartLink>
          .
        </p>
      </>
    }
  >
    <LegalSection title="Acceptance and Updates">
      <p>
        By accessing this site or placing an order, you agree to these Terms of Service and our related policies. If you do not agree, do not use the storefront.
      </p>
      <p>
        We may update these terms when operations, laws, or platform requirements change. Updated terms apply once posted with a revised effective date.
      </p>
    </LegalSection>

    <LegalSection title="Orders, Pricing, and Taxes">
      <p>
        Product availability, pricing, and shipping options are shown at checkout before payment. We may decline or cancel orders affected by fraud screening, pricing errors, or unavailable inventory.
      </p>
      <p>
        Taxes are calculated from the shipping destination where legally required and may be shown as estimated until address validation is complete.
      </p>
    </LegalSection>

    <LegalSection title="Shipping, Delays, and Refund Path">
      <p>
        Orders generally process within {legalConfig.shipping.processingWindow}. If a shipment cannot leave within the promised or policy window, we notify you and provide a delay consent or cancellation option.
      </p>
      <p>
        If you do not consent to a delay, the order may be canceled and refunded to the original payment method.
      </p>
    </LegalSection>

    <LegalSection title="Returns and Exchanges">
      <p>
        Returns and exchanges are governed by our{" "}
        <SmartLink href={legalRoutes.returns} className="text-destructive underline underline-offset-4">
          Returns & Refunds Policy
        </SmartLink>
        . We may deny returns that do not satisfy the documented conditions.
      </p>
    </LegalSection>

    <LegalSection title="Intellectual Property and Acceptable Use">
      <p>
        All storefront content, branding, artwork, and copy are owned by {legalConfig.businessName} or licensed to us. You may not scrape, copy, resell, or distribute content without permission.
      </p>
      <p>
        You agree not to interfere with the site, bypass security controls, attempt unauthorized access, or use automated methods that degrade service for others.
      </p>
    </LegalSection>

    <LegalSection title="Warranty Disclaimer and Liability Limits">
      <p>
        The storefront is provided on an “as is” and “as available” basis to the maximum extent permitted by law. We do not guarantee uninterrupted availability.
      </p>
      <p>
        To the extent permitted by law, {legalConfig.businessName} is not liable for indirect, incidental, special, or consequential damages resulting from use of the storefront or products.
      </p>
    </LegalSection>

    <LegalSection title="Governing Law">
      <p>
        These terms are governed by the laws of {legalConfig.governingLaw}, without regard to conflict-of-law principles.
      </p>
      <p>
        The storefront does not intentionally sell regulated or age-restricted products unless a specific product listing states otherwise.
      </p>
    </LegalSection>
  </LegalPageShell>
)

export default TermsPage

