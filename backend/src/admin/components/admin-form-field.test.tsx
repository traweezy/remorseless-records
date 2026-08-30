import { renderToStaticMarkup } from "react-dom/server"

import {
  AdminFormField,
  getAdminFormFieldIds,
  type AdminFormControlProps,
} from "./admin-form-field"

describe("AdminFormField", () => {
  it("associates its label, hint, and visible error with the control", () => {
    const renderControl = (controlProps: AdminFormControlProps) => (
      <textarea {...controlProps} name="release-title" />
    )
    const markup = renderToStaticMarkup(
      <AdminFormField
        error="Enter a release title."
        hint="Use the title customers recognize."
        id="release-title"
        label="Release title"
      >
        {renderControl}
      </AdminFormField>
    )

    expect(markup).toContain('for="release-title"')
    expect(markup).toContain('id="release-title"')
    expect(markup).toContain(
      'aria-describedby="release-title-hint release-title-error"'
    )
    expect(markup).toContain('aria-invalid="true"')
    expect(markup).toContain('id="release-title-hint"')
    expect(markup).toContain('id="release-title-error"')
    expect(markup).toContain('role="alert"')
  })

  it("omits error semantics before an error is visible", () => {
    const renderControl = (controlProps: AdminFormControlProps) => (
      <input {...controlProps} name="catalog-number" />
    )
    const markup = renderToStaticMarkup(
      <AdminFormField id="catalog-number" label="Catalog number" optional>
        {renderControl}
      </AdminFormField>
    )

    expect(markup).toContain("(Optional)")
    expect(markup).not.toContain("aria-describedby")
    expect(markup).not.toContain("aria-invalid")
    expect(markup).not.toContain('role="alert"')
  })
})

describe("getAdminFormFieldIds", () => {
  it("produces a stable generated ID and only describes visible messages", () => {
    expect(
      getAdminFormFieldIds({
        generatedId: ":r5:",
        hasError: true,
        hasHint: false,
        id: undefined,
      })
    ).toEqual({
      description: "admin-field-r5-error",
      error: "admin-field-r5-error",
      hint: "admin-field-r5-hint",
      input: "admin-field-r5",
    })
  })
})
