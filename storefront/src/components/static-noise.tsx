"use client"

import { useEffect, useRef } from "react"

const FPS = 24
const FRAME_INTERVAL = 1000 / FPS

export const StaticNoise = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const context = canvas.getContext("2d")
    if (!context) {
      return
    }

    const resizeCanvas = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    resizeCanvas()
    window.addEventListener("resize", resizeCanvas)

    let frameId: number
    let lastTime = 0

    const render = (time: number) => {
      const delta = time - lastTime

      if (delta >= FRAME_INTERVAL) {
        lastTime = time - (delta % FRAME_INTERVAL)

        const { width, height } = canvas
        const imageData = context.createImageData(width, height)
        const buffer = imageData.data

        for (let index = 0; index < buffer.length; index += 4) {
          const white = Math.random() > 0.5 ? 255 : 0
          const alpha = Math.random() * 80 + 20

          buffer[index] = white
          buffer[index + 1] = white
          buffer[index + 2] = white
          buffer[index + 3] = alpha
        }

        context.putImageData(imageData, 0, 0)
      }

      frameId = requestAnimationFrame(render)
    }

    frameId = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener("resize", resizeCanvas)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full opacity-40"
      style={{ mixBlendMode: "screen" }}
      aria-hidden
    />
  )
}

export default StaticNoise
