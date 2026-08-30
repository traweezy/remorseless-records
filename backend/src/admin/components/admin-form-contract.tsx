"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { Alert, Container, Heading, Text, clx } from "@medusajs/ui";

import { AdminSectionHeader } from "./admin-page";

export type AdminFormIssue = {
  key: string;
  message: string;
  targetId: string | null;
};

type FocusableTarget = {
  focus: () => void;
  scrollIntoView?: (options?: {
    behavior?: "auto" | "smooth";
    block?: "center" | "end" | "nearest" | "start";
  }) => void;
};

type FocusRoot = {
  getElementById: (id: string) => FocusableTarget | null;
};

type BeforeUnloadEventLike = {
  preventDefault: () => void;
  returnValue: string;
};

type AdminBrowserRuntime = {
  addEventListener?: (
    type: "beforeunload",
    listener: (event: BeforeUnloadEventLike) => void,
  ) => void;
  document?: FocusRoot;
  removeEventListener?: (
    type: "beforeunload",
    listener: (event: BeforeUnloadEventLike) => void,
  ) => void;
};

const browserRuntime = (): AdminBrowserRuntime =>
  globalThis as unknown as AdminBrowserRuntime;

export const firstAdminFormError = (
  errors: readonly unknown[],
): string | undefined => {
  for (const error of errors) {
    if (typeof error === "string" && error.trim()) {
      return error.trim();
    }
    if (error && typeof error === "object" && "message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) {
        return message.trim();
      }
    }
  }
  return undefined;
};

export const visibleAdminFormFieldError = ({
  errors,
  isTouched,
  isValid,
  submissionAttempts,
}: {
  errors: readonly unknown[];
  isTouched: boolean;
  isValid: boolean;
  submissionAttempts: number;
}): string | undefined =>
  !isValid && (isTouched || submissionAttempts > 0)
    ? firstAdminFormError(errors)
    : undefined;

export const normalizeAdminFormIssues = (
  issues: readonly AdminFormIssue[],
): AdminFormIssue[] => {
  const seen = new Set<string>();
  return issues.flatMap((issue) => {
    const message = issue.message.trim();
    const identity = `${issue.targetId ?? "summary"}:${message}`;
    if (!message || seen.has(identity)) {
      return [];
    }
    seen.add(identity);
    return [{ ...issue, message }];
  });
};

export const focusAdminFormTarget = (
  targetId: string | null,
  root: FocusRoot | undefined = browserRuntime().document,
): boolean => {
  if (!targetId || !root) {
    return false;
  }
  const target = root.getElementById(targetId);
  if (!target) {
    return false;
  }
  target.scrollIntoView?.({ behavior: "smooth", block: "center" });
  target.focus();
  return true;
};

export const focusFirstAdminFormIssue = (
  issues: readonly AdminFormIssue[],
  root: FocusRoot | undefined = browserRuntime().document,
): boolean => {
  const firstTarget = normalizeAdminFormIssues(issues).find(
    (issue) => issue.targetId !== null,
  );
  return focusAdminFormTarget(firstTarget?.targetId ?? null, root);
};

type AdminFormIssueLinkProps = {
  issue: AdminFormIssue;
  onFocusIssue?: (issue: AdminFormIssue) => void;
};

const AdminFormIssueLink = memo<AdminFormIssueLinkProps>(({ issue, onFocusIssue }) => {
  const handleClick = useCallback(() => {
    if (onFocusIssue) {
      onFocusIssue(issue);
      return;
    }
    focusAdminFormTarget(issue.targetId);
  }, [issue, onFocusIssue]);

  return issue.targetId ? (
    <button
      className="min-h-6 text-left text-ui-fg-error underline decoration-ui-fg-error/40 underline-offset-2 outline-none transition-colors hover:decoration-ui-fg-error focus-visible:rounded-sm focus-visible:shadow-borders-focus motion-reduce:transition-none"
      data-issue-key={issue.key}
      onClick={handleClick}
      type="button"
    >
      {issue.message}
    </button>
  ) : (
    <Text className="text-ui-fg-error" size="small">
      {issue.message}
    </Text>
  );
});

AdminFormIssueLink.displayName = "AdminFormIssueLink";

export type AdminFormErrorSummaryProps = {
  className?: string;
  issues: readonly AdminFormIssue[];
  onFocusIssue?: (issue: AdminFormIssue) => void;
  title?: string;
};

export const AdminFormErrorSummary = memo<AdminFormErrorSummaryProps>(
  ({
    className,
    issues,
    onFocusIssue,
    title = "Check the highlighted fields",
  }) => {
    const normalizedIssues = useMemo(
      () => normalizeAdminFormIssues(issues),
      [issues],
    );
    const issueItems = useMemo(
      () =>
        normalizedIssues.map((issue) => (
          <li key={issue.key}>
            <AdminFormIssueLink
              issue={issue}
              {...(onFocusIssue === undefined ? {} : { onFocusIssue })}
            />
          </li>
        )),
      [normalizedIssues, onFocusIssue],
    );

    if (normalizedIssues.length === 0) {
      return null;
    }

    return (
      <Alert className={className} role="alert" variant="error">
        <Heading level="h3">{title}</Heading>
        <Text className="mt-1 text-ui-fg-subtle" size="small">
          Nothing has been saved. Correct the following details and try again.
        </Text>
        <ul className="mt-2 list-disc space-y-1 pl-5">{issueItems}</ul>
      </Alert>
    );
  },
);

