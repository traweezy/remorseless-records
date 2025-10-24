import Link from "next/link"

import { StaticNoise } from "@/components/static-noise"
import { ParallaxSection } from "@/components/parallax-section"
import { Button } from "@/components/ui/button"
import { ChevronRight } from "lucide-react"

export const HeroSection = () => (
  <section className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-gradient-hero pt-20">
    <StaticNoise />
    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,hsl(0_80%_20%/0.6),transparent_65%)]" />
    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_35%,rgba(0,0,0,0.65)_95%)]" />
    <div className="pointer-events-none absolute inset-0 opacity-20 mix-blend-soft-light bg-[repeating-linear-gradient(180deg,rgba(255,255,255,0.03)_0,rgba(255,255,255,0.03)_1px,transparent_1px,transparent_3px)]" />

    <ParallaxSection speed={0.3} className="relative z-10 w-full">
      <div className="flex w-full flex-col items-center gap-12 px-6 text-center sm:px-12">
        <span className="text-sm font-medium uppercase tracking-[0.4rem] text-muted-foreground">
          Remorseless Records Worldwide
        </span>

        <div className="relative inline-block">
          <div className="absolute inset-0 blur-3xl bg-destructive/30 animate-glow-pulse" />
          <img
            src="/remorseless-hero-logo.png"
            alt="Remorseless Records"
            className="relative mx-auto w-full max-w-3xl drop-shadow-[0_0_60px_hsl(0_100%_50%/0.9)]"
            draggable={false}
          />
        </div>

        <div className="space-y-6">
          <p className="font-bebas text-5xl tracking-[0.8rem] text-accent drop-shadow-[0_0_25px_hsl(0_100%_50%/0.75)] sm:text-6xl md:text-7xl lg:text-8xl">
            DEATH.&nbsp;DOOM.&nbsp;GRIND.
          </p>
          <p className="font-teko text-3xl font-semibold uppercase tracking-[0.55rem] text-muted-foreground md:text-4xl">
            We ship the underground worldwide.
          </p>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
          <Button asChild size="lg" className="px-10 py-6 text-lg">
            <Link href="/products" className="inline-flex items-center">
              VIEW CATALOG
              <ChevronRight className="ml-2 h-5 w-5" />
            </Link>
          </Button>
        </div>
      </div>
    </ParallaxSection>
  </section>
)

export default HeroSection
