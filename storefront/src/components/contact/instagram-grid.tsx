"use client"

import { useMemo, useState } from "react"
import Link from "next/link"

const INSTAGRAM_POSTS = [
  {
    url: "https://www.instagram.com/p/C4rQgDcpjmk/",
    alt: "Pressing photo on Instagram",
  },
  {
    url: "https://www.instagram.com/p/C33z0sWNJpl/",
    alt: "Merch drop teaser on Instagram",
  },
  {
    url: "https://www.instagram.com/p/C2mQit_Jwz6/",
    alt: "Studio shot on Instagram",
  },
  {
    url: "https://www.instagram.com/p/C1fVyVho5J8/",
    alt: "Live set highlight on Instagram",
  },
  {
    url: "https://www.instagram.com/p/C0YjYfDJA_F/",
    alt: "Vinyl close-up on Instagram",
  },
  {
    url: "https://www.instagram.com/p/CxgltApOSV1/",
    alt: "Cassette stack on Instagram",
  },
]

const InstagramGlyph = () => (
  <svg
    aria-hidden="true"
    role="img"
    viewBox="0 0 24 24"
    className="h-4 w-4"
    fill="currentColor"
  >
    <path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7Zm5 3.5A4.5 4.5 0 1 1 7.5 12 4.51 4.51 0 0 1 12 7.5Zm0 2A2.5 2.5 0 1 0 14.5 12 2.5 2.5 0 0 0 12 9.5Zm5.75-3.75a1.25 1.25 0 1 1-1.25 1.25A1.25 1.25 0 0 1 17.75 5.75Z" />
  </svg>
)

type Props = {
  profileUrl: string
}

const InstagramGrid = ({ profileUrl }: Props) => {
  const [errored, setErrored] = useState(false)

  const posts = useMemo(() => INSTAGRAM_POSTS.slice(0, 6), [])

  if (errored) {
    return (
      <div className="space-y-3 rounded-2xl border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
        <p>Instagram feed is unavailable right now.</p>
        <Link
          href={profileUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-2 rounded-full border border-destructive/70 px-4 py-2 text-xs uppercase tracking-[0.25rem] text-destructive transition hover:border-destructive hover:text-foreground"
        >
          <InstagramGlyph />
          Open Instagram
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-3" aria-label="Latest posts from Instagram">
      <div className="grid gap-3 sm:grid-cols-2">
        {posts.map((post) => {
          const embedSrc = `${post.url}embed`
          return (
            <div
              key={post.url}
              className="group relative overflow-hidden rounded-2xl border border-border/60 bg-background/80"
            >
              <iframe
                src={embedSrc}
                title={post.alt}
                loading="lazy"
                className="h-[200px] w-full"
                onError={() => setErrored(true)}
              />
              <Link
                href={post.url}
                target="_blank"
                rel="noreferrer"
                className="pointer-events-auto absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/70 via-black/10 to-transparent px-3 py-2 text-xs uppercase tracking-[0.25rem] text-white opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100"
              >
                <span className="flex items-center gap-2">
                  <InstagramGlyph />
                  View
                </span>
              </Link>
            </div>
          )
        })}
      </div>
      <Link
        href={profileUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex w-fit items-center gap-2 rounded-full border border-destructive/70 px-4 py-2 text-xs uppercase tracking-[0.25rem] text-destructive transition hover:border-destructive hover:text-foreground"
      >
        <InstagramGlyph />
        View on Instagram
      </Link>
    </div>
  )
}

export default InstagramGrid
