export type CarouselNavigation = {
  go: (destination: string | number) => void
}

type SplideLike = {
  go?: (destination: string | number) => void
  root?: HTMLElement
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
