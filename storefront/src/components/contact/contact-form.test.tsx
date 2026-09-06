import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import ContactForm from "@/components/contact/contact-form"

const validValues = {
  name: "Booking Customer",
  email: "booking@example.test",
  message: "Please share booking availability for our upcoming event.",
}

const fillValidMessage = (): void => {
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: validValues.name },
  })
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: validValues.email },
  })
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: validValues.message },
  })
}

describe("ContactForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("blocks an untouched invalid submission without sending a request", async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal("fetch", fetchMock)
    render(<ContactForm />)

    fireEvent.click(screen.getByRole("button", { name: "Send message" }))

    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toHaveAttribute(
        "aria-invalid",
        "true"
      )
      expect(screen.getByLabelText("Email")).toHaveAttribute(
        "aria-invalid",
        "true"
      )
      expect(screen.getByLabelText("Message")).toHaveAttribute(
        "aria-invalid",
        "true"
      )
    })
    expect(screen.getByText("Name is required")).toBeInTheDocument()
    expect(screen.getByText("Valid email required")).toBeInTheDocument()
    expect(
      screen.getByText("Message must be at least 10 characters")
    ).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("submits valid values once and resets the fields after success", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal("fetch", fetchMock)
    render(<ContactForm />)
    fillValidMessage()

    fireEvent.click(screen.getByRole("button", { name: "Send message" }))

    expect(
      await screen.findByText("Message sent. We’ll reply soon.")
    ).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: validValues.name,
        email: validValues.email,
        reason: "other",
        message: validValues.message,
        honeypot: "",
      }),
    })
    expect(screen.getByLabelText("Name")).toHaveValue("")
    expect(screen.getByLabelText("Email")).toHaveValue("")
    expect(screen.getByLabelText("Message")).toHaveValue("")
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled()
  })

  it("disables repeat submissions while the request is pending", async () => {
    let resolveResponse = (_response: Response): void => {
      throw new Error("The response resolver has not been initialized")
    }
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveResponse = resolve
    })
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(pendingResponse)
    vi.stubGlobal("fetch", fetchMock)
    render(<ContactForm />)
    fillValidMessage()

    fireEvent.click(screen.getByRole("button", { name: "Send message" }))

    const pendingButton = await screen.findByRole("button", {
      name: "Sending...",
    })
    expect(pendingButton).toBeDisabled()
    fireEvent.click(pendingButton)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText("Message")).toHaveValue(validValues.message)

    resolveResponse(Response.json({ ok: true }))
    expect(
      await screen.findByText("Message sent. We’ll reply soon.")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("retains entered values and allows retry after a failed request", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { detail: "private-provider-diagnostic" },
          { status: 503 }
        )
      )
    vi.stubGlobal("fetch", fetchMock)
    render(<ContactForm />)
    fillValidMessage()

    fireEvent.click(screen.getByRole("button", { name: "Send message" }))

    expect(
      await screen.findByText(
        /Something went wrong\. Please try again or email/
      )
    ).toBeInTheDocument()
    expect(screen.queryByText("private-provider-diagnostic")).toBeNull()
    expect(screen.getByLabelText("Name")).toHaveValue(validValues.name)
    expect(screen.getByLabelText("Email")).toHaveValue(validValues.email)
    expect(screen.getByLabelText("Message")).toHaveValue(validValues.message)
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
