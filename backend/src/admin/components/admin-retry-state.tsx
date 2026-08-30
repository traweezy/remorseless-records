"use client"

import { memo, useCallback, type ReactNode } from "react"
import { Alert, Button, Container, Text } from "@medusajs/ui"

export type AdminRetryStateProps = {
  message: ReactNode
  onRetry: () => void
  retryLabel?: string
  retrying?: boolean
  title: ReactNode
}

export const AdminRetryState = memo<AdminRetryStateProps>(
  ({ message, onRetry, retryLabel = "Try again", retrying = false, title }) => {
    const handleRetry = useCallback(() => {
      if (!retrying) {
        onRetry()
      }
    }, [onRetry, retrying])

    return (
      <Container aria-busy={retrying}>
        <Alert role="alert" variant="error">
          <Text weight="plus">{title}</Text>
          <Text size="small">{message}</Text>
        </Alert>
        <Button
          className="mt-4"
          disabled={retrying}
          isLoading={retrying}
          onClick={handleRetry}
          size="small"
          type="button"
          variant="secondary"
        >
          {retryLabel}
        </Button>
      </Container>
    )
  }
)

AdminRetryState.displayName = "AdminRetryState"
