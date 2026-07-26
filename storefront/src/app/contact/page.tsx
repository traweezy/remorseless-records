import type { Metadata } from "next"
import { siBandcamp } from "simple-icons"

import BandcampEmbed from "@/components/contact/bandcamp-embed"
import ContactForm from "@/components/contact/contact-form"
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

          <Card variant="inset" className="space-y-3 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.16rem] text-muted-foreground sm:tracking-[0.35rem]">
                  Primary line
                </p>
                <h2 className="font-headline text-lg uppercase tracking-[0.14rem] text-foreground sm:tracking-[0.3rem]">
                  Email the label
                </h2>
                <p className="text-sm text-muted-foreground">
                  Goes straight to the inbox we actually monitor. Replies within
                  1–2 business days.
                </p>
              </div>
            </div>
            <Button
              asChild
              variant="outlined"
              size="compact"
              className="w-full min-w-0 px-3 tracking-[0.08rem] sm:w-fit sm:px-6 sm:tracking-[0.2rem]"
            >
              <a href={`mailto:${siteMetadata.contact.email}`}>
                {siteMetadata.contact.email}
              </a>
            </Button>
          </Card>
        </div>

        <Card as="aside" variant="panel" className="space-y-4 p-4 sm:p-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.16rem] text-muted-foreground sm:tracking-[0.35rem]">
                  Hear the catalog
                </p>
                <h2 className="font-headline text-lg uppercase tracking-[0.14rem] text-foreground sm:tracking-[0.25rem]">
                  Bandcamp
                </h2>
                <p className="text-sm text-muted-foreground">
                  Stream the featured release, follow the label, and support us
                  directly on Bandcamp.
                </p>
              </div>
            </div>
            <BandcampEmbed />
            <Button
              asChild
              variant="outlined"
              size="compact"
              className="w-full gap-2 sm:w-fit"
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
