import type { Metadata } from "next"

import LegalPageShell from "@/components/legal/legal-page-shell"
import LegalSection from "@/components/legal/legal-section"
import SmartLink from "@/components/ui/smart-link"
import { LEGAL_EFFECTIVE_DATE, legalConfig, legalRoutes } from "@/config/legal"

export const metadata: Metadata = {
  title: "Shipping Policy",
  description:
    "Policy for order processing, shipping windows, preorders, backorders, partial shipments, and delay handling.",
}

const ShippingPolicyPage = () => (
  <LegalPageShell
    eyebrow="Legal"
    title="Shipping Policy"
    description="Shipping commitments, timelines, and delay handling for Remorseless Records orders."
    effectiveDate={LEGAL_EFFECTIVE_DATE}
    aside={
      <>
        <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">Need shipping help?</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Contact{" "}
          <a
            href={`mailto:${legalConfig.supportEmail}`}
            className="text-destructive underline underline-offset-4"
          >
            {legalConfig.supportEmail}
          </a>{" "}
          with your order number for shipment updates.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Returns are managed under the{" "}
          <SmartLink href={legalRoutes.returns} className="text-destructive underline underline-offset-4">
            Returns & Refunds Policy
          </SmartLink>
          .
        </p>
      </>
    }
  >
    <LegalSection title="Processing and Transit Windows">
      <p>Orders are typically packed and handed to carriers within {legalConfig.shipping.processingWindow}.</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Domestic transit estimate: {legalConfig.shipping.domesticTransitWindow}</li>
        <li>International transit estimate: {legalConfig.shipping.internationalTransitWindow}</li>
      </ul>
      <p>
        Transit windows are estimates and do not include carrier disruptions, customs processing, or weather events.
      </p>
    </LegalSection>

    <LegalSection title="Preorders, Backorders, and Partial Shipments">
      <p>{legalConfig.shipping.preorders}</p>
      <p>{legalConfig.shipping.backorders}</p>
      <p>{legalConfig.shipping.partialShipments}</p>
    </LegalSection>

    <LegalSection title="Shipping Methods and Address Accuracy">
      <p>
        Available methods and shipping charges are shown at checkout before payment. Customers are responsible for accurate shipping details and reachable delivery locations.
      </p>
      <p>
        If an order is returned for an invalid or incomplete address, we may require updated shipping charges before reshipment.
      </p>
    </LegalSection>

    <LegalSection title="Delay, Consent, and Refund Workflow">
      <p>
        If we cannot ship within the stated or promised timeframe, we send a delay notice and offer two options: consent to wait or cancel for refund.
      </p>
      <p>
        Delay responses are logged with timestamp and request details for compliance and customer support history.
      </p>
    </LegalSection>
  </LegalPageShell>
)

export default ShippingPolicyPage

