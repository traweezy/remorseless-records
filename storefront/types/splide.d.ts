declare module "@splidejs/react-splide" {
  import type { ComponentType, ReactNode } from "react"

  export type SplideAutoScrollOptions = {
    speed?: number
    autoStart?: boolean
    pauseOnHover?: boolean
    pauseOnFocus?: boolean
    rewind?: boolean
    [key: string]: unknown
  }

  export type SplideOptions = {
    [key: string]: unknown
    autoScroll?: SplideAutoScrollOptions
  }

  export type SplideProps = {
    children?: ReactNode
    className?: string
    id?: string
    hasTrack?: boolean
    options?: SplideOptions
    extensions?: Record<string, unknown>
    [key: string]: unknown
  }

  export type SplideSlideProps = {
    className?: string
    children?: ReactNode
    [key: string]: unknown
  }

  export const Splide: ComponentType<SplideProps>
  export const SplideSlide: ComponentType<SplideSlideProps>
  export const SplideTrack: ComponentType<SplideSlideProps>
}

declare module "@splidejs/splide-extension-auto-scroll" {
  export const AutoScroll: Record<string, unknown>
}
