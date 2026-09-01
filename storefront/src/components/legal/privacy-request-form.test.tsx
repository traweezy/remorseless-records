import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import PrivacyRequestForm from "@/components/legal/privacy-request-form"

const requestId = "8f42db79-1539-47f2-a0d7-2bf0d620bc88"

const fillValidRequest = (): void => {
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Privacy Customer" },
  })
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "privacy@example.test" },
  })
  fireEvent.change(screen.getByLabelText("Details"), {
    target: {
      value: "Please provide a copy of the personal data for this account.",
    },
  })
}

describe("PrivacyRequestForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("focuses an actionable error summary for invalid submissions", async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)
    render(<PrivacyRequestForm />)

    fireEvent.click(
      screen.getByRole("button", { name: "Submit privacy request" })
    )

    const summary = await screen.findByRole("alert", {
      name: "Check your privacy request",
    })
    await waitFor(() => expect(summary).toHaveFocus())
    expect(screen.getByRole("button", { name: /^Name:/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Email:/ })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /^Details:/ })
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: /^Email:/ }))
    expect(screen.getByLabelText("Email")).toHaveFocus()
  })

  it("announces the bounded request reference returned by Backend", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ok: true,
        requestId,
      })
    )
    vi.stubGlobal("fetch", fetchMock)
    render(<PrivacyRequestForm />)
    fillValidRequest()

    fireEvent.click(
      screen.getByRole("button", { name: "Submit privacy request" })
    )

    const result = await screen.findByRole("status")
    expect(result).toHaveFocus()
    expect(result).toHaveTextContent(requestId)
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/privacy-request",
      expect.objectContaining({ method: "POST" })
    )
  })

  it("uses a neutral focused recovery message when confirmation fails", async () => {
    const providerSecret = "provider-secret-that-must-not-render"
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          detail: providerSecret,
          status: 503,
        },
        { status: 503 }
      )
    )
    vi.stubGlobal("fetch", fetchMock)
    render(<PrivacyRequestForm />)
    fillValidRequest()

    fireEvent.click(
      screen.getByRole("button", { name: "Submit privacy request" })
    )

    const error = await screen.findByRole("alert", {
      name: "Request was not submitted",
    })
    await waitFor(() => expect(error).toHaveFocus())
    expect(error).toHaveTextContent("No reference ID was issued")
    expect(error).not.toHaveTextContent(providerSecret)
  })
})
