import { afterEach, describe, expect, it, vi } from "vitest"

const loadPublicFormServerEnv = async () => {
  vi.resetModules()
  return import("@/config/env.public-forms.server")
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("publicFormServerEnv", () => {
  it("keeps the shared form proof secret server-only", async () => {
    const secret = ["public", "form", "unit", "test"].join("-").repeat(2)
    vi.stubEnv("PUBLIC_FORM_BFF_SECRET", secret)

    const { publicFormServerEnv } = await loadPublicFormServerEnv()

    expect(publicFormServerEnv.publicFormBffSecret).toBe(secret)
  })

  it("allows builds before an environment is activated", async () => {
    vi.stubEnv("PUBLIC_FORM_BFF_SECRET", undefined)

    const { publicFormServerEnv } = await loadPublicFormServerEnv()

    expect(publicFormServerEnv.publicFormBffSecret).toBeNull()
  })

  it("rejects a short shared secret", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    vi.stubEnv("PUBLIC_FORM_BFF_SECRET", "too-short")

    await expect(loadPublicFormServerEnv()).rejects.toThrow(
      "Public-form server environment validation failed"
    )
    expect(errorSpy).toHaveBeenCalled()
  })
})
