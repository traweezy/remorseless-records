import type { Metadata } from "next"

import { siteMetadata } from "@/config/site"

export const metadata: Metadata = {
  title: "Press",
  description: "Press resources, label story, and contacts for Remorseless Records.",
}

const ASSETS = [
  {
    title: "Logo pack",
    detail: "PNG + SVG on dark/light, sized for web and print.",
  },
  {
    title: "Founder statement",
    detail: "Short history, mission, and format philosophy.",
  },
  {
    title: "Press shots",
    detail: "Label imagery and product hero shots, ready for editorial use.",
  },
]

const PressPage = () => (
  <div className="bg-background">
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-10 px-4 pb-16 pt-12 lg:px-8">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.35rem] text-muted-foreground">
          Press
        </p>
        <h1 className="font-display text-5xl uppercase tracking-[0.3rem] text-foreground">
          Media resources
        </h1>
        <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">
          Pull the essentials for features, interviews, and playlists. If you need something tailored, reach out and we’ll turn it around fast.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
        <section className="space-y-6 rounded-3xl border border-border/70 bg-surface/90 p-6 shadow-[0_28px_60px_-42px_rgba(0,0,0,0.8)]">
          <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
            Assets
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {ASSETS.map((asset) => (
              <div
                key={asset.title}
                className="rounded-2xl border border-border/60 bg-background/80 p-4"
              >
                <p className="font-semibold uppercase tracking-[0.25rem] text-foreground">
                  {asset.title}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {asset.detail}
                </p>
                <p className="mt-3 text-[0.7rem] uppercase tracking-[0.28rem] text-destructive">
                  Available on request
                </p>
              </div>
            ))}
          </div>
        </section>

        <aside className="space-y-4 rounded-3xl border border-border/70 bg-surface/90 p-6 shadow-[0_28px_60px_-42px_rgba(0,0,0,0.8)]">
          <h2 className="font-headline text-sm uppercase tracking-[0.35rem] text-foreground">
            Contact for press
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Email{" "}
            <a
              href={`mailto:${siteMetadata.contact.email}`}
              className="text-destructive underline underline-offset-4"
            >
              {siteMetadata.contact.email}
            </a>{" "}
            for interviews, premieres, or review copies. Include your outlet, timelines, and any asset needs.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Need images or liner notes fast? The Contact page form goes straight to the label inbox.
          </p>
        </aside>
      </div>
    </div>
  </div>
)

export default PressPage
