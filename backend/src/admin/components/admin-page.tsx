"use client";

import {
  memo,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import {
  Heading,
  Text,
  clx,
} from "@medusajs/ui";

export type AdminPageHeaderProps = {
  actions?: ReactNode;
  className?: string;
  description?: ReactNode;
  status?: ReactNode;
  title: ReactNode;
};

export const AdminPageHeader = memo<AdminPageHeaderProps>(
  ({
    actions,
    className,
    description,
    status,
    title,
  }) => (
    <header
      className={clx(
        "flex flex-wrap items-start justify-between gap-4",
        className,
      )}
    >
      <div className="min-w-0 max-w-3xl">
        <div className="flex flex-wrap items-center gap-2">
          <Heading level="h1">{title}</Heading>
          {status}
        </div>
        {description ? (
          <Text className="mt-1 text-ui-fg-subtle" size="small">
            {description}
          </Text>
        ) : null}
      </div>
      {actions ? (
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  ),
);

AdminPageHeader.displayName = "AdminPageHeader";

export type AdminSectionHeaderProps = {
  actions?: ReactNode;
  className?: string;
  description?: ReactNode;
  title: ReactNode;
};

export const AdminSectionHeader = memo<AdminSectionHeaderProps>(
  ({
    actions,
    className,
    description,
    title,
  }) => (
    <header
      className={clx(
        "flex flex-wrap items-start justify-between gap-3",
        className,
      )}
    >
      <div className="min-w-0 max-w-3xl">
        <Heading level="h2">{title}</Heading>
        {description ? (
          <Text className="mt-1 text-ui-fg-subtle" size="small">
            {description}
          </Text>
        ) : null}
      </div>
      {actions ? (
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  ),
);

AdminSectionHeader.displayName = "AdminSectionHeader";

export type AdminSingleColumnLayoutProps = ComponentPropsWithoutRef<"div">;

export const AdminSingleColumnLayout =
  memo<AdminSingleColumnLayoutProps>(
    ({ children, className, ...props }) => (
      <div
        className={clx("flex flex-col gap-y-3", className)}
        {...props}
      >
        {children}
      </div>
    ),
  );

AdminSingleColumnLayout.displayName = "AdminSingleColumnLayout";
