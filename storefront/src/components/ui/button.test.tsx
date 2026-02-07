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
})
