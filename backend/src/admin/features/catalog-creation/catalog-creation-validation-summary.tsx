"use client"

import { memo, useCallback, type MouseEvent } from "react"
import { Text } from "@medusajs/ui"

import type { CatalogCreationValidationIssue } from "./catalog-creation-validation"

type CatalogCreationValidationSummaryProps = {
  issues: CatalogCreationValidationIssue[]
  onNavigate: (issue: CatalogCreationValidationIssue) => void
}

type IssueButtonTarget = {
  dataset?: Record<string, string | undefined>
}

export const CatalogCreationValidationSummary =
  memo<CatalogCreationValidationSummaryProps>(({ issues, onNavigate }) => {
    const handleNavigate = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        const key = (event.currentTarget as IssueButtonTarget).dataset?.issueKey
        const issue = issues.find((candidate) => candidate.key === key)
        if (issue) {
          onNavigate(issue)
        }
      },
      [issues, onNavigate],
    )

    if (!issues.length) {
      return null
    }

    return (
      <div
        aria-live="polite"
        className="rounded-md border border-ui-border-error bg-ui-bg-subtle p-3"
        role="alert"
      >
        <Text className="text-ui-fg-error" size="small" weight="plus">
          Review these details
        </Text>
        <ul className="mt-2 flex flex-col gap-1">
          {issues.map((issue) => (
            <li key={issue.key}>
              {issue.targetId ? (
                <button
                  className="min-h-6 cursor-pointer text-left text-xs text-ui-fg-error underline decoration-ui-fg-error/50 underline-offset-2 hover:decoration-ui-fg-error focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ui-border-interactive"
                  data-issue-key={issue.key}
                  onClick={handleNavigate}
                  type="button"
                >
                  Step {issue.step + 1}: {issue.message}
                </button>
              ) : (
                <Text className="text-ui-fg-error" size="xsmall">
                  {issue.message}
                </Text>
              )}
            </li>
          ))}
        </ul>
      </div>
    )
  })

CatalogCreationValidationSummary.displayName =
  "CatalogCreationValidationSummary"
