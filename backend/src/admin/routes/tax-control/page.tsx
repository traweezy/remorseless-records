"use client";

import {
  memo,
  useCallback,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { BuildingTax } from "@medusajs/icons";
import {
  Button,
  Container,
  Heading,
  Skeleton,
  StatusBadge,
  Table,
  Text,
  toast,
} from "@medusajs/ui";
import { getAdminRequestErrorMessage } from "../../lib/admin-request";
import { ProviderSwitchPrompt } from "./provider-switch-prompt";
import {
  refreshTaxRateIoQuota,
  switchTaxProvider,
  TAX_CONTROL_QUERY_KEY,
  taxControlQueryOptions,
  type ProviderReadiness,
  type TaxControlSnapshot,
} from "./query";
import {
  providerLabel,
  providerSwitchWasApplied,
  type ProviderName,
} from "./ui-state";

type ProviderCardProps = {
  active: boolean;
  children?: ReactNode;
  description: string;
  name: string;
  onSwitch: (
    provider: ProviderName,
    trigger: HTMLButtonElement,
  ) => void;
  provider: ProviderName;
  readiness: ProviderReadiness;
  saving: boolean;
};

type ProviderSwitchDraft = {
  idempotencyKey: string;
  targetProvider: ProviderName;
};

const incidentLabel = (
  incident: TaxControlSnapshot["evidence"]["incidents"][number],
): string => {
  if (incident.status === "disputed") {
    return "Disputed";
  }
  if (incident.status === "refund_pending") {
    return "Tax reversal pending";
  }
  if (incident.status === "refund_ledger_mismatch") {
    return "Refund ledger mismatch";
  }
  if (incident.associationStatus?.includes("refund_failed:")) {
    return "Refund failed";
  }
  if (incident.associationStatus?.includes("refund_list_truncated")) {
    return "Refund audit incomplete";
  }
  return "Tax association failed";
};

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

const formatMinorAmount = (amount: number, currencyCode: string): string =>
  new Intl.NumberFormat(undefined, {
    currency: currencyCode.toUpperCase(),
    style: "currency",
  }).format(amount / 100);

const quotaSourceLabel = (source: string): string =>
  source === "manual_refresh"
    ? "manual refresh"
    : source === "checkout_lookup"
      ? "checkout calculation"
      : "provider response";

const ProviderCard = memo<ProviderCardProps>(
  ({
    active,
    children,
    description,
    name,
    onSwitch,
    provider,
    readiness,
    saving,
  }) => {
    const handleSwitch = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onSwitch(provider, event.currentTarget);
      },
      [onSwitch, provider],
    );

    return (
      <section
        className="flex flex-col rounded-lg border border-ui-border-base p-4"
        aria-label={`${name}${active ? ", active provider" : ""}`}
        data-active={active ? "true" : "false"}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Heading level="h3">{name}</Heading>
            <Text
              id={`tax-provider-${provider}-description`}
              size="small"
              className="mt-1 text-ui-fg-subtle"
            >
              {description}
            </Text>
          </div>
          <div className="flex flex-wrap gap-2">
            {active ? <StatusBadge color="grey">Current</StatusBadge> : null}
            <StatusBadge color={readiness.ready ? "green" : "orange"}>
              {readiness.ready ? "Ready" : "Needs setup"}
            </StatusBadge>
          </div>
        </div>

        <Text size="small" className="mt-4">
          {readiness.message}
        </Text>
        <dl className="mt-4 flex flex-col divide-y divide-ui-border-base">
          {readiness.checks.map((item) => (
            <div
              key={item.id}
              className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
            >
              <dt className="min-w-0">
                <Text size="small" weight="plus">
                  {item.label}
                </Text>
                <Text size="xsmall" className="mt-0.5 text-ui-fg-subtle">
                  {item.detail}
                </Text>
              </dt>
              <dd className="shrink-0">
                <Text
                  size="xsmall"
                  weight="plus"
                  className={
                    item.ready ? "text-ui-fg-subtle" : "text-ui-fg-warning"
                  }
                >
                  {item.ready ? "Ready" : "Missing"}
                </Text>
              </dd>
            </div>
          ))}
        </dl>

        {children ? (
          <div className="mt-5 border-t border-ui-border-base pt-4">
            {children}
          </div>
        ) : null}

        <div className="mt-5 border-t border-ui-border-base pt-4">
          {active ? (
            <Text size="small" className="text-ui-fg-subtle">
              Used for new tax calculations.
            </Text>
          ) : (
            <>
              <Button
                aria-describedby={`tax-provider-${provider}-description`}
                disabled={!readiness.ready || saving}
                onClick={handleSwitch}
                type="button"
                variant="secondary"
              >
                Switch to {name}
              </Button>
              {!readiness.ready ? (
                <Text size="xsmall" className="mt-2 text-ui-fg-subtle">
                  Complete the missing setup before switching.
                </Text>
              ) : null}
            </>
          )}
        </div>
      </section>
    );
  },
);

