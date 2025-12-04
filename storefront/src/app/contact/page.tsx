import type { Metadata } from "next"
import Link from "next/link"
import { Mail, Send, MessageCircle } from "lucide-react"

import ContactForm from "@/components/contact/contact-form"
import { siteMetadata } from "@/config/site"
import BandcampEmbed from "@/components/contact/bandcamp-embed"
import InstagramGrid from "@/components/contact/instagram-grid"

const BandcampGlyph = () => (
  <svg
    aria-hidden="true"
    role="img"
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill="currentColor"
  >
    <path d="M3 17.5 9.5 6H21l-6.5 11.5Z" />
  </svg>
)

export const metadata: Metadata = {
  title: "Contact",
  description: "Reach Remorseless Records for releases, distro, and press. Expect fast replies.",
}

const ContactPage = () => {
  return (
    <div className="bg-background">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-12 px-4 pb-16 pt-12 lg:px-8">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.35rem] text-muted-foreground">
            Contact
          </p>
          <h1 className="font-display text-5xl uppercase tracking-[0.3rem] text-foreground">
            Drop a line
          </h1>
          <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">
            Submissions, distro inquiries, press, or support—this form goes straight to the label inbox.
            Expect a reply within 1–2 business days.
          </p>
        </header>

        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          <ContactForm />

          <aside className="space-y-4 rounded-3xl border border-border/70 bg-surface/90 p-6 shadow-[0_28px_60px_-42px_rgba(0,0,0,0.8)]">
            <div className="space-y-3 rounded-2xl border border-border/60 bg-background/80 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-[0.35rem] text-muted-foreground">
                    Primary line
                  </p>
                  <h2 className="font-headline text-lg uppercase tracking-[0.3rem] text-foreground">
                    Email the label
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Goes straight to the inbox we actually monitor. Replies within 1–2 business days.
                  </p>
                </div>
                <Mail className="h-6 w-6 text-destructive" aria-hidden />
              </div>
              <Link
                href={`mailto:${siteMetadata.contact.email}`}
                className="inline-flex w-fit items-center gap-2 rounded-full border border-destructive/70 px-4 py-2 text-xs uppercase tracking-[0.25rem] text-destructive transition hover:border-destructive hover:text-foreground"
              >
                {siteMetadata.contact.email}
              </Link>
            </div>

            <div className="space-y-3 rounded-2xl border border-border/60 bg-background/80 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-[0.35rem] text-muted-foreground">
                    Listen while you write
                  </p>
                  <h3 className="font-headline text-base uppercase tracking-[0.25rem] text-foreground">
                    Bandcamp
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Stream the latest featured release without waiting for an embed to load.
                  </p>
                </div>
                <Send className="h-5 w-5 text-destructive" aria-hidden />
              </div>
              <BandcampEmbed />
              <Link
                href={siteMetadata.socials.bandcamp ?? "https://remorselessrecords.bandcamp.com/"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-fit items-center gap-2 rounded-full border border-destructive/70 px-4 py-2 text-xs uppercase tracking-[0.25rem] text-destructive transition hover:border-destructive hover:text-foreground"
              >
                <BandcampGlyph />
                Support us on Bandcamp
              </Link>
            </div>

            <div className="space-y-3 rounded-2xl border border-border/60 bg-background/80 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-[0.35rem] text-muted-foreground">
                    Social
                  </p>
                  <h3 className="font-headline text-base uppercase tracking-[0.25rem] text-foreground">
                    Instagram signals
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Drop alerts, pressing photos, and live updates. Embedded preview is lazy-loaded.
                  </p>
                </div>
                <MessageCircle className="h-5 w-5 text-destructive" aria-hidden />
              </div>
              <Link
                href={siteMetadata.socials.instagram ?? "https://www.instagram.com/remorseless_records/"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-fit items-center gap-2 rounded-full border border-destructive/70 px-4 py-2 text-xs uppercase tracking-[0.25rem] text-destructive transition hover:border-destructive hover:text-foreground"
              >
                View on Instagram
              </Link>
            </div>
          </aside>
        </div>

        <section className="space-y-4 rounded-3xl border border-border/70 bg-surface/90 p-6 shadow-[0_28px_60px_-42px_rgba(0,0,0,0.8)]">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.35rem] text-muted-foreground">
                Stay connected
              </p>
              <h2 className="font-headline text-lg uppercase tracking-[0.3rem] text-foreground">
                Instagram feed
              </h2>
              <p className="text-sm text-muted-foreground">
                A rotating slice of recent posts. Tap to open the post directly.
              </p>
            </div>
          </div>
          <InstagramGrid profileUrl={siteMetadata.socials.instagram ?? "https://www.instagram.com/remorseless_records/"} />
        </section>
      </div>
    </div>
  )
}

export default ContactPage
