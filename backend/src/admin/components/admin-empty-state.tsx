"use client";

import {
  memo,
  useId,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import {
  Heading,
  Text,
  clx,
} from "@medusajs/ui";

export type AdminEmptyStateProps = Omit<
  ComponentPropsWithoutRef<"div">,
  "aria-describedby" | "aria-labelledby" | "role" | "title"
> & {
  action?: ReactNode;
  description: ReactNode;
  headingLevel?: "h2" | "h3";
  icon?: ReactNode;
  title: ReactNode;
};

export const AdminEmptyState = memo<AdminEmptyStateProps>(
  ({
    action,
    className,
    description,
    headingLevel = "h2",
    icon,
    title,
    ...props
  }) => {
    const headingId = useId();
    const descriptionId = useId();

    return (
      <div
        {...props}
        aria-describedby={descriptionId}
        aria-labelledby={headingId}
        className={clx(
          "flex min-h-52 flex-col items-center justify-center px-6 py-10 text-center",
          className,
        )}
        role="status"
      >
        {icon ? (
          <div aria-hidden="true" className="text-ui-fg-muted">
            {icon}
          </div>
        ) : null}
        <Heading
          className={clx(icon && "mt-3")}
          id={headingId}
          level={headingLevel}
        >
          {title}
        </Heading>
        <Text
          className="mt-1 max-w-lg text-ui-fg-subtle"
          id={descriptionId}
          size="small"
        >
          {description}
        </Text>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    );
  },
);

AdminEmptyState.displayName = "AdminEmptyState";
