import type { Metadata } from "next"

import CookiePreferencesEditor from "@/components/legal/cookie-preferences-editor"
import LegalPageShell from "@/components/legal/legal-page-shell"
import LegalSection from "@/components/legal/legal-section"
import SmartLink from "@/components/ui/smart-link"
import { LEGAL_EFFECTIVE_DATE, legalConfig, legalRoutes } from "@/config/legal"

export const metadata: Metadata = {
  title: "Cookie Policy & Preferences",
  description:
    "Cookie categories, legal basis summary, and preference controls for strictly necessary, analytics, and marketing cookies.",
}

const CookiesPage = () => (
  <LegalPageShell
    eyebrow="Legal"
    title="Cookie Policy & Preferences"
    description="Control optional cookies while keeping required security and checkout cookies enabled."
    effectiveDate={LEGAL_EFFECTIVE_DATE}
    aside={
      <>
        <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">Need help?</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Questions about cookies or data use can be sent to{" "}
          <a
            href={`mailto:${legalConfig.supportEmail}`}
            className="text-destructive underline underline-offset-4"
          >
            {legalConfig.supportEmail}
          </a>
          .
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          For full data handling details, review the{" "}
          <SmartLink href={legalRoutes.privacy} className="text-destructive underline underline-offset-4">
            Privacy Policy
          </SmartLink>
          .
        </p>
      </>
    }
  >
    <LegalSection title="How Cookies Are Used">
      <p>
        We use cookies and similar storage technologies for security, cart persistence, and optional analytics or marketing measurements.
      </p>
      <p>
        By default, only strictly necessary cookies are enabled. Optional categories are disabled until you grant consent.
      </p>
    </LegalSection>

    <LegalSection title="Cookie Categories">
      <ul className="list-disc space-y-1 pl-5">
        <li>Strictly necessary: required for secure sessions, cart, and checkout.</li>
        <li>Analytics: used for aggregate performance and usage insights.</li>
        <li>Marketing: used for campaign attribution and promotional relevance.</li>
      </ul>
    </LegalSection>

    <LegalSection title="Manage Your Preferences">
      <p>
        You can update preferences at any time below. Changes apply to future optional cookie usage and are stored with timestamped consent metadata.
      </p>
      <CookiePreferencesEditor className="pt-1" />
    </LegalSection>
  </LegalPageShell>
)

export default CookiesPage

