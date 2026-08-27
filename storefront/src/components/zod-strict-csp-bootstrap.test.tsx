import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import ZodStrictCspBootstrap, {
  ZOD_STRICT_CSP_BOOTSTRAP,
} from "@/components/zod-strict-csp-bootstrap"

describe("ZodStrictCspBootstrap", () => {
  it("preconfigures Zod without an eval capability probe", () => {
    const { container } = render(
      <ZodStrictCspBootstrap nonce="request-nonce" />
    )
    const script = container.querySelector("script#zod-strict-csp-bootstrap")

    expect(script).toHaveAttribute("nonce", "request-nonce")
    expect(script?.textContent).toBe(ZOD_STRICT_CSP_BOOTSTRAP)
    expect(script?.textContent).toContain("jitless:true")
  })
})
