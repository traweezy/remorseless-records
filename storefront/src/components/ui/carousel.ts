export type CarouselNavigation = {
  go: (destination: string | number) => void
}

export type CarouselAutoScroll = {
  play: () => void
  pause: () => void
  isPaused: () => boolean
}

type SplideLike = {
  go?: (destination: string | number) => void
  root?: HTMLElement
  Components?: {
    AutoScroll?: CarouselAutoScroll
  }
}

const toSplideLike = (instance: unknown): SplideLike | null => {
  if (!instance || typeof instance !== "object") {
    return null
  }

  return instance
}

export const getCarouselNavigation = (
  instance: unknown
): CarouselNavigation | null => {
  const candidate = toSplideLike(instance)
  if (!candidate?.go) {
    return null
  }

  return { go: candidate.go.bind(candidate) }
}

export const getCarouselAutoScroll = (
  instance: unknown
): CarouselAutoScroll | null =>
  toSplideLike(instance)?.Components?.AutoScroll ?? null

export const normalizeCarouselSlideRoles = (instance: unknown): void => {
  const root = toSplideLike(instance)?.root
  if (!root) {
    return
  }

  root.querySelectorAll<HTMLElement>(".splide__list").forEach((list) => {
    list.setAttribute("role", "list")
  })
  root.querySelectorAll<HTMLElement>(".splide__slide").forEach((slide) => {
    slide.setAttribute("role", "listitem")
  })
}
