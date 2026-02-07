import { siBandcamp, siInstagram } from "simple-icons"
import SmartLink from "@/components/ui/smart-link"

type FooterLink = {
  label: string
  href: string
  iconPath?: string
}

type FooterLinkSection = {
  title: string
  links: FooterLink[]
}

const FOOTER_LINKS: FooterLinkSection[] = [
  {
    title: "Label",
    links: [
      { label: "About", href: "/about" },
      { label: "Submissions", href: "/submissions" },
      { label: "Discography", href: "/discography" },
      { label: "News", href: "/news" },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "FAQ", href: "/faq" },
      { label: "Shipping & Returns", href: "/help/shipping" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Follow",
    links: [
      {
        label: "Instagram",
        href: "https://www.instagram.com/remorseless_records/",
        iconPath: siInstagram.path,
      },
      {
        label: "Bandcamp",
        href: "https://remorselessrecords.bandcamp.com/",
        iconPath: siBandcamp.path,
      },
    ],
  },
]

const SocialIcon = ({ path }: { path: string | undefined }) => {
  if (!path) {
    return null
  }

  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 24 24"
      className="h-4 w-4 text-current"
      role="img"
    >
      <path d={path} fill="currentColor" />
    </svg>
  )
}

const SiteFooter = () => {
  const currentYear = process.env.NEXT_PUBLIC_BUILD_YEAR ?? "2025"

  return (
    <footer className="relative z-20 mt-16 border-t-4 border-accent/80 bg-background py-12">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 text-sm text-muted-foreground md:flex-row md:justify-between">
        <div className="space-y-3 max-w-sm">
          <span className="font-headline text-xs uppercase tracking-[0.45rem] text-accent">
            Remorseless Records
          </span>
          <p className="text-xs leading-relaxed">
            Brutal maximalism across every pressing. Limited runs, no compromises, all volume. Join the signal and never miss another drop.
          </p>
          <p className="text-[0.65rem] uppercase tracking-[0.3rem] text-muted-foreground/70">
            © {currentYear} Remorseless Records
          </p>
        </div>
        <div className="grid gap-8 sm:grid-cols-3">
          {FOOTER_LINKS.map((section) => (
            <div key={section.title} className="space-y-3">
              <p className="font-headline text-xs uppercase tracking-[0.35rem] text-foreground">
                {section.title}
              </p>
              <ul className="space-y-2 text-xs uppercase tracking-[0.3rem]">
                {section.links.map((link) => (
                  <li key={link.label}>
                    {link.href.startsWith("http") ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="interactive inline-flex items-center gap-2 rounded-md px-1 py-0.5 text-muted-foreground hover:text-foreground"
                      >
                        <SocialIcon path={link.iconPath} />
                        {link.label}
                      </a>
                    ) : (
                      <SmartLink
                        href={link.href}
                        nativePrefetch
                        className="interactive inline-flex items-center gap-2 rounded-md px-1 py-0.5 text-muted-foreground hover:text-foreground"
                      >
                        <SocialIcon path={link.iconPath} />
                        {link.label}
                      </SmartLink>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </footer>
  )
}

export default SiteFooter
