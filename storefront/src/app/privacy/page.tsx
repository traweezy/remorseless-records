import type { Metadata } from "next"

import LegalPageShell from "@/components/legal/legal-page-shell"
import LegalSection from "@/components/legal/legal-section"
import PrivacyRequestForm from "@/components/legal/privacy-request-form"
import SmartLink from "@/components/ui/smart-link"
import { LEGAL_EFFECTIVE_DATE, legalConfig, legalRoutes } from "@/config/legal"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Privacy disclosures for data categories, processing purposes, service providers, retention, and request rights.",
}

const PrivacyPage = () => (
  <LegalPageShell
    eyebrow="Legal"
    title="Privacy Policy"
    description="This policy explains what we collect, why we collect it, how long we keep it, and how to exercise privacy rights."
    effectiveDate={LEGAL_EFFECTIVE_DATE}
    aside={
      <>
        <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">Privacy Contact</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Submit requests through the form on this page or email{" "}
          <a
            href={`mailto:${legalConfig.supportEmail}`}
            className="text-destructive underline underline-offset-4"
          >
            {legalConfig.supportEmail}
          </a>
          .
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Mailing address: {legalConfig.mailingAddress}
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Cookie controls are available at{" "}
          <SmartLink href={legalRoutes.cookies} className="text-destructive underline underline-offset-4">
            Cookie Preferences
          </SmartLink>
          .
        </p>
      </>
    }
  >
    <LegalSection title="Data We Collect">
      <p>We collect only the information needed to operate storefront services, including:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Contact details (name, email, phone when provided)</li>
        <li>Order and shipping details</li>
        <li>Billing and payment metadata (processed by Stripe)</li>
        <li>Support and privacy request correspondence</li>
      </ul>
    </LegalSection>

    <LegalSection title="How We Use Data">
      <p>Personal information is used for order fulfillment, customer support, fraud prevention, legal compliance, and service operations.</p>
      <p>We do not intentionally collect sensitive categories of personal data unless required for fraud prevention or legal obligations.</p>
    </LegalSection>

    <LegalSection title="Service Providers and Sharing">
      <p>
        We share data with processors that support order fulfillment and operations, including {legalConfig.privacy.processors.join(", ")}.
      </p>
      <p>
        We do not sell personal information for money. If state-law “sale” or “sharing” obligations apply in the future, this policy and controls will be updated accordingly.
      </p>
    </LegalSection>

    <LegalSection title="Retention">
      <ul className="list-disc space-y-1 pl-5">
        <li>Order and invoice records: {legalConfig.privacy.retention.orders}</li>
        <li>Support communications: {legalConfig.privacy.retention.support}</li>
        <li>Marketing suppression records: {legalConfig.privacy.retention.marketingSuppression}</li>
        <li>Privacy request records: {legalConfig.privacy.retention.privacyRequests}</li>
      </ul>
    </LegalSection>

    <LegalSection title="Your Rights and Requests">
      <p>
        Depending on your jurisdiction, you may request access, correction, deletion, or portability of personal data, and may object to certain processing.
      </p>
      <p>
        We verify request identity before fulfillment and retain request logs for compliance evidence.
      </p>
      <p>
        To submit a request now, use the form below. For cookie-specific controls, visit{" "}
        <SmartLink href={legalRoutes.cookies} className="text-destructive underline underline-offset-4">
          Cookie Preferences
        </SmartLink>
        .
      </p>
    </LegalSection>

    <PrivacyRequestForm />
  </LegalPageShell>
)

export default PrivacyPage

