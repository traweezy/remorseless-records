import { z } from "zod"

import { taxReportProblem } from "./http"
import { TaxReportPeriodError } from "./periods"

describe("tax report HTTP problems", () => {
  it("returns safe validation details for operator mistakes", () => {
    expect(
      taxReportProblem({
        error: new TaxReportPeriodError(
          "The report end date must be after its start date."
        ),
        operation: "report",
      })
    ).toMatchObject({
      body: {
        detail: "The report end date must be after its start date.",
        status: 400,
        title: "Invalid tax report request",
      },
      status: 400,
    })

    const validation = z.string().min(2).safeParse("")
    expect(validation.success).toBe(false)
    if (!validation.success) {
      expect(
        taxReportProblem({
          error: validation.error,
          operation: "export",
        }).status
      ).toBe(400)
    }
  })

  it("does not expose unexpected internal error details", () => {
    const problem = taxReportProblem({
      error: new Error("password=do-not-leak"),
      operation: "report",
    })

    expect(problem.status).toBe(500)
    expect(JSON.stringify(problem.body)).not.toContain("do-not-leak")
    expect(problem.body.detail).toContain("could not be generated")
  })
})
