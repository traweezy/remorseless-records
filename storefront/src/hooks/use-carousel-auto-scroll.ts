"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  getCarouselAutoScroll,
  getCarouselNavigation,
  normalizeCarouselSlideRoles,
  type CarouselAutoScroll,
  type CarouselNavigation,
} from "@/components/ui/carousel"

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

type CarouselAutoScrollControls = {
  isPaused: boolean
  mount: (instance: unknown) => void
  destroy: () => void
  go: (destination: string | number) => void
  toggle: () => void
}

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia(REDUCED_MOTION_QUERY).matches

export const useCarouselAutoScroll = (): CarouselAutoScrollControls => {
  const navigationRef = useRef<CarouselNavigation | null>(null)
  const autoScrollRef = useRef<CarouselAutoScroll | null>(null)
  const manuallyPausedRef = useRef(false)
  const [isPaused, setIsPaused] = useState(true)

  const mount = useCallback((instance: unknown) => {
    normalizeCarouselSlideRoles(instance)
    navigationRef.current = getCarouselNavigation(instance)
    autoScrollRef.current = getCarouselAutoScroll(instance)

    if (
      !autoScrollRef.current ||
      prefersReducedMotion() ||
      manuallyPausedRef.current
    ) {
      autoScrollRef.current?.pause()
      setIsPaused(true)
      return
    }

    autoScrollRef.current.play()
    setIsPaused(false)
  }, [])

  const destroy = useCallback(() => {
    navigationRef.current = null
    autoScrollRef.current = null
  }, [])

  const go = useCallback((destination: string | number) => {
    navigationRef.current?.go(destination)
  }, [])

  const toggle = useCallback(() => {
    const autoScroll = autoScrollRef.current
    if (!autoScroll) {
      return
    }

    if (isPaused) {
      manuallyPausedRef.current = false
      autoScroll.play()
      setIsPaused(false)
      return
    }

    manuallyPausedRef.current = true
    autoScroll.pause()
    setIsPaused(true)
  }, [isPaused])

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
        setIsPaused(true)
      } else if (!manuallyPausedRef.current) {
        autoScroll.play()
        setIsPaused(false)
      }
    }

    mediaQuery.addEventListener("change", handlePreferenceChange)
    return () => {
      mediaQuery.removeEventListener("change", handlePreferenceChange)
    }
  }, [])

  return { isPaused, mount, destroy, go, toggle }
}
