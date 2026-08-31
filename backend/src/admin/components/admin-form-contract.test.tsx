import { renderToStaticMarkup } from "react-dom/server"

import {
  AdminFormErrorSummary,
  AdminFormSaveState,
  AdminTaskNavigation,
  adminSaveStateMessage,
  firstAdminFormError,
  focusFirstAdminFormIssue,
  normalizeAdminFormIssues,
  runRecoverableAdminMutation,
  visibleAdminFormFieldError,
  type AdminFormIssue,
} from "./admin-form-contract"

const issues = (): AdminFormIssue[] => [
  {
    key: "title",
    message: " Enter a title. ",
    targetId: "product-title",
  },
  {
    key: "title-duplicate",
    message: "Enter a title.",
    targetId: "product-title",
  },
  {
    key: "publication",
    message: "Choose a publication status.",
    targetId: null,
  },
]

describe("Admin form contract", () => {
  it("normalizes string and schema errors at one boundary", () => {
    expect(firstAdminFormError([null, { message: " Required. " }])).toBe(
      "Required."
    )
    expect(
      visibleAdminFormFieldError({
        errors: ["Enter a title."],
        isTouched: false,
        isValid: false,
        submissionAttempts: 1,
      })
    ).toBe("Enter a title.")
    expect(
      visibleAdminFormFieldError({
        errors: ["Enter a title."],
        isTouched: false,
        isValid: false,
        submissionAttempts: 0,
      })
    ).toBeUndefined()
  })

  it("deduplicates issues and renders linked and summary-only errors", () => {
    expect(normalizeAdminFormIssues(issues())).toHaveLength(2)
    const markup = renderToStaticMarkup(
      <AdminFormErrorSummary issues={issues()} />
    )
    expect(markup).toContain("Check the highlighted fields")
    expect(markup).toContain("Enter a title.")
    expect(markup).toContain("Choose a publication status.")
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('type="button"')
    expect(markup).toContain("<h2")

    const nestedMarkup = renderToStaticMarkup(
      <AdminFormErrorSummary headingLevel="h3" issues={issues()} />
    )
    expect(nestedMarkup).toContain("<h3")
  })

  it("focuses and centers the first issue with a field target", () => {
    const focus = jest.fn()
    const scrollIntoView = jest.fn()
    const getElementById = jest.fn(() => ({ focus, scrollIntoView }))

    expect(focusFirstAdminFormIssue(issues(), { getElementById })).toBe(true)
    expect(getElementById).toHaveBeenCalledWith("product-title")
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    })
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it("announces save and reconciliation states without a spinner-only status", () => {
    expect(adminSaveStateMessage({ state: "dirty" })).toBe("Unsaved changes")
    expect(adminSaveStateMessage({ state: "reconciling" })).toMatch("Checking")
    expect(
      renderToStaticMarkup(<AdminFormSaveState state="saving" />)
    ).toContain("Saving changes…")
    expect(
      renderToStaticMarkup(<AdminFormSaveState state="error" />)
    ).toContain('role="alert"')
  })

  it("renders a keyboard-visible task navigation landmark", () => {
    const markup = renderToStaticMarkup(
      <AdminTaskNavigation
        className="invisible"
        items={[
          { href: "#product", label: "Product" },
          { href: "#variants", label: "Variants" },
        ]}
      />
    )
    expect(markup).toContain("Jump to an editing task")
    expect(markup).toContain('href="#product"')
    expect(markup).toContain('href="#variants"')
    expect(markup).toContain("invisible")
  })

  it("returns a confirmed mutation result", async () => {
    await expect(
      runRecoverableAdminMutation({
        mutate: async () => ({ id: "product_1" }),
        readAfterFailure: async () => ({ exists: false }),
        wasApplied: (snapshot) => snapshot.exists,
      })
    ).resolves.toEqual({ outcome: "confirmed", value: { id: "product_1" } })
  })

  it("reconciles an ambiguous response and preserves an unapplied error", async () => {
    const ambiguousError = new Error("Response lost")
    await expect(
      runRecoverableAdminMutation({
        mutate: async () => {
          throw ambiguousError
        },
        readAfterFailure: async () => ({ exists: true }),
        wasApplied: (snapshot) => snapshot.exists,
      })
    ).resolves.toEqual({ outcome: "reconciled", value: { exists: true } })

    await expect(
      runRecoverableAdminMutation({
        mutate: async () => {
          throw ambiguousError
        },
        readAfterFailure: async () => ({ exists: false }),
        wasApplied: (snapshot) => snapshot.exists,
      })
    ).rejects.toBe(ambiguousError)
  })
})