const LoadingState = memo(() => (
  <div
    className="flex flex-col gap-4"
    aria-label="Loading tax control"
    role="status"
  >
    <Skeleton className="h-28 w-full" />
    <div className="grid gap-4 lg:grid-cols-2">
      <Skeleton className="h-80 w-full" />
      <Skeleton className="h-80 w-full" />
    </div>
  </div>
));

const TaxControlPage = memo(() => {
  const [switchDraft, setSwitchDraft] =
    useState<ProviderSwitchDraft | null>(null);
  const switchTriggerRef = useRef<HTMLButtonElement | null>(null);
  const quotaRefreshLockRef = useRef(false);
  const queryClient = useQueryClient();
  const taxControlQuery = useQuery(taxControlQueryOptions());
  const {
    isPending: saving,
    mutateAsync: mutateProviderSwitch,
    reset: resetProviderSwitch,
  } = useMutation({
    mutationFn: switchTaxProvider,
    retry: false,
  });
  const {
    isPending: refreshingQuota,
    mutateAsync: mutateQuotaRefresh,
  } = useMutation({
    mutationFn: refreshTaxRateIoQuota,
    retry: false,
  });
  const snapshot = taxControlQuery.data;

  const dismissProviderSwitch = useCallback(() => {
    const trigger = switchTriggerRef.current;
    setSwitchDraft(null);
    globalThis.setTimeout(() => {
      (
        trigger as unknown as {
          focus: () => void;
        } | null
      )?.focus();
    }, 0);
  }, []);

  const beginProviderSwitch = useCallback(
    (provider: ProviderName, trigger: HTMLButtonElement) => {
      if (!snapshot || provider === snapshot.control.activeProvider) {
        return;
      }
      const readiness =
        provider === "stripe_tax"
          ? snapshot.providers.stripeTax
          : snapshot.providers.taxRateIo;
      if (!readiness.ready) {
        return;
      }

      switchTriggerRef.current = trigger;
      resetProviderSwitch();
      setSwitchDraft({
        idempotencyKey: crypto.randomUUID(),
        targetProvider: provider,
      });
    },
    [resetProviderSwitch, snapshot],
  );

  const cancelProviderSwitch = useCallback(() => {
    if (!saving) {
      dismissProviderSwitch();
    }
  }, [dismissProviderSwitch, saving]);

  const confirmProviderSwitch = useCallback(
    async (reason: string) => {
      if (!snapshot || !switchDraft || saving) {
        return;
      }
      const input = {
        expectedGeneration: snapshot.control.generation,
        idempotencyKey: switchDraft.idempotencyKey,
        reason,
        targetProvider: switchDraft.targetProvider,
      };

      try {
        const next = await mutateProviderSwitch(input);
        queryClient.setQueryData(TAX_CONTROL_QUERY_KEY, next);
        dismissProviderSwitch();
        toast.success(
          `${providerLabel(switchDraft.targetProvider)} is now active`,
        );
        await queryClient.invalidateQueries({
          queryKey: TAX_CONTROL_QUERY_KEY,
        });
      } catch (caught) {
        const reconciled = await taxControlQuery.refetch();
        if (
          providerSwitchWasApplied({
            activeProvider: reconciled.data?.control.activeProvider,
            currentGeneration: reconciled.data?.control.generation,
            expectedGeneration: input.expectedGeneration,
            targetProvider: switchDraft.targetProvider,
          })
        ) {
          resetProviderSwitch();
          dismissProviderSwitch();
          toast.success(
            `${providerLabel(switchDraft.targetProvider)} switch confirmed after refresh`,
          );
          return;
        }
        toast.error(
          getAdminRequestErrorMessage(
            caught,
            "The provider could not be switched.",
          ),
        );
      }
    },
    [
      dismissProviderSwitch,
      mutateProviderSwitch,
      queryClient,
      resetProviderSwitch,
      saving,
      snapshot,
      switchDraft,
      taxControlQuery,
    ],
  );

  const refreshQuota = useCallback(async () => {
    if (quotaRefreshLockRef.current || refreshingQuota) {
      return;
    }
    quotaRefreshLockRef.current = true;
    try {
      const next = await mutateQuotaRefresh();
      queryClient.setQueryData(TAX_CONTROL_QUERY_KEY, next);
      toast.success("TaxRate.io quota refreshed");
      await queryClient.invalidateQueries({
        queryKey: TAX_CONTROL_QUERY_KEY,
      });
    } catch (caught) {
      toast.error(
        getAdminRequestErrorMessage(
          caught,
          "TaxRate.io quota could not be refreshed.",
        ),
      );
    } finally {
      quotaRefreshLockRef.current = false;
    }
  }, [mutateQuotaRefresh, queryClient, refreshingQuota]);

  const retryLoad = useCallback(() => {
    void taxControlQuery.refetch();
  }, [taxControlQuery]);

  if (taxControlQuery.isPending) {
    return <LoadingState />;
  }

  if (!snapshot) {
    const error = getAdminRequestErrorMessage(
      taxControlQuery.error,
      "The tax control state could not be loaded.",
    );
    return (
      <Container>
        <Heading>Tax control is unavailable</Heading>
        <Text className="mt-2 text-ui-fg-subtle">{error}</Text>
        <Button className="mt-4" onClick={retryLoad} type="button">
          Try again
        </Button>
      </Container>
    );
  }

  const quota = snapshot.providers.taxRateIo.quota;
  const quotaPercent = quota
    ? Math.max(0, Math.min(100, quota.usagePercent))
    : 0;
  const activeProvider = snapshot.control.activeProvider;
  const activeReadiness =
    activeProvider === "stripe_tax"
      ? snapshot.providers.stripeTax
      : snapshot.providers.taxRateIo;
  const activeCalculationBasis =
    activeProvider === "stripe_tax"
      ? "Shipping address and line tax codes"
      : "US shipping ZIP code";
  const activeProviderDetail =
    activeProvider === "stripe_tax"
      ? `${snapshot.providers.stripeTax.accountMode === "sandbox" ? "Sandbox" : snapshot.providers.stripeTax.accountMode === "live" ? "Live" : "Unknown"} account · ${snapshot.providers.stripeTax.activeRegistrationCount} active registration${
          snapshot.providers.stripeTax.activeRegistrationCount === 1 ? "" : "s"
        }`
      : quota
        ? `${quota.remaining} of ${quota.quota} monthly lookups remaining`
        : "No usage response recorded yet";

  return (
    <div className="flex flex-col gap-4">
      <Container>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Heading>Tax control</Heading>
            <Text className="mt-1 text-ui-fg-subtle">
              See the current setup, compare providers, and make a deliberate
              change when needed.
            </Text>
          </div>
          <StatusBadge color={activeReadiness.ready ? "green" : "orange"}>
            {activeReadiness.ready ? "Operational" : "Needs attention"}
          </StatusBadge>
        </div>

        <section
          aria-label={`Current provider: ${providerLabel(activeProvider)}`}
          className="mt-6 border-t border-ui-border-base pt-5"
          data-testid="active-provider-overview"
        >
          <Heading level="h2">Current setup</Heading>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Provider
              </Text>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Text size="small" weight="plus">
                  {providerLabel(activeProvider)}
                </Text>
                <StatusBadge color="grey">Current</StatusBadge>
              </div>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Calculation method
              </Text>
              <Text size="small" weight="plus" className="mt-1">
                {activeCalculationBasis}
              </Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Connection
              </Text>
              <Text size="small" weight="plus" className="mt-1">
                {activeProviderDetail}
              </Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Last changed
              </Text>
              <Text size="small" weight="plus" className="mt-1">
                {formatDate(snapshot.control.lastSwitchedAt)}
              </Text>
              {snapshot.control.lastSwitchedBy ? (
                <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                  By {snapshot.control.lastSwitchedBy}
                </Text>
              ) : null}
            </div>
          </div>

          <div className="mt-5 rounded-md bg-ui-bg-subtle p-3">
            <Text size="xsmall" className="text-ui-fg-subtle">
              Last change reason
            </Text>
            <Text size="small" className="mt-1">
              {snapshot.control.lastSwitchReason ??
                "Initial provider configuration; no switch has been recorded."}
            </Text>
          </div>
        </section>

        <section
          aria-labelledby="switch-impact-title"
          className="mt-5 rounded-lg border border-ui-border-base p-4"
        >
          <Heading id="switch-impact-title" level="h3">
            If the provider changes
          </Heading>
          <Text size="small" className="mt-1 text-ui-fg-subtle">
            New or refreshed quotes use the new provider. Existing reviewed
            quotes and completed orders are not repriced.
          </Text>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <Text size="large" weight="plus">
                {snapshot.impact.preparedCheckouts}
              </Text>
              <Text size="small" weight="plus" className="mt-1">
                Provider-locked checkouts
              </Text>
              <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                Open carts updated within the last{" "}
                {snapshot.impact.activityWindowDays} days that already have a
                processable Stripe payment session.
              </Text>
            </div>
            <div>
              <Text size="large" weight="plus">
                {snapshot.impact.paymentsFinalizing}
              </Text>
              <Text size="small" weight="plus" className="mt-1">
                Payments completing
              </Text>
              <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                A subset of those checkouts with a payment authorizing,
                authorized, or captured before order completion.
              </Text>
            </div>
          </div>
        </section>
      </Container>

      <Container>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Heading level="h2">Providers</Heading>
            <Text size="small" className="mt-1 text-ui-fg-subtle">
              Compare each provider&apos;s readiness and use its switch button
              to review a change.
            </Text>
          </div>
        </div>

        <div className="mt-5 grid items-start gap-4 lg:grid-cols-2">
          <ProviderCard
            active={activeProvider === "taxrate_io"}
            description="ZIP-code sales-tax rates with a monthly lookup quota."
            name="TaxRate.io"
            onSwitch={beginProviderSwitch}
            provider="taxrate_io"
            readiness={snapshot.providers.taxRateIo}
            saving={saving}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Text size="small" weight="plus">
                  Monthly lookup usage
                </Text>
                <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                  Reported by TaxRate.io, not estimated from cart traffic.
                </Text>
              </div>
              <Button
                disabled={
                  refreshingQuota ||
                  !snapshot.providers.taxRateIo.manualRefreshConfigured
                }
                isLoading={refreshingQuota}
                onClick={refreshQuota}
                type="button"
                variant="secondary"
              >
                Refresh · uses 1 lookup
              </Button>
            </div>

            {quota ? (
              <div className="mt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Text size="small" weight="plus">
                    {quota.remaining} of {quota.quota} lookups remaining
                  </Text>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    Checked {formatDate(quota.observedAt)}
                  </Text>
                </div>
                <div
                  aria-label="TaxRate.io quota used"
                  aria-valuemax={quota.quota}
                  aria-valuemin={0}
                  aria-valuenow={quota.usage}
                  className="mt-2 h-2 overflow-hidden rounded-full bg-ui-bg-subtle"
                  role="progressbar"
                >
                  <div
                    className="h-full rounded-full bg-ui-tag-blue-icon transition-[width] duration-200 motion-reduce:transition-none"
                    style={{ width: `${quotaPercent}%` }}
                  />
                </div>
                <Text size="xsmall" className="mt-2 text-ui-fg-subtle">
                  {quota.usage} used this provider period · last updated by{" "}
                  {quotaSourceLabel(quota.source)}
                </Text>
              </div>
            ) : (
              <Text size="small" className="mt-4 text-ui-fg-subtle">
                No provider usage response has been recorded. A real checkout
                lookup updates this automatically.
              </Text>
            )}

            {!snapshot.providers.taxRateIo.manualRefreshConfigured ? (
              <div className="mt-4 rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
                <Text size="small" weight="plus" className="text-ui-fg-warning">
                  Manual usage refresh needs setup
                </Text>
                <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                  Checkout calculations still record usage automatically. A
                  monitoring ZIP code is only needed for this manual refresh.
                </Text>
              </div>
            ) : null}
          </ProviderCard>

          <ProviderCard
            active={activeProvider === "stripe_tax"}
            description="Address-aware calculations linked to Stripe payments, reporting, and refund reversals."
            name="Stripe Tax"
            onSwitch={beginProviderSwitch}
            provider="stripe_tax"
            readiness={snapshot.providers.stripeTax}
            saving={saving}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md bg-ui-bg-subtle p-3">
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Stripe account
                </Text>
                <Text size="small" weight="plus" className="mt-1 capitalize">
                  {snapshot.providers.stripeTax.accountMode}
                </Text>
              </div>
              <div className="rounded-md bg-ui-bg-subtle p-3">
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Active tax registrations
                </Text>
                <Text size="small" weight="plus" className="mt-1">
                  {snapshot.providers.stripeTax.activeRegistrationCount}
                </Text>
              </div>
            </div>
          </ProviderCard>
        </div>

        {switchDraft ? (
          <ProviderSwitchPrompt
            activeProvider={activeProvider}
            impact={snapshot.impact}
            onCancel={cancelProviderSwitch}
            onConfirm={confirmProviderSwitch}
            pending={saving}
            targetProvider={switchDraft.targetProvider}
          />
        ) : null}
      </Container>

      <Container>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Heading level="h2">Payment tax evidence</Heading>
            <Text size="small" className="mt-1 text-ui-fg-subtle">
              Stripe payments are linked to the exact tax quote used at checkout
              and rechecked after captures and refunds.
            </Text>
          </div>
          <StatusBadge
            color={
              snapshot.evidence.needsAttention
                ? "red"
                : snapshot.evidence.pendingRefundReversals
                  ? "orange"
                  : "green"
            }
          >
            {snapshot.evidence.needsAttention
              ? `${snapshot.evidence.needsAttention} need attention`
              : snapshot.evidence.pendingRefundReversals
                ? `${snapshot.evidence.pendingRefundReversals} reversal${
                    snapshot.evidence.pendingRefundReversals === 1 ? "" : "s"
                  } pending`
                : "No tax incidents"}
          </StatusBadge>
        </div>

        <Text size="small" className="mt-5 text-ui-fg-subtle">
          {snapshot.evidence.tracked} payment tax record
          {snapshot.evidence.tracked === 1 ? " is" : "s are"} tracked:{" "}
          {snapshot.evidence.succeeded} successful and{" "}
          {snapshot.evidence.refunds} partially or fully refunded.
        </Text>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-md bg-ui-bg-subtle p-3">
            <Text size="large" weight="plus">
              {snapshot.evidence.prepared}
            </Text>
            <Text size="small" weight="plus" className="mt-1">
              Awaiting payment outcome
            </Text>
            <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
              Tax evidence exists, but the related payment has not reached a
              final result.
            </Text>
          </div>
          <div className="rounded-md bg-ui-bg-subtle p-3">
            <Text size="large" weight="plus">
              {snapshot.evidence.pendingRefundReversals}
            </Text>
            <Text size="small" weight="plus" className="mt-1">
              Tax reversals pending
            </Text>
            <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
              Refunds recorded in Medusa that still need a confirmed tax
              reversal.
            </Text>
          </div>
          <div className="rounded-md bg-ui-bg-subtle p-3">
            <Text size="large" weight="plus">
              {snapshot.evidence.refundLedger.mismatches}
            </Text>
            <Text size="small" weight="plus" className="mt-1">
              Refund amount mismatches
            </Text>
            <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
              Tracked payments where Medusa and Stripe report different refund
              totals.
            </Text>
          </div>
        </div>

        <div className="mt-5 rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
          <Text size="small" weight="plus">
            Start every refund in Medusa
          </Text>
          <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
            Use the order payment actions here so Medusa records the refund and
            sends it to Stripe. A refund created directly in Stripe can reverse
            Stripe Tax, but it does not update Medusa&apos;s order ledger.
          </Text>
        </div>
        {!snapshot.evidence.refundLedger.available ? (
          <div className="mt-3 rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
            <Text size="small" weight="plus" className="text-ui-fg-warning">
              Refund ledger comparison is unavailable
            </Text>
            <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
              Tax evidence is still visible, but Medusa and Stripe refund
              amounts could not be compared. Check backend logs before
              processing another refund.
            </Text>
          </div>
        ) : (
          <Text size="xsmall" className="mt-3 text-ui-fg-subtle">
            Compared {snapshot.evidence.refundLedger.checked} tracked payment
            {snapshot.evidence.refundLedger.checked === 1 ? "" : "s"} against
            Medusa&apos;s refund ledger.
          </Text>
        )}
        {snapshot.evidence.refundLedger.truncated ? (
          <Text size="xsmall" className="mt-2 text-ui-fg-warning">
            The refund comparison reached its 500-payment safety limit. Review
            older records through the reconciliation runbook.
          </Text>
        ) : null}

        {snapshot.evidence.incidents.length ? (
          <div className="mt-5 overflow-x-auto">
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Status</Table.HeaderCell>
                  <Table.HeaderCell>Order</Table.HeaderCell>
                  <Table.HeaderCell>PaymentIntent</Table.HeaderCell>
                  <Table.HeaderCell>Association</Table.HeaderCell>
                  <Table.HeaderCell>Verified</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {snapshot.evidence.incidents.map((incident) => (
                  <Table.Row key={incident.id}>
                    <Table.Cell>
                      <StatusBadge
                        color={
                          incident.status === "refund_pending"
                            ? "orange"
                            : "red"
                        }
                      >
                        {incidentLabel(incident)}
                      </StatusBadge>
                    </Table.Cell>
                    <Table.Cell>{incident.orderId ?? "Not placed"}</Table.Cell>
                    <Table.Cell>{incident.paymentIntentId}</Table.Cell>
                    <Table.Cell>
                      {incident.status === "refund_ledger_mismatch" &&
                      incident.medusaRefundAmountMinor !== null &&
                      incident.stripeRefundAmountMinor !== null ? (
                        <>
                          Medusa{" "}
                          {formatMinorAmount(
                            incident.medusaRefundAmountMinor,
                            incident.currencyCode,
                          )}{" "}
                          · Stripe{" "}
                          {incident.stripeEvidenceAvailable
                            ? formatMinorAmount(
                                incident.stripeRefundAmountMinor,
                                incident.currencyCode,
                              )
                            : "not yet verified"}
                        </>
                      ) : (
                        (incident.associationStatus ?? "Unknown")
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      {formatDate(incident.lastVerifiedAt)}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        ) : null}
      </Container>

      <Container>
        <Heading level="h2">Provider history</Heading>
        {snapshot.audits.length ? (
          <div className="mt-4 overflow-x-auto">
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell>Date</Table.HeaderCell>
                  <Table.HeaderCell>Change</Table.HeaderCell>
                  <Table.HeaderCell>Reason</Table.HeaderCell>
                  <Table.HeaderCell>Admin</Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {snapshot.audits.map((audit) => (
                  <Table.Row key={audit.id}>
                    <Table.Cell>{formatDate(audit.createdAt)}</Table.Cell>
                    <Table.Cell>
                      {providerLabel(audit.fromProvider)} →{" "}
                      {providerLabel(audit.toProvider)}
                    </Table.Cell>
                    <Table.Cell className="min-w-64">{audit.reason}</Table.Cell>
                    <Table.Cell>{audit.actorId}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        ) : (
          <Text size="small" className="mt-4 text-ui-fg-subtle">
            No provider switches have been recorded.
          </Text>
        )}
      </Container>
    </div>
  );
});

export const config = defineRouteConfig({
  icon: BuildingTax,
  label: "Tax control",
});

export default TaxControlPage;
