"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"

type InstagramPost = {
  url: string
  alt: string
  img: string
}

const ALL_POSTS: InstagramPost[] = [
  {
    url: "https://www.instagram.com/p/C4rQgDcpjmk/",
    alt: "Pressing photo on Instagram",
    img: "/instagram/rr-1.jpg",
  },
  {
    url: "https://www.instagram.com/p/C33z0sWNJpl/",
    alt: "Merch drop teaser on Instagram",
    img: "/instagram/rr-2.jpg",
  },
  {
    url: "https://www.instagram.com/p/C2mQit_Jwz6/",
    alt: "Studio shot on Instagram",
    img: "/instagram/rr-3.jpg",
  },
  {
    url: "https://www.instagram.com/p/C1fVyVho5J8/",
    alt: "Live set highlight on Instagram",
    img: "/instagram/rr-4.jpg",
  },
  {
    url: "https://www.instagram.com/p/C0YjYfDJA_F/",
    alt: "Vinyl close-up on Instagram",
    img: "/instagram/rr-5.jpg",
  },
  {
    url: "https://www.instagram.com/p/CxgltApOSV1/",
    alt: "Cassette stack on Instagram",
    img: "/instagram/rr-6.jpg",
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
  const [mounted, setMounted] = useState(false)
  const [posts, setPosts] = useState<InstagramPost[]>([])

  useEffect(() => {
    // Safe client-only hydration toggle; renders placeholder on the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)

    const shuffled = [...ALL_POSTS].sort(() => Math.random() - 0.5)
    setPosts(shuffled.slice(0, 6))
  }, [])

  const skeletonItems = useMemo(() => Array.from({ length: 4 }, (_, index) => index), [])

  if (!mounted) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {skeletonItems.map((index) => (
          <div
            key={index}
            className="h-[200px] w-full rounded-2xl border border-border/60 bg-background/60"
          />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3" aria-label="Latest posts from Instagram">
      <div className="grid gap-3 sm:grid-cols-2">
        {posts.map((post) => (
          <Link
            key={post.url}
            href={post.url}
            target="_blank"
            rel="noreferrer"
            className="group relative block overflow-hidden rounded-2xl border border-border/60 bg-background/80"
          >
            <Image
              src={post.img}
              alt={post.alt}
              width={400}
              height={400}
              className="h-[200px] w-full object-cover transition-transform duration-200 group-hover:scale-105"
            />
            <div className="pointer-events-none absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/70 via-black/10 to-transparent px-3 py-2 text-xs uppercase tracking-[0.25rem] text-white opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
              View
            </div>
          </Link>
        ))}
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
