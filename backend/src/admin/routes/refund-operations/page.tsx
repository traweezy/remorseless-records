"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ArrowPath, ArrowUturnLeft, ExclamationCircle } from "@medusajs/icons";
import {
  Alert,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  Text,
} from "@medusajs/ui";
import { useQuery } from "@tanstack/react-query";

import {
  nativeAdminActions,
  operationsAdminActions,
} from "../../../lib/admin-permissions";
import type {
  RefundCase,
  RefundCaseStatus,
  RefundProvider,
  RefundTaxStatus,
} from "../../../lib/refund-operations/types";
import { AdminEmptyState } from "../../components/admin-empty-state";
import { AdminPermissionBoundary } from "../../components/admin-permission-boundary";
import {
  AdminPageHeader,
  AdminSectionHeader,
  AdminSingleColumnLayout,
} from "../../components/admin-page";
import { AdminRetryState } from "../../components/admin-retry-state";
import { AdminStatCard } from "../../components/admin-stat-card";
import { OperationsWorkspaceNavigation } from "../../features/operations/operations-navigation";
import {
  replaceLegacyOperationsLocation,
  type ReplaceAdminLocation,
} from "../../features/operations/operations-routes";
import { useAdminPermissions } from "../../lib/admin-permissions";
import { getAdminRequestErrorMessage } from "../../lib/admin-request";
import { refundOperationsQueryOptions } from "./query";
import {
  caseLabel,
  filterRefundCases,
  isProviderFilter,
  isStatusFilter,
  type ProviderFilter,
  type StatusFilter,
} from "./ui-state";

type CaseCardProps = {
  canOpenOrder: boolean;
  refundCase: RefundCase;
};

type OrderActionProps = CaseCardProps;

const PAGE_SIZE = 20;

const statusLabel = (status: RefundCaseStatus): string => {
  if (status === "action_required") {
    return "Needs attention";
  }
  if (status === "processing") {
    return "Processing";
  }
  return "Verified";
};

const statusColor = (
  status: RefundCaseStatus,
): "green" | "orange" | "red" =>
  status === "action_required"
    ? "red"
    : status === "processing"
      ? "orange"
      : "green";

const providerLabel = (provider: RefundProvider): string => {
  if (provider === "stripe_tax") {
    return "Stripe Tax";
  }
  if (provider === "taxrate_io") {
    return "TaxRate.io";
  }
  return "Not linked yet";
};

const taxStatusLabel = (status: RefundTaxStatus): string => {
  if (status === "not_applicable") {
    return "Not required";
  }
  if (status === "attention") {
    return "Needs review";
  }
  if (status === "pending") {
    return "Reversal pending";
  }
  if (status === "untracked") {
    return "Not linked yet";
  }
  return "Reversal verified";
};

const taxStatusColor = (
  status: RefundTaxStatus,
): "blue" | "green" | "orange" | "red" =>
  status === "attention"
    ? "red"
    : status === "pending" || status === "untracked"
      ? "orange"
      : status === "verified"
        ? "green"
        : "blue";

const formatMinorAmount = (amount: number, currencyCode: string): string =>
  new Intl.NumberFormat(undefined, {
    currency: currencyCode.toUpperCase(),
    style: "currency",
  }).format(amount / 100);

