"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

type Options = {
  selector?: string
  radius?: number
}

const DEFAULT_SELECTOR = "a[data-prefetch='true']"
const DEFAULT_RADIUS = 100

export const useProximityPrefetch = (
  { selector = DEFAULT_SELECTOR, radius = DEFAULT_RADIUS }: Options = {}
) => {
  const router = useRouter()

  useEffect(() => {
    const seen = new Set<string>()
    let frame: number | null = null

    const handlePointerMove = (event: PointerEvent) => {
      if (frame) {
        cancelAnimationFrame(frame)
      }

      frame = requestAnimationFrame(() => {
        const target = event.target as Element | null
        if (!target) {
          return
        }

        const anchor = target.closest<HTMLAnchorElement>(selector)
        if (!anchor) {
          return
        }

        const href = anchor.getAttribute("href")
        if (!href || seen.has(href)) {
          return
        }

        const rect = anchor.getBoundingClientRect()
        const { clientX, clientY } = event
        const withinX =
          clientX >= rect.left - radius && clientX <= rect.right + radius
        const withinY =
          clientY >= rect.top - radius && clientY <= rect.bottom + radius

        if (withinX && withinY) {
          seen.add(href)
          try {
            router.prefetch(href)
          } catch {
            // Ignore failures
          }
        }
      })
    }

    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    })

    return () => {
      if (frame) {
        cancelAnimationFrame(frame)
      }
      window.removeEventListener("pointermove", handlePointerMove)
    }
  }, [router, selector, radius])
}

export default useProximityPrefetch
