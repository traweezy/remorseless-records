import { memo } from "react"
import { Alert, Button, Text } from "@medusajs/ui"

import type { SavedNewsCommand } from "./news-command-state"

export const NewsCommandReview = memo<{
  record: SavedNewsCommand
  error: string | null
  busy: boolean
  canRetry: boolean
  onRetry: () => void
  onResolve: () => void
}>(({ record, error, busy, canRetry, onRetry, onResolve }) => (
  <section aria-label="Saved News request" className="min-w-0 space-y-4">
    <Alert
      role={record.status === "confirmed" ? "status" : "alert"}
      variant={record.status === "confirmed" ? "success" : "warning"}
    >
      <Text weight="plus">
        {record.status === "confirmed"
          ? "News command confirmed"
          : record.status === "rejected"
            ? "News request rejected"
            : "News save unconfirmed"}
      </Text>
      <Text size="small">
        {record.status === "confirmed"
          ? "This is the saved command's historical acknowledgement. The current post may have changed since then; finishing reloads the current list."
          : record.status === "rejected"
            ? "The first request was rejected. Clear it and refresh the post before editing again."
            : "The request may already have saved. Keep it and retry unchanged using the original administrator. Its headline, publication date, version and request ID will stay fixed."}
      </Text>
    </Alert>
    {error ? (
      <Alert role="alert" variant="error">
        {error}
      </Alert>
    ) : null}
    <dl className="grid min-w-0 gap-2 text-sm">
      <div>
        <dt className="font-medium">Headline</dt>
        <dd className="break-words">{record.body.title}</dd>
      </div>
      <div>
        <dt className="font-medium">Publication</dt>
        <dd>
          {`${record.body.status}${
            record.body.publishedAt
              ? ` · ${record.body.publishedAt}`
              : record.body.status === "published"
                ? " · server-assigned publication time"
                : " · private draft"
          }`}
        </dd>
      </div>
      <div>
        <dt className="font-medium">Saved request ID</dt>
        <dd className="break-all">{record.body.idempotencyKey}</dd>
      </div>
      <div>
        <dt className="font-medium">Loaded post version</dt>
        <dd>{record.body.expectedVersion}</dd>
      </div>
    </dl>
    {record.acknowledgement ? (
      <Text size="small">
        Confirmed command version {record.acknowledgement.entry.version}
        {record.acknowledgement.entry.publishedAt
          ? ` · ${record.acknowledgement.entry.publishedAt}`
          : ""}
      </Text>
    ) : null}
    <details className="min-w-0">
      <summary className="cursor-pointer py-2">
        Review unchanged saved content
      </summary>
      <pre className="whitespace-pre-wrap break-words text-sm">
        {record.body.content}
      </pre>
      <Text size="small">Summary: {record.body.excerpt ?? "None"}</Text>
      <Text className="break-all" size="small">
        Cover: {record.body.coverUrl ?? "None"}
      </Text>
      <Text size="small">
        Cover description: {record.body.coverAltText ?? "None"}
      </Text>
      <Text size="small">Tags: {record.body.tags.join(", ") || "None"}</Text>
    </details>
    <div className="flex flex-wrap gap-2">
      {record.status === "uncertain" ? (
        <Button
          disabled={busy || !canRetry}
          isLoading={busy}
          onClick={onRetry}
          type="button"
        >
          Retry saved News request
        </Button>
      ) : (
        <Button disabled={busy} onClick={onResolve} type="button">
          {record.status === "confirmed"
            ? "Finish confirmed save"
            : "Clear rejected request"}
        </Button>
      )}
    </div>
    {record.status === "uncertain" && !canRetry ? (
      <Text size="small">
        News update permission is required to retry. The saved request is
        retained.
      </Text>
    ) : null}
  </section>
))
NewsCommandReview.displayName = "NewsCommandReview"
