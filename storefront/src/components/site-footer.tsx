import Link from "next/link"

const CURRENT_YEAR = new Date().getUTCFullYear()

const FOOTER_LINKS = [
  {
    title: "Label",
    links: [
      { label: "About", href: "/about" },
      { label: "Submissions", href: "/submissions" },
      { label: "Press", href: "/press" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "FAQ", href: "/help" },
      { label: "Shipping & Returns", href: "/help/shipping" },
      { label: "Contact", href: "mailto:support@remorselessrecords.com" },
    ],
  },
  {
    title: "Follow",
    links: [
      { label: "Instagram", href: "https://www.instagram.com/remorseless_records/" },
      { label: "Bandcamp", href: "https://remorselessrecords.bandcamp.com/" },
      { label: "Contact", href: "/contact" },
    ],
  },
]

const SiteFooter = () => (
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
          © {CURRENT_YEAR} Remorseless Records
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
                  <Link
                    href={link.href}
                    className="interactive rounded-md px-1 py-0.5 text-muted-foreground hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  </footer>
)

export default SiteFooter
