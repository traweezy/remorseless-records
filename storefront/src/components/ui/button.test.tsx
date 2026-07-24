import { faker } from "@faker-js/faker"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

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
    expect(button).toHaveClass("data-[disabled=true]:cursor-not-allowed")
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

  it("keeps native disabled buttons inert", () => {
    const handleClick = vi.fn()
    render(
      <Button type="button" disabled onClick={handleClick}>
        Unavailable action
      </Button>
    )

    const button = screen.getByRole("button", {
      name: "Unavailable action",
    })
    fireEvent.pointerDown(button)
    fireEvent.click(button)

    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("aria-disabled", "true")
    expect(button).toHaveAttribute("data-disabled", "true")
    expect(handleClick).not.toHaveBeenCalled()
  })

  it("makes disabled child links unfocusable and non-interactive", () => {
    const handleButtonClick = vi.fn()
    const handleLinkClick = vi.fn()
    const handleParentClick = vi.fn()

    document.addEventListener("click", handleParentClick)
    render(
      <Button asChild disabled onClick={handleButtonClick}>
        <a href="/catalog" onClick={handleLinkClick}>
          Disabled catalog link
        </a>
      </Button>
    )

    const link = screen.getByRole("link", {
      name: "Disabled catalog link",
    })
    fireEvent.pointerDown(link)
    fireEvent.click(link)
    document.removeEventListener("click", handleParentClick)

    expect(link).toHaveAttribute("href", "/catalog")
    expect(link).toHaveAttribute("aria-disabled", "true")
    expect(link).toHaveAttribute("data-disabled", "true")
    expect(link).toHaveAttribute("tabindex", "-1")
    expect(handleButtonClick).not.toHaveBeenCalled()
    expect(handleLinkClick).not.toHaveBeenCalled()
    expect(handleParentClick).not.toHaveBeenCalled()
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
    expect(button).toHaveClass("h-7", "w-20", "px-1")
    expect(button).not.toHaveClass("h-11", "px-6")
  })
})
