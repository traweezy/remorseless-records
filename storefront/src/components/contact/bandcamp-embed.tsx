"use client"

import { useEffect, useState } from "react"

const DEFAULT_ALBUM_ID = "2916008899"
const DEFAULT_ALBUM_SLUG = "samudaripen"

const ALBUM_ID = process.env.NEXT_PUBLIC_BANDCAMP_ALBUM_ID ?? DEFAULT_ALBUM_ID
const ALBUM_SLUG = process.env.NEXT_PUBLIC_BANDCAMP_ALBUM_SLUG ?? DEFAULT_ALBUM_SLUG

const BANDCAMP_EMBED_SRC = `https://bandcamp.com/EmbeddedPlayer/album=${ALBUM_ID}/size=large/bgcol=333333/linkcol=e32c14/transparent=true/`

const BANDCAMP_LINK = `https://remorselessrecords.bandcamp.com/album/${ALBUM_SLUG}`

const BandcampEmbed = () => {
  const [errored, setErrored] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // Safe client-only hydration toggle; renders placeholder on the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div
        className="w-full max-w-[700px] rounded-2xl border border-border/60 bg-background/60"
        style={{ height: "clamp(360px, 55vw, 620px)", margin: "0 auto" }}
      />
    )
  }

  if (errored) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground">
        <p>Bandcamp player is unavailable right now.</p>
        <a
          href={BANDCAMP_LINK}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-2 rounded-full border border-destructive/70 px-4 py-2 text-xs uppercase tracking-[0.25rem] text-destructive transition hover:border-destructive hover:text-foreground"
        >
          Open on Bandcamp
        </a>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-background/80">
      <iframe
        title="Bandcamp player"
        style={{
          border: "0",
          width: "100%",
          maxWidth: "700px",
          height: "clamp(360px, 55vw, 620px)",
          display: "block",
          margin: "0 auto",
        }}
        src={BANDCAMP_EMBED_SRC}
        seamless
        loading="lazy"
        onError={() => setErrored(true)}
      >
        <a href={BANDCAMP_LINK}>Open on Bandcamp</a>
      </iframe>
    </div>
  )
}

export default BandcampEmbed
