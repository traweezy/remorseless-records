"use client"

import { useCallback, useEffect, useRef } from "react"

import {
  getCarouselAutoScroll,
  getCarouselNavigation,
  normalizeCarouselSlideRoles,
  type CarouselAutoScroll,
  type CarouselNavigation,
} from "@/components/ui/carousel"

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

type CarouselAutoScrollControls = {
  mount: (instance: unknown) => void
  destroy: () => void
  go: (destination: string | number) => void
}

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(REDUCED_MOTION_QUERY).matches

export const useCarouselAutoScroll = (): CarouselAutoScrollControls => {
  const navigationRef = useRef<CarouselNavigation | null>(null)
  const autoScrollRef = useRef<CarouselAutoScroll | null>(null)

  const mount = useCallback((instance: unknown) => {
    normalizeCarouselSlideRoles(instance)
    navigationRef.current = getCarouselNavigation(instance)
    autoScrollRef.current = getCarouselAutoScroll(instance)

    if (!autoScrollRef.current || prefersReducedMotion()) {
      autoScrollRef.current?.pause()
      return
    }

    autoScrollRef.current.play()
  }, [])

  const destroy = useCallback(() => {
    navigationRef.current = null
    autoScrollRef.current = null
  }, [])

  const go = useCallback((destination: string | number) => {
    navigationRef.current?.go(destination)
  }, [])

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return
    }

    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY)
    const handlePreferenceChange = (event: MediaQueryListEvent) => {
      const autoScroll = autoScrollRef.current
      if (!autoScroll) {
        return
      }

      if (event.matches) {
        autoScroll.pause()
      } else {
        autoScroll.play()
      }
    }

    mediaQuery.addEventListener("change", handlePreferenceChange)
    return () => {
      mediaQuery.removeEventListener("change", handlePreferenceChange)
    }
  }, [])

  return { mount, destroy, go }
}
