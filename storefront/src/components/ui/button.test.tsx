import { faker } from "@faker-js/faker"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import { Button } from "@/components/ui/button"

describe("Button", () => {
  beforeEach(() => {
    faker.seed(909)
  })

  it("renders as a native button with default styles", () => {
    const label = faker.word.words({ count: { min: 1, max: 3 } })
    render(<Button type="button">{label}</Button>)

    const button = screen.getByRole("button", { name: label })
    expect(button).toHaveClass("inline-flex")
    expect(button).toHaveClass("cursor-pointer")
    expect(button).toHaveClass("disabled:cursor-not-allowed")
    expect(button).toHaveClass("rounded-full")
  })

  it("renders as child element when asChild is enabled", () => {
    const label = faker.word.words({ count: { min: 1, max: 2 } })
    render(
      <Button asChild>
        <a href="/catalog">{label}</a>
      </Button>
    )

    const link = screen.getByRole("link", { name: label })
    expect(link).toHaveAttribute("href", "/catalog")
    expect(link).toHaveClass("inline-flex")
  })

  it("shares filled and outlined call-to-action variants", () => {
    render(
      <>
        <Button type="button" variant="filled">
          Filled action
        </Button>
        <Button type="button" variant="outlined">
          Outlined action
        </Button>
      </>
    )

    expect(screen.getByRole("button", { name: "Filled action" })).toHaveClass(
      "bg-destructive",
      "text-destructive-foreground"
    )
    expect(screen.getByRole("button", { name: "Outlined action" })).toHaveClass(
      "border-destructive/70",
      "text-destructive"
    )
  })

  it("preserves custom control dimensions with the auto size", () => {
    render(
      <Button
        type="button"
        variant="unstyled"
        size="auto"
        className="h-7 w-20 px-1"
      >
        Custom control
      </Button>
    )

    const button = screen.getByRole("button", { name: "Custom control" })
    expect(button).toHaveClass(
      "h-7",
      "w-20",
      "px-1"
    )
    expect(button).not.toHaveClass("h-11", "px-6")
  })
})
