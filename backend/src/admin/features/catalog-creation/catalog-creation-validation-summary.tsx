"use client"

import { memo, useCallback, useMemo } from "react"

import {
  AdminFormErrorSummary,
  type AdminFormIssue,
} from "../../components/admin-form-contract"
import type { CatalogCreationValidationIssue } from "./catalog-creation-validation"

type CatalogCreationValidationSummaryProps = {
  issues: CatalogCreationValidationIssue[]
  onNavigate: (issue: CatalogCreationValidationIssue) => void
}

export const CatalogCreationValidationSummary =
  memo<CatalogCreationValidationSummaryProps>(({ issues, onNavigate }) => {
    const summaryIssues = useMemo<AdminFormIssue[]>(
      () =>
        issues.map((issue) => ({
          key: issue.key,
          message: issue.targetId
            ? `Step ${issue.step + 1}: ${issue.message}`
            : issue.message,
          targetId: issue.targetId,
        })),
      [issues]
    )
    const handleNavigate = useCallback(
      (selected: AdminFormIssue) => {
        const key = selected.key
        const issue = issues.find((candidate) => candidate.key === key)
        if (issue) {
          onNavigate(issue)
        }
      },
      [issues, onNavigate]
    )

    return (
      <AdminFormErrorSummary
        issues={summaryIssues}
        onFocusIssue={handleNavigate}
        title="Review these details"
      />
    )
  })

CatalogCreationValidationSummary.displayName =
  "CatalogCreationValidationSummary"
