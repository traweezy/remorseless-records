import { fireEvent, render, screen } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"

import { CheckoutErrorSummary } from "@/features/checkout/components/checkout-error-summary"

describe("CheckoutErrorSummary", () => {
  it("receives focus and directs shoppers to an invalid field", () => {
    const summaryRef = createRef<HTMLDivElement>()
    const onFocusField = vi.fn((field: string) => {
      document.getElementById(field)?.focus()
    })

    render(
      <>
        <input id="postal_code" aria-label="ZIP code" />
        <CheckoutErrorSummary
          ref={summaryRef}
          errors={[
            {
              field: "postal_code",
              label: "ZIP code",
              message: "Enter a valid ZIP code.",
            },
          ]}
          onFocusField={onFocusField}
        />
      </>
    )

    summaryRef.current?.focus()
    expect(summaryRef.current).toHaveFocus()

    fireEvent.click(
      screen.getByRole("button", {
        name: "ZIP code: Enter a valid ZIP code.",
      })
    )

    expect(onFocusField).toHaveBeenCalledWith("postal_code")
    expect(screen.getByLabelText("ZIP code")).toHaveFocus()
  })
})
