import Link from "next/link"

const FOOTER_LINKS = [
  {
    title: "Label",
    links: [
      { label: "About", href: "/about" },
      { label: "Submissions", href: "/submissions" },
      { label: "Press", href: "/press" },
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
      { label: "Instagram", href: "https://instagram.com" },
      { label: "Bandcamp", href: "https://bandcamp.com" },
      { label: "Discord", href: "https://discord.gg" },
    ],
  },
]

const SiteFooter = () => (
  <footer className="mt-24 border-t-4 border-accent/80 bg-background/95 py-12">
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 text-sm text-muted-foreground md:flex-row md:justify-between">
      <div className="space-y-3 max-w-sm">
        <span className="font-headline text-xs uppercase tracking-[0.45rem] text-accent">
          Remorseless Records
        </span>
        <p className="text-xs leading-relaxed">
          Brutal maximalism across every pressing. Limited runs, no compromises, all volume. Join the signal and never miss another drop.
        </p>
        <p className="text-[0.65rem] uppercase tracking-[0.3rem] text-muted-foreground/70">
          © {new Date().getFullYear()} Remorseless Records
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
                    className="transition hover:text-accent"
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
