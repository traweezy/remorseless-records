import type { Metadata } from "next"

import LegalPageShell from "@/components/legal/legal-page-shell"
import LegalSection from "@/components/legal/legal-section"
import { LEGAL_EFFECTIVE_DATE, legalConfig } from "@/config/legal"

export const metadata: Metadata = {
  title: "Returns & Refunds Policy",
  description:
    "Policy for return windows, condition requirements, return shipping responsibility, exchange flow, and refund timing.",
}

const ReturnsPolicyPage = () => (
  <LegalPageShell
    eyebrow="Legal"
    title="Returns & Refunds Policy"
    description="How returns, exchanges, and refunds are handled for storefront purchases."
    effectiveDate={LEGAL_EFFECTIVE_DATE}
    aside={
      <>
        <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">Start a return</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Email{" "}
          <a
            href={`mailto:${legalConfig.supportEmail}`}
            className="text-destructive underline underline-offset-4"
          >
            {legalConfig.supportEmail}
          </a>{" "}
          with order number, product details, and photos when reporting damage.
        </p>
      </>
    }
  >
    <LegalSection title="Return Window and Item Condition">
      <p>
        Eligible returns must be requested within {legalConfig.returns.windowDays} days from delivery. {legalConfig.returns.condition}
      </p>
    </LegalSection>

    <LegalSection title="Non-returnable Items">
      <ul className="list-disc space-y-1 pl-5">
        {legalConfig.returns.excludedItems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </LegalSection>

    <LegalSection title="Return Shipping and Exchanges">
      <p>
        Unless an item arrives damaged or incorrect, return shipping is the customer’s responsibility. Exchanges are processed after returned goods are inspected.
      </p>
      <p>
        If replacement stock is unavailable, we issue a refund to the original payment method.
      </p>
    </LegalSection>

    <LegalSection title="Refund Method and Timing">
      <p>
        Approved refunds are issued to the original payment method. Financial institution posting times vary, but most refunds appear within {legalConfig.returns.refundTimeline}.
      </p>
      <p>
        Shipping charges are non-refundable unless the return is caused by our fulfillment error.
      </p>
    </LegalSection>

    <LegalSection title="Damaged, Defective, or Wrong Item">
      <p>
        Report transit damage or fulfillment issues as soon as possible with photos of the product and packaging. We will resolve via replacement, store credit, or refund depending on stock and issue type.
      </p>
    </LegalSection>
  </LegalPageShell>
)

export default ReturnsPolicyPage

