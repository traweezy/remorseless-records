import type { Metadata } from "next"
import Link from "next/link"
import { Mail, Phone, Send, Share2 } from "lucide-react"

import ContactForm from "@/components/contact/contact-form"
import { siteMetadata } from "@/config/site"

export const metadata: Metadata = {
  title: "Contact",
  description: "Reach Remorseless Records for releases, distro, and press. Expect fast replies.",
}

const socials = [
  {
    label: "Instagram",
    href: siteMetadata.socials.instagram ?? "https://www.instagram.com/remorseless_records/",
    icon: <Share2 className="h-4 w-4" aria-hidden />,
    copy: "Follow drops and pressing updates.",
  },
  {
    label: "Bandcamp",
    href: siteMetadata.socials.bandcamp ?? "https://remorselessrecords.bandcamp.com/",
    icon: <Send className="h-4 w-4" aria-hidden />,
    copy: "Stream the catalog and support direct.",
  },
]

const ContactPage = () => {
  return (
    <div className="bg-background">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-10 px-4 pb-16 pt-12 lg:px-8">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.35rem] text-muted-foreground">
            Contact
          </p>
          <h1 className="font-display text-5xl uppercase tracking-[0.3rem] text-foreground">
            Drop a line
          </h1>
          <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">
            Submissions, distro inquiries, press, or support—this form goes straight to the label inbox. Expect a reply within 1–2 business days.
          </p>
        </header>

        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          <ContactForm />

          <aside className="space-y-4 rounded-3xl border border-border/70 bg-surface/90 p-6 shadow-[0_28px_60px_-42px_rgba(0,0,0,0.8)]">
            <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
              Direct lines
            </h2>
            <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-destructive" aria-hidden />
                <a
                  href={`mailto:${siteMetadata.contact.email}`}
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  {siteMetadata.contact.email}
                </a>
              </p>
              <p className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-destructive" aria-hidden />
                <span>{siteMetadata.contact.phone}</span>
              </p>
              <div className="rounded-2xl border border-border/60 bg-background/80 p-4">
                <p className="text-[0.7rem] uppercase tracking-[0.3rem] text-muted-foreground">
                  Address
                </p>
                <p className="mt-1 text-sm text-foreground">
                  {siteMetadata.contact.address.street}
                  <br />
                  {siteMetadata.contact.address.locality}, {siteMetadata.contact.address.region}{" "}
                  {siteMetadata.contact.address.postalCode}
                  <br />
                  {siteMetadata.contact.address.country}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
                Socials
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {socials.map((social) => (
                  <Link
                    key={social.label}
                    href={social.href}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex flex-col gap-2 rounded-2xl border border-border/60 bg-background/80 p-4 transition hover:border-destructive/70"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold uppercase tracking-[0.25rem] text-foreground">
                        {social.label}
                      </p>
                      <span className="text-destructive">{social.icon}</span>
                    </div>
                    <p className="text-xs text-muted-foreground group-hover:text-foreground">
                      {social.copy}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

export default ContactPage
