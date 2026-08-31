import { ChevronLeft, ChevronRight } from "lucide-react"
import { memo, type ReactElement } from "react"

const CarouselArrowsComponent = (): ReactElement => (
  <div className="splide__arrows product-carousel__arrows">
    <button
      type="button"
      className="splide__arrow splide__arrow--prev product-carousel__arrow product-carousel__arrow--left"
      aria-label="Previous slide"
    >
      <ChevronLeft aria-hidden="true" />
    </button>
    <button
      type="button"
      className="splide__arrow splide__arrow--next product-carousel__arrow product-carousel__arrow--right"
      aria-label="Next slide"
    >
      <ChevronRight aria-hidden="true" />
    </button>
  </div>
)

export const CarouselArrows = memo(CarouselArrowsComponent)
CarouselArrows.displayName = "CarouselArrows"
