import { createResendPublicFormEmailSender } from "./email"

describe("public-form Resend adapter", () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it("passes cancellation and idempotency through to the provider fetch", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "email_01TEST" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
    const sender = createResendPublicFormEmailSender("re_unit_test_key")
    const signal = new AbortController().signal

    await sender(
      {
        from: "forms@example.com",
        to: "forms@example.com",
        replyTo: "customer@example.com",
        subject: "Public form",
        text: "A public form message",
      },
      { idempotencyKey: "contact-request-01", signal }
    )

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, options] = fetchSpy.mock.calls[0] ?? []
    expect(String(url)).toBe("https://api.resend.com/emails")
    expect(options?.signal).toBe(signal)
    expect(new Headers(options?.headers).get("Idempotency-Key")).toBe(
      "contact-request-01"
    )
    expect(JSON.parse(String(options?.body))).toMatchObject({
      from: "forms@example.com",
      reply_to: "customer@example.com",
      subject: "Public form",
      to: ["forms@example.com"],
    })
  })

  it("turns provider rejections into a generic adapter error", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined)
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ message: "a sensitive provider diagnostic" }),
        {
          status: 422,
          headers: { "Content-Type": "application/json" },
        }
      )
    )
    const sender = createResendPublicFormEmailSender("re_unit_test_key")

    await expect(
      sender(
        {
          from: "forms@example.com",
          to: "forms@example.com",
          replyTo: "customer@example.com",
          subject: "Public form",
          text: "A public form message",
        },
        {
          idempotencyKey: "contact-request-02",
          signal: new AbortController().signal,
        }
      )
    ).rejects.toThrow("Public-form email provider rejected the request")
  })

  it("refuses to create an adapter without a key", () => {
    expect(() => createResendPublicFormEmailSender("  ")).toThrow(
      "without an API key"
    )
  })
})
