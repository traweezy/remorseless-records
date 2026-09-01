"use client"

import {
  memo,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react"
import { Music2 } from "lucide-react"

import { useCookieConsent } from "@/components/legal/cookie-consent-provider"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/ui/cn"

const DEFAULT_ALBUM_ID = "2916008899"
const DEFAULT_ALBUM_SLUG = "samudaripen"

export const normalizeBandcampAlbumId = (
  value: string | null | undefined
): string => {
  const trimmed = value?.trim() ?? ""
  return /^\d{1,20}$/.test(trimmed) ? trimmed : DEFAULT_ALBUM_ID
}

export const normalizeBandcampAlbumSlug = (
  value: string | null | undefined
): string => {
  const trimmed = value?.trim().toLowerCase() ?? ""
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)
    ? trimmed
    : DEFAULT_ALBUM_SLUG
}

const albumId = normalizeBandcampAlbumId(
  process.env.NEXT_PUBLIC_BANDCAMP_ALBUM_ID
)
const albumSlug = normalizeBandcampAlbumSlug(
  process.env.NEXT_PUBLIC_BANDCAMP_ALBUM_SLUG
)

const bandcampAlbumUrl = `https://remorselessrecords.bandcamp.com/album/${albumSlug}`
const compactPlayerQuery = "(max-width: 639px)"

const buildBandcampEmbedUrl = (size: "large" | "small"): string =>
  `https://bandcamp.com/EmbeddedPlayer/album=${albumId}/` +
  `size=${size}/bgcol=111111/linkcol=e73939/transparent=true/`

const subscribeToCompactPlayer = (onChange: () => void): (() => void) => {
  if (typeof window === "undefined" || !window.matchMedia) {
    return () => {}
  }

  const query = window.matchMedia(compactPlayerQuery)
  query.addEventListener("change", onChange)

  return () => {
    query.removeEventListener("change", onChange)
  }
}

const getCompactPlayerSnapshot = (): boolean =>
  typeof window === "undefined" || !window.matchMedia
    ? true
    : window.matchMedia(compactPlayerQuery).matches

type BandcampEmbedProps = {
  className?: string
}

const BandcampEmbed = memo<BandcampEmbedProps>(({ className }) => {
  const [hasMounted, setHasMounted] = useState(false)
  const { isHydrated, preferences, saveSelection } = useCookieConsent()
  const compactPlayer = useSyncExternalStore(
    subscribeToCompactPlayer,
    getCompactPlayerSnapshot,
    () => true
  )

  const enablePlayer = useCallback(() => {
    saveSelection({
      analytics: preferences.analytics,
      marketing: true,
    })
  }, [preferences.analytics, saveSelection])

  useEffect(() => {
    setHasMounted(true)
  }, [])

  if (!hasMounted || !isHydrated) {
    return (
      <div
        className={className}
        aria-label="Loading Bandcamp player"
        role="status"
      >
        <div className="h-[42px] w-full rounded-2xl skeleton sm:h-[520px]" />
      </div>
    )
  }

  if (!preferences.marketing) {
    return (
      <Card
        variant="inset"
        className={cn(
          "flex min-h-48 flex-col items-center justify-center gap-4 p-5 text-center",
          className
        )}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-destructive/50 bg-destructive/10 text-destructive">
          <Music2 className="h-5 w-5" aria-hidden />
        </span>
        <div className="max-w-sm space-y-2">
          <p className="font-semibold text-foreground">
            Bandcamp player paused
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Enable external media to stream the featured release here.
          </p>
        </div>
        <Button
          type="button"
          variant="outlined"
          size="compact"
          onClick={enablePlayer}
        >
          Enable Bandcamp player
        </Button>
      </Card>
    )
  }

  return (
    <Card
      variant="inset"
      className={cn("flex flex-col overflow-hidden p-0", className)}
    >
      <iframe
        title="Featured Remorseless Records release on Bandcamp"
        src={buildBandcampEmbedUrl(compactPlayer ? "small" : "large")}
        className={cn(
          "block w-full border-0",
          compactPlayer ? "h-[42px]" : "h-[520px]"
        )}
        loading="lazy"
        allow="encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
      />
      <a
        href={bandcampAlbumUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-11 items-center justify-center border-t border-border/60 px-4 text-sm font-semibold text-foreground underline decoration-destructive underline-offset-4"
      >
        Open on Bandcamp
      </a>
    </Card>
  )
})

BandcampEmbed.displayName = "BandcampEmbed"

export default BandcampEmbed