const formatDate = (value: string | null): string => {
  if (!value) {
    return "Not yet";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
};

const stripeAmountLabel = (refundCase: RefundCase): string =>
  refundCase.stripeRefundAmountMinor === null
    ? "Waiting for Stripe"
    : formatMinorAmount(
        refundCase.stripeRefundAmountMinor,
        refundCase.currencyCode,
      );

const refundCountLabel = (count: number): string =>
  `${count} refund${count === 1 ? "" : "s"}`;

const CaseStatus = memo<{ status: RefundCaseStatus }>(({ status }) => (
  <StatusBadge
    className="shrink-0 whitespace-nowrap"
    color={statusColor(status)}
  >
    {statusLabel(status)}
  </StatusBadge>
));

CaseStatus.displayName = "CaseStatus";

const OrderAction = memo<OrderActionProps>(({ canOpenOrder, refundCase }) =>
  refundCase.orderId && canOpenOrder ? (
    <Button asChild size="small" variant="secondary">
      <a href={`/app/orders/${encodeURIComponent(refundCase.orderId)}`}>
        Open order
      </a>
    </Button>
  ) : refundCase.orderId ? (
    <Text size="xsmall" className="text-ui-fg-subtle">
      View-only refund access. Order access is required to open this order.
    </Text>
  ) : (
    <Text size="xsmall" className="text-ui-fg-subtle">
      No order was created. Investigate the checkout payment before taking any
      further action.
    </Text>
  ),
);

OrderAction.displayName = "OrderAction";

const CaseCard = memo<CaseCardProps>(({ canOpenOrder, refundCase }) => (
  <article className="rounded-lg border border-ui-border-base p-4">
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
      <div className="min-w-0">
        <Heading level="h3">{caseLabel(refundCase)}</Heading>
        <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
          Last checked {formatDate(refundCase.lastVerifiedAt)}
        </Text>
      </div>
      <CaseStatus status={refundCase.status} />
    </div>

    <dl className="mt-4 grid grid-cols-2 gap-3">
      <div>
        <dt className="txt-compact-xsmall text-ui-fg-subtle">
          Medusa ledger
        </dt>
        <dd className="txt-compact-small-plus mt-0.5 tabular-nums">
          {formatMinorAmount(
            refundCase.medusaRefundAmountMinor,
            refundCase.currencyCode,
          )}
        </dd>
      </div>
      <div>
        <dt className="txt-compact-xsmall text-ui-fg-subtle">Stripe</dt>
        <dd className="txt-compact-small-plus mt-0.5 tabular-nums">
          {stripeAmountLabel(refundCase)}
        </dd>
      </div>
      <div>
        <dt className="txt-compact-xsmall text-ui-fg-subtle">
          Tax reversal
        </dt>
        <dd className="mt-1">
          <StatusBadge
            className="whitespace-nowrap"
            color={taxStatusColor(refundCase.taxStatus)}
          >
            {taxStatusLabel(refundCase.taxStatus)}
          </StatusBadge>
        </dd>
      </div>
      <div>
        <dt className="txt-compact-xsmall text-ui-fg-subtle">Provider</dt>
        <dd className="txt-compact-small mt-0.5">
          {providerLabel(refundCase.provider)}
        </dd>
      </div>
    </dl>

    <div className="mt-4 rounded-md bg-ui-bg-subtle p-3">
      <Text size="xsmall" weight="plus">
        Next action
      </Text>
      <Text size="small" className="mt-1 text-ui-fg-subtle">
        {refundCase.nextAction}
      </Text>
    </div>

    <div className="mt-4">
      <OrderAction canOpenOrder={canOpenOrder} refundCase={refundCase} />
    </div>
  </article>
));

CaseCard.displayName = "CaseCard";

export const RefundOperationsPageContent = memo(() => {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [provider, setProvider] = useState<ProviderFilter>("all");
  const [page, setPage] = useState(0);
  const permissions = useAdminPermissions();
  const canReadOrders = permissions.hasPermission(nativeAdminActions.order.read);
  const canReadRefundReasons = permissions.hasPermission(
    nativeAdminActions.refundReason.read,
  );
  const {
    data: snapshot,
    error: queryError,
    isFetching: loading,
    refetch,
  } = useQuery(refundOperationsQueryOptions());
  const error = queryError
    ? getAdminRequestErrorMessage(
        queryError,
        "Unable to load refund operations.",
      )
    : null;

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const handleSearch = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(
        String(
          (event.currentTarget as unknown as { value?: unknown }).value ?? "",
        ),
      );
      setPage(0);
    },
    [],
  );

  const handleStatus = useCallback((value: string) => {
    if (isStatusFilter(value)) {
      setStatus(value);
      setPage(0);
    }
  }, []);

  const handleProvider = useCallback((value: string) => {
    if (isProviderFilter(value)) {
      setProvider(value);
      setPage(0);
    }
  }, []);

  const handleClearFilters = useCallback(() => {
    setSearch("");
    setStatus("all");
    setProvider("all");
    setPage(0);
  }, []);

  const handlePreviousPage = useCallback(() => {
    setPage((current) => Math.max(0, current - 1));
  }, []);

  const handleNextPage = useCallback(() => {
    setPage((current) => current + 1);
  }, []);

  const filteredCases = useMemo(() => {
    return filterRefundCases({
      cases: snapshot?.cases ?? [],
      provider,
      search,
      status,
    });
  }, [provider, search, snapshot?.cases, status]);

  const pageCount = Math.max(1, Math.ceil(filteredCases.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visibleCases = useMemo(
    () =>
      filteredCases.slice(
        safePage * PAGE_SIZE,
        safePage * PAGE_SIZE + PAGE_SIZE,
      ),
    [filteredCases, safePage],
  );

  const operationsStatus = useMemo(() => {
    if (!snapshot) {
      return null;
    }
    if (snapshot.summary.actionRequired > 0) {
      return { color: "red" as const, label: "Needs attention" };
    }
    if (snapshot.summary.processing > 0) {
      return { color: "orange" as const, label: "Monitoring" };
    }
    return { color: "green" as const, label: "Operational" };
  }, [snapshot]);

  const totalRefunded = snapshot?.summary.amountsByCurrency
    .map(({ amountMinor, currencyCode }) =>
      formatMinorAmount(amountMinor, currencyCode),
    )
    .join(" · ");

  return (
    <AdminSingleColumnLayout>
      <Container>
        <AdminPageHeader
          actions={
            canReadOrders || canReadRefundReasons ? (
              <>
                {canReadRefundReasons ? (
                  <Button asChild size="small" variant="secondary">
                    <a href="/app/settings/refund-reasons">Manage reasons</a>
                  </Button>
                ) : null}
                {canReadOrders ? (
                  <Button asChild size="small" variant="primary">
                    <a href="/app/orders">Open orders</a>
                  </Button>
                ) : null}
              </>
            ) : undefined
          }
          description={
            <>
              Choose the correct order workflow, then monitor Medusa, Stripe,
              and tax evidence until they agree.
            </>
          }
          status={
            operationsStatus ? (
              <StatusBadge color={operationsStatus.color}>
                {operationsStatus.label}
              </StatusBadge>
            ) : null
          }
          title="Refunds"
        />
        <OperationsWorkspaceNavigation active="refunds" className="mt-5" />

        <Alert className="mt-5" variant="warning">
          <Text weight="plus">
            Issue every refund from its Medusa order
          </Text>
          <Text size="small">
            Use Stripe only to investigate provider details. A refund created
            in Stripe bypasses the Medusa order ledger and can lead to a second
            reimbursement.
          </Text>
        </Alert>
      </Container>

      <Container>
        <AdminSectionHeader
          description={
            <>
              The payment refund is only one part of the customer resolution.
              Choose the path that matches what is physically happening.
            </>
          }
          title="Choose the order path first"
        />
        <ol className="mt-5 grid gap-3 lg:grid-cols-3">
          <li className="rounded-lg border border-ui-border-base p-4">
            <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
              PATH 1
            </Text>
            <Heading level="h3" className="mt-1">
              Not shipped
            </Heading>
            <Text size="small" className="mt-2 text-ui-fg-subtle">
              Cancel the unfulfilled items or order where appropriate. Then
              check the order summary and Payments for any amount still owed
              to the customer.
            </Text>
          </li>
          <li className="rounded-lg border border-ui-border-base p-4">
            <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
              PATH 2
            </Text>
            <Heading level="h3" className="mt-1">
              Item is coming back
            </Heading>
            <Text size="small" className="mt-2 text-ui-fg-subtle">
              Create a return, or a claim for damaged or incorrect goods.
              Record received and damaged quantities before completing any
              refund shown in Payments.
            </Text>
          </li>
          <li className="rounded-lg border border-ui-border-base p-4">
            <Text size="xsmall" weight="plus" className="text-ui-fg-subtle">
              PATH 3
            </Text>
            <Heading level="h3" className="mt-1">
              Payment-only correction
            </Heading>
            <Text size="small" className="mt-2 text-ui-fg-subtle">
              For a goodwill adjustment, shipping refund, or pricing
              correction with no inventory change, use the payment row&apos;s
              Refund action and record a reason and customer-facing note.
            </Text>
          </li>
        </ol>

        <details className="mt-4 rounded-lg border border-ui-border-base">
          <summary className="cursor-pointer px-4 py-3 text-ui-fg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-fg-interactive">
            <Text as="span" size="small" weight="plus">
              What happens after you save a refund
            </Text>
          </summary>
          <ol className="grid gap-4 border-t border-ui-border-base px-4 py-4 md:grid-cols-2 xl:grid-cols-4">
            <li>
              <Text size="xsmall" weight="plus">
                1. Medusa records it
              </Text>
              <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                The order transaction and payment refund become the internal
                source of truth.
              </Text>
            </li>
            <li>
              <Text size="xsmall" weight="plus">
                2. Stripe processes it
              </Text>
              <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                Stripe returns the money to the original payment method; the
                customer&apos;s bank controls final posting time.
              </Text>
            </li>
            <li>
              <Text size="xsmall" weight="plus">
                3. Tax evidence follows
              </Text>
              <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                Stripe Tax reversals are verified. TaxRate.io needs no
                provider-side reversal because Medusa keeps the tax ledger.
              </Text>
            </li>
            <li>
              <Text size="xsmall" weight="plus">
                4. Exceptions stay visible
              </Text>
              <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                Immediate event handling and the hourly safety check keep
                pending, failed, or mismatched cases in this queue.
              </Text>
            </li>
          </ol>
        </details>
      </Container>

      {loading && !snapshot ? (
        <Container aria-label="Loading refund operations" role="status">
          <Skeleton className="h-7 w-48" />
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-28" />
            ))}
          </div>
          <Skeleton className="mt-5 h-64" />
        </Container>
      ) : null}

      {error ? (
        <AdminRetryState
          message={error}
          onRetry={handleRefresh}
          retrying={loading}
          title="Refund audit unavailable"
        />
      ) : null}

      {snapshot ? (
        <>
          <Container>
            <AdminSectionHeader
              actions={
                <Button
                  isLoading={loading}
                  onClick={handleRefresh}
                  size="small"
                  type="button"
                  variant="secondary"
                >
                  <ArrowPath />
                  Refresh audit
                </Button>
              }
              description={
                <>
                  Medusa-recorded refunds, checked against Stripe and the
                  active tax evidence.
                </>
              }
              title="Refund health"
            />

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <AdminStatCard
                description="Investigate before issuing another refund."
                label="Needs attention"
              >
                <Text size="large" weight="plus" className="tabular-nums">
                  {snapshot.summary.actionRequired}
                </Text>
              </AdminStatCard>
              <AdminStatCard
                description="Waiting for a provider or tax check."
                label="Processing"
              >
                <Text size="large" weight="plus" className="tabular-nums">
                  {snapshot.summary.processing}
                </Text>
              </AdminStatCard>
              <AdminStatCard
                description="Medusa, Stripe, and tax evidence agree."
                label="Verified"
              >
                <Text size="large" weight="plus" className="tabular-nums">
                  {snapshot.summary.verified}
                </Text>
              </AdminStatCard>
              <AdminStatCard
                description={`${snapshot.summary.totalCases} refund ${snapshot.summary.totalCases === 1 ? "case" : "cases"} in this audit.`}
                label="Recorded in Medusa"
              >
                <Text size="large" weight="plus" className="tabular-nums">
                  {totalRefunded || "—"}
                </Text>
              </AdminStatCard>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-ui-fg-subtle">
              <Text size="xsmall">
                {snapshot.reasonConfiguration.count} refund{" "}
                {snapshot.reasonConfiguration.count === 1
                  ? "reason"
                  : "reasons"}{" "}
                configured
              </Text>
              <span aria-hidden="true">·</span>
              <Text size="xsmall">
                Updated {formatDate(snapshot.generatedAt)}
              </Text>
              <span aria-hidden="true">·</span>
              <Text size="xsmall">
                Refunded orders from the last {snapshot.source.windowDays} days
                plus all tracked refund evidence
              </Text>
            </div>

            {!snapshot.reasonConfiguration.configured ? (
              <Alert className="mt-4" variant="warning">
                <Text weight="plus">No refund reasons are configured</Text>
                <Text size="small">
                  Add a short, consistent set of reasons before operators issue
                  refunds so customer notes and reports remain understandable.
                </Text>
              </Alert>
            ) : null}

            {snapshot.source.truncated ? (
              <Alert className="mt-4" variant="error">
                <Text weight="plus">
                  The audit reached its safety limit
                </Text>
                <Text size="small">
                  Some evidence may be missing from this view. Do not rely on a
                  missing row as proof that a refund is safe to repeat.
                </Text>
              </Alert>
            ) : null}
          </Container>

          <Container>
            <AdminSectionHeader
              actions={
                <Text
                  aria-live="polite"
                  className="text-ui-fg-subtle"
                  size="small"
                >
                  {filteredCases.length}{" "}
                  {filteredCases.length === 1 ? "case" : "cases"}
                </Text>
              }
              description={
                <>
                  Filters work together. Open the order to take action through
                  the native Medusa workflow.
                </>
              }
              title="Monitor refund cases"
            />

            <div className="mt-5 grid gap-3 md:grid-cols-[minmax(16rem,1fr)_13rem_13rem_auto] md:items-end">
              <div>
                <Label htmlFor="refund-search">Search orders or reasons</Label>
                <Input
                  className="mt-1"
                  id="refund-search"
                  onChange={handleSearch}
                  placeholder="Order #42 or pricing error"
                  type="search"
                  value={search}
                />
              </div>
              <div>
                <Label htmlFor="refund-status">Status</Label>
                <Select value={status} onValueChange={handleStatus}>
                  <Select.Trigger className="mt-1" id="refund-status">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="all">All statuses</Select.Item>
                    <Select.Item value="action_required">
                      Needs attention
                    </Select.Item>
                    <Select.Item value="processing">Processing</Select.Item>
                    <Select.Item value="verified">Verified</Select.Item>
                  </Select.Content>
                </Select>
              </div>
              <div>
                <Label htmlFor="refund-provider">Tax provider</Label>
                <Select value={provider} onValueChange={handleProvider}>
                  <Select.Trigger className="mt-1" id="refund-provider">
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="all">All providers</Select.Item>
                    <Select.Item value="stripe_tax">Stripe Tax</Select.Item>
                    <Select.Item value="taxrate_io">TaxRate.io</Select.Item>
                    <Select.Item value="untracked">
                      Not linked yet
                    </Select.Item>
                  </Select.Content>
                </Select>
              </div>
              <Button
                onClick={handleClearFilters}
                size="small"
                type="button"
                variant="secondary"
              >
                Clear filters
              </Button>
            </div>

            {visibleCases.length ? (
              <>
                <div className="mt-5 grid gap-3 md:hidden">
                  {visibleCases.map((refundCase) => (
                    <CaseCard
                      canOpenOrder={canReadOrders}
                      key={refundCase.caseId}
                      refundCase={refundCase}
                    />
                  ))}
                </div>

                <div className="mt-5 hidden overflow-x-auto md:block">
                  <Table className="min-w-[72rem]">
                    <Table.Header>
                      <Table.Row>
                        <Table.HeaderCell>Case</Table.HeaderCell>
                        <Table.HeaderCell>Medusa ledger</Table.HeaderCell>
                        <Table.HeaderCell>Stripe</Table.HeaderCell>
                        <Table.HeaderCell>Tax</Table.HeaderCell>
                        <Table.HeaderCell>Next action</Table.HeaderCell>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {visibleCases.map((refundCase) => (
                        <Table.Row key={refundCase.caseId}>
                          <Table.Cell className="align-top">
                            <div className="min-w-36">
                              <Text size="small" weight="plus">
                                {caseLabel(refundCase)}
                              </Text>
                              <div className="mt-1">
                                <CaseStatus status={refundCase.status} />
                              </div>
                              <Text
                                size="xsmall"
                                className="mt-2 text-ui-fg-subtle"
                              >
                                Checked{" "}
                                {formatDate(refundCase.lastVerifiedAt)}
                              </Text>
                            </div>
                          </Table.Cell>
                          <Table.Cell className="align-top">
                            <Text
                              size="small"
                              weight="plus"
                              className="tabular-nums"
                            >
                              {formatMinorAmount(
                                refundCase.medusaRefundAmountMinor,
                                refundCase.currencyCode,
                              )}
                            </Text>
                            <Text
                              size="xsmall"
                              className="mt-1 text-ui-fg-subtle"
                            >
                              {refundCountLabel(
                                refundCase.medusaRefundCount,
                              )}
                            </Text>
                          </Table.Cell>
                          <Table.Cell className="align-top">
                            <Text
                              size="small"
                              weight="plus"
                              className="tabular-nums"
                            >
                              {stripeAmountLabel(refundCase)}
                            </Text>
                            <Text
                              size="xsmall"
                              className="mt-1 text-ui-fg-subtle"
                            >
                              {refundCase.stripeRefundCount === null
                                ? "Audit pending"
                                : refundCountLabel(
                                    refundCase.stripeRefundCount,
                                  )}
                            </Text>
                          </Table.Cell>
                          <Table.Cell className="align-top">
                            <StatusBadge
                              color={taxStatusColor(refundCase.taxStatus)}
                            >
                              {taxStatusLabel(refundCase.taxStatus)}
                            </StatusBadge>
                            <Text
                              size="xsmall"
                              className="mt-2 text-ui-fg-subtle"
                            >
                              {providerLabel(refundCase.provider)}
                            </Text>
                          </Table.Cell>
                          <Table.Cell className="min-w-80 align-top">
                            <Text size="small">
                              {refundCase.nextAction}
                            </Text>
                            <div className="mt-3">
                              <OrderAction
                                canOpenOrder={canReadOrders}
                                refundCase={refundCase}
                              />
                            </div>
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table>
                </div>

                {pageCount > 1 ? (
                  <div className="mt-5 flex items-center justify-between gap-3">
                    <Button
                      disabled={safePage === 0}
                      onClick={handlePreviousPage}
                      size="small"
                      type="button"
                      variant="secondary"
                    >
                      Previous
                    </Button>
                    <Text size="small" className="text-ui-fg-subtle">
                      Page {safePage + 1} of {pageCount}
                    </Text>
                    <Button
                      disabled={safePage >= pageCount - 1}
                      onClick={handleNextPage}
                      size="small"
                      type="button"
                      variant="secondary"
                    >
                      Next
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <AdminEmptyState
                action={
                  snapshot.cases.length ? (
                    <Button
                      onClick={handleClearFilters}
                      size="small"
                      type="button"
                      variant="secondary"
                    >
                      Clear filters
                    </Button>
                  ) : null
                }
                className="mt-5 rounded-lg border border-dashed border-ui-border-base px-5 py-12"
                description={
                  snapshot.cases.length
                    ? "Clear or adjust the filters to see the rest of the refund audit."
                    : "When a refund is recorded, its Medusa, Stripe, and tax states will appear here automatically."
                }
                headingLevel="h3"
                icon={<ArrowUturnLeft />}
                title={
                  snapshot.cases.length
                    ? "No cases match these filters"
                    : "No refunds need monitoring"
                }
              />
            )}
          </Container>

          <Container>
            <div className="flex items-start gap-3">
              <ExclamationCircle className="mt-0.5 shrink-0 text-ui-fg-subtle" />
              <div>
                <Heading level="h2">Before closing a customer case</Heading>
                <Text size="small" className="mt-2 text-ui-fg-subtle">
                  Confirm the intended items and amount, the inventory outcome,
                  the customer note, and the final provider state. A
                  &ldquo;Verified&rdquo; row confirms system agreement; it
                  does not replace the customer conversation or the store&apos;s
                  return policy.
                </Text>
              </div>
            </div>
          </Container>
        </>
      ) : null}
    </AdminSingleColumnLayout>
  );
});

RefundOperationsPageContent.displayName = "RefundOperationsPageContent";

export const RefundOperationsPage = memo(() => (
  <AdminPermissionBoundary
    actions={operationsAdminActions.refundOperations.read}
    workspace="Refunds"
  >
    <RefundOperationsPageContent />
  </AdminPermissionBoundary>
));

RefundOperationsPage.displayName = "RefundOperationsPage";

const LegacyRefundOperationsPage = memo(() => {
  useEffect(() => {
    const { location } = globalThis as unknown as {
      location: ReplaceAdminLocation;
    };
    replaceLegacyOperationsLocation(location, "refunds");
  }, []);

  return null;
});

LegacyRefundOperationsPage.displayName = "LegacyRefundOperationsPage";

export default LegacyRefundOperationsPage;
