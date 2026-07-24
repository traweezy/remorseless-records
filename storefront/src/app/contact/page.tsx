import type { Metadata } from "next"
import { siBandcamp } from "simple-icons"

import ContactForm from "@/components/contact/contact-form"
import BandcampEmbed from "@/components/contact/bandcamp-embed"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  PageContentGrid,
  PageHeader,
  PageShell,
} from "@/components/ui/page-shell"
import { siteMetadata } from "@/config/site"

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Reach Remorseless Records for releases, distro, and press. Expect fast replies.",
}

const ContactPage = () => {
  const bandcampPath = siBandcamp.path

  return (
    <PageShell contentClassName="lg:gap-12">
      <PageHeader
        eyebrow="Contact"
        title="Drop a line"
        description={
          <>
            Submissions, distro inquiries, press, or support. This form goes
            straight to the label inbox. Expect a reply within 1–2 business
            days.
          </>
        }
      />

      <PageContentGrid>
        <div className="space-y-4">
          <ContactForm />

          <Card variant="inset" className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.35rem] text-muted-foreground">
                  Primary line
                </p>
                <h2 className="font-headline text-lg uppercase tracking-[0.3rem] text-foreground">
                  Email the label
                </h2>
                <p className="text-sm text-muted-foreground">
                  Goes straight to the inbox we actually monitor. Replies within
                  1–2 business days.
                </p>
              </div>
            </div>
            <Button asChild variant="outlined" size="compact" className="w-fit">
              <a href={`mailto:${siteMetadata.contact.email}`}>
                {siteMetadata.contact.email}
              </a>
            </Button>
          </Card>
        </div>

        <Card as="aside" variant="panel" className="space-y-4 p-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.35rem] text-muted-foreground">
                  Listen while you write
                </p>
                <h3 className="font-headline text-base uppercase tracking-[0.25rem] text-foreground">
                  Bandcamp
                </h3>
                <p className="text-sm text-muted-foreground">
                  Featured release from our Bandcamp. Stream while you write and
                  follow the label.
                </p>
              </div>
            </div>
            <BandcampEmbed />
            <Button
              asChild
              variant="outlined"
              size="compact"
              className="w-fit gap-2"
            >
              <a
                href={
                  siteMetadata.socials.bandcamp ??
                  "https://remorselessrecords.bandcamp.com/"
                }
                target="_blank"
                rel="noreferrer"
              >
                <svg
                  aria-hidden="true"
                  role="img"
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="currentColor"
                >
                  <path d={bandcampPath} />
                </svg>
                Support us on Bandcamp
              </a>
            </Button>
          </div>
        </Card>
      </PageContentGrid>
    </PageShell>
  )
}

export default ContactPage
