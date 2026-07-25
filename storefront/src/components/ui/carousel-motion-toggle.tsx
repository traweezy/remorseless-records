"use client"

import { Pause, Play } from "lucide-react"
import { memo } from "react"

import { Button } from "@/components/ui/button"

type CarouselMotionToggleProps = {
  carouselLabel: string
  isPaused: boolean
  onToggle: () => void
}

export const CarouselMotionToggle = memo<CarouselMotionToggleProps>(
  ({ carouselLabel, isPaused, onToggle }) => (
    <Button
      type="button"
      variant="outlined"
      size="compact"
      className="h-10 gap-2 rounded-full bg-background/90 px-4 text-[0.65rem] uppercase tracking-[0.16rem] shadow-card"
      aria-label={`${isPaused ? "Play" : "Pause"} ${carouselLabel}`}
      onClick={onToggle}
    >
      {isPaused ? (
        <Play className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Pause className="h-3.5 w-3.5" aria-hidden />
      )}
      {isPaused ? "Play motion" : "Pause motion"}
    </Button>
  )
)
CarouselMotionToggle.displayName = "CarouselMotionToggle"

export default CarouselMotionToggle
