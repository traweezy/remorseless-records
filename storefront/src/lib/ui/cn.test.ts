import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it } from "vitest"

import { cn } from "@/lib/ui/cn"

describe("cn", () => {
  beforeEach(() => {
    faker.seed(3001)
  })

  it("merges conditional classes and resolves Tailwind conflicts", () => {
    const fontClass = faker.helpers.arrayElement(["font-bold", "font-medium"])
    const result = cn(
      "px-2",
      undefined,
      false,
      ["text-sm", null],
      { [fontClass]: true, hidden: false },
      "px-4"
    )

    expect(result).toBe(`text-sm ${fontClass} px-4`)
  })
})