AdminFormErrorSummary.displayName = "AdminFormErrorSummary";

export const adminSaveStates = [
  "idle",
  "dirty",
  "saving",
  "saved",
  "reconciling",
  "error",
] as const;

export type AdminSaveState = (typeof adminSaveStates)[number];

export const adminSaveStateMessage = ({
  savedLabel,
  state,
}: {
  savedLabel?: string;
  state: AdminSaveState;
}): string => {
  switch (state) {
    case "dirty":
      return "Unsaved changes";
    case "saving":
      return "Saving changes…";
    case "saved":
      return savedLabel?.trim() || "Changes saved";
    case "reconciling":
      return "Checking whether the changes were saved…";
    case "error":
      return "Changes were not saved";
    case "idle":
      return "No unsaved changes";
  }
};

export type AdminFormSaveStateProps = {
  className?: string;
  savedLabel?: string;
  state: AdminSaveState;
};

export const AdminFormSaveState = memo<AdminFormSaveStateProps>(
  ({ className, savedLabel, state }) => {
    const message = adminSaveStateMessage({
      state,
      ...(savedLabel === undefined ? {} : { savedLabel }),
    });
    return (
      <Text
        aria-atomic="true"
        aria-live={state === "idle" ? "off" : "polite"}
        className={clx(
          "text-ui-fg-subtle",
          state === "error" && "text-ui-fg-error",
          className,
        )}
        role={state === "error" ? "alert" : "status"}
        size="small"
      >
        {message}
      </Text>
    );
  },
);

AdminFormSaveState.displayName = "AdminFormSaveState";

export type AdminTaskSectionProps = {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  title: ReactNode;
};

export const AdminTaskSection = memo<AdminTaskSectionProps>(
  ({ actions, children, className, description, title }) => (
    <Container className={clx("p-0", className)}>
      <div className="border-b border-ui-border-base px-6 py-4">
        <AdminSectionHeader
          actions={actions}
          description={description}
          title={title}
        />
      </div>
      <div className="px-6 py-5">{children}</div>
    </Container>
  ),
);

AdminTaskSection.displayName = "AdminTaskSection";

export type AdminTaskNavigationItem = {
  href: `#${string}`;
  label: string;
};

export type AdminTaskNavigationProps = {
  items: readonly AdminTaskNavigationItem[];
  label?: string;
};

export const AdminTaskNavigation = memo<AdminTaskNavigationProps>(
  ({ items, label = "Jump to an editing task" }) => {
    const links = useMemo(
      () =>
        items.map((item) => (
          <a
            className="inline-flex min-h-8 items-center rounded-md border border-ui-border-base bg-ui-bg-base px-3 text-sm text-ui-fg-base outline-none transition-colors hover:bg-ui-bg-subtle focus-visible:shadow-borders-focus motion-reduce:transition-none"
            href={item.href}
            key={item.href}
          >
            {item.label}
          </a>
        )),
      [items],
    );
    return (
      <nav
        aria-label={label}
        className="sticky top-0 z-10 rounded-md border border-ui-border-base bg-ui-bg-base/95 p-3 shadow-elevation-card-rest backdrop-blur motion-reduce:backdrop-blur-none"
      >
        <Text className="mb-2 text-ui-fg-subtle" size="xsmall" weight="plus">
          {label}
        </Text>
        <div className="flex flex-wrap gap-2">{links}</div>
      </nav>
    );
  },
);

AdminTaskNavigation.displayName = "AdminTaskNavigation";

export const useAdminUnsavedChanges = (
  enabled: boolean,
  message = "You have unsaved changes.",
  onBeforeUnload?: () => void,
): void => {
  useEffect(() => {
    const browser = browserRuntime();
    if (!enabled || typeof browser.addEventListener !== "function") {
      return undefined;
    }
    const handleBeforeUnload = (event: BeforeUnloadEventLike) => {
      onBeforeUnload?.();
      event.preventDefault();
      event.returnValue = message;
    };
    browser.addEventListener("beforeunload", handleBeforeUnload);
    return () => browser.removeEventListener?.("beforeunload", handleBeforeUnload);
  }, [enabled, message, onBeforeUnload]);
};

export type RecoverableAdminMutationResult<TMutation, TSnapshot> =
  | { outcome: "confirmed"; value: TMutation }
  | { outcome: "reconciled"; value: TSnapshot };

export const runRecoverableAdminMutation = async <TMutation, TSnapshot>({
  mutate,
  readAfterFailure,
  wasApplied,
}: {
  mutate: () => Promise<TMutation>;
  readAfterFailure: () => Promise<TSnapshot>;
  wasApplied: (snapshot: TSnapshot) => boolean;
}): Promise<RecoverableAdminMutationResult<TMutation, TSnapshot>> => {
  try {
    return { outcome: "confirmed", value: await mutate() };
  } catch (mutationError) {
    try {
      const snapshot = await readAfterFailure();
      if (wasApplied(snapshot)) {
        return { outcome: "reconciled", value: snapshot };
      }
    } catch {
      // Preserve the mutation error because it is the actionable failure.
    }
    throw mutationError;
  }
};
