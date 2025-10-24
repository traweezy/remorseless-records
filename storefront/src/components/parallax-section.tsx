"use client"

import { motion, useScroll, useTransform } from "framer-motion"
import { useRef } from "react"

import { cn } from "@/lib/ui/cn"

type ParallaxSectionProps = {
  children: React.ReactNode
  speed?: number
  className?: string
}

export const ParallaxSection = ({ children, speed = 0.3, className }: ParallaxSectionProps) => {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  })

  const translateY = useTransform(scrollYProgress, [0, 1], [0, speed * -120])

  return (
    <div ref={ref} className={cn("relative", className)}>
      <motion.div style={{ y: translateY }}>{children}</motion.div>
    </div>
  )
}

export default ParallaxSection
