"use client"

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Alert,
  Button,
  Container,
  Heading,
  Skeleton,
  StatusBadge,
  Table,
  Text,
  toast,
} from "@medusajs/ui"
import { operationsAdminActions } from "../../../lib/admin-permissions"
import { AdminPermissionBoundary } from "../../components/admin-permission-boundary"
import {
  AdminPageHeader,
  AdminSingleColumnLayout,
} from "../../components/admin-page"
import { AdminRetryState } from "../../components/admin-retry-state"
import { replaceLegacyTaxControlLocation } from "../../features/operations/operations-routes"
import { useAdminPermissions } from "../../lib/admin-permissions"
import { getAdminRequestErrorMessage } from "../../lib/admin-request"
import {
  TaxControlTransitionPrompt,
  type TaxControlTransitionConfirmation,
} from "./provider-switch-prompt"
import {
  refreshTaxRateIoQuota,
  TAX_CONTROL_QUERY_KEY,
  taxControlQueryOptions,
  transitionTaxControl,
  type ProviderReadiness,
  type TaxControlSnapshot,
} from "./query"
import {
  collectionChoiceLabel,
  providerLabel,
  taxControlTransitionWasApplied,
  type CollectionMode,
  type ProviderName,
} from "./ui-state"

type ProviderCardProps = {
  active: boolean
  canUpdate: boolean
  children?: ReactNode
  description: string
  name: string
  onSwitch: (provider: ProviderName, trigger: HTMLButtonElement) => void
  provider: ProviderName
  readiness: ProviderReadiness
  saving: boolean
  selectedForReenable: boolean
}

type TaxControlTransitionDraft = {
  idempotencyKey: string
  targetCollectionMode: CollectionMode
  targetProvider: ProviderName
}

const incidentLabel = (
  incident: TaxControlSnapshot["evidence"]["incidents"][number]
): string => {
  if (incident.status === "disputed") {
    return "Disputed"
  }
  if (incident.status === "refund_pending") {
    return "Tax reversal pending"
  }
  if (incident.status === "refund_ledger_mismatch") {
    return "Refund ledger mismatch"
  }
  if (incident.associationStatus?.includes("refund_failed:")) {
    return "Refund failed"
  }
  if (incident.associationStatus?.includes("refund_list_truncated")) {
    return "Refund audit incomplete"
  }
  return "Tax association failed"
}

const formatDate = (value: string | null): string => {
  if (!value) {
    return "Not yet"
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date)
}

const formatMinorAmount = (amount: number, currencyCode: string): string =>
  new Intl.NumberFormat(undefined, {
    currency: currencyCode.toUpperCase(),
    style: "currency",
  }).format(amount / 100)

const quotaSourceLabel = (source: string): string =>
  source === "manual_refresh"
    ? "manual refresh"
    : source === "checkout_lookup"
      ? "checkout calculation"
      : "provider response"

const ProviderCard = memo<ProviderCardProps>(
  ({
    active,
    canUpdate,
    children,
    description,
    name,
    onSwitch,
    provider,
    readiness,
    saving,
    selectedForReenable,
  }) => {
    const handleSwitch = useCallback(
      (event: MouseEvent<HTMLButtonElement>) => {
        onSwitch(provider, event.currentTarget)
      },
      [onSwitch, provider]
    )

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
            {selectedForReenable ? (
              <StatusBadge color="blue">Selected for re-enable</StatusBadge>
            ) : null}
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
              Used to collect tax on new or refreshed checkouts.
            </Text>
          ) : canUpdate ? (
            <>
              <Button
                aria-describedby={`tax-provider-${provider}-description`}
                disabled={!readiness.ready || saving}
                onClick={handleSwitch}
                type="button"
                variant="secondary"
              >
                Collect using {name}
              </Button>
              {!readiness.ready ? (
                <Text size="xsmall" className="mt-2 text-ui-fg-subtle">
                  Complete the missing setup before switching.
                </Text>
              ) : null}
            </>
          ) : (
            <Text size="small" className="text-ui-fg-subtle">
              View-only access. A role with Tax control update permission is
              required to change tax collection.
            </Text>
          )}
        </div>
      </section>
    )
  }
)

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
))

export const TaxControlPageContent = memo(() => {
  const [transitionDraft, setTransitionDraft] =
    useState<TaxControlTransitionDraft | null>(null)
  const transitionTriggerRef = useRef<HTMLButtonElement | null>(null)
  const quotaRefreshLockRef = useRef(false)
  const queryClient = useQueryClient()
  const permissions = useAdminPermissions()
  const canUpdate = permissions.hasPermission(
    operationsAdminActions.taxControl.update
  )
  const taxControlQuery = useQuery(taxControlQueryOptions())
  const {
    isPending: saving,
    mutateAsync: mutateTaxControlTransition,
    reset: resetTaxControlTransition,
  } = useMutation({
    mutationFn: transitionTaxControl,
    retry: false,
  })
  const { isPending: refreshingQuota, mutateAsync: mutateQuotaRefresh } =
    useMutation({
      mutationFn: refreshTaxRateIoQuota,
      retry: false,
    })
  const snapshot = taxControlQuery.data

  const dismissTaxControlTransition = useCallback(() => {
    const trigger = transitionTriggerRef.current
    setTransitionDraft(null)
    globalThis.setTimeout(() => {
      trigger?.focus()
    }, 0)
  }, [])

  const beginTaxControlTransition = useCallback(
    (
      targetCollectionMode: CollectionMode,
      provider: ProviderName,
      trigger: HTMLButtonElement
    ) => {
      if (
        !canUpdate ||
        !snapshot ||
        (targetCollectionMode === snapshot.control.collectionMode &&
          provider === snapshot.control.activeProvider)
      ) {
        return
      }
      if (targetCollectionMode === "collect") {
        const readiness =
          provider === "stripe_tax"
            ? snapshot.providers.stripeTax
            : snapshot.providers.taxRateIo
        if (!readiness.ready) {
          return
        }
      }

      transitionTriggerRef.current = trigger
      resetTaxControlTransition()
      setTransitionDraft({
        idempotencyKey: crypto.randomUUID(),
        targetCollectionMode,
        targetProvider: provider,
      })
    },
    [canUpdate, resetTaxControlTransition, snapshot]
  )

  const beginProviderCollection = useCallback(
    (provider: ProviderName, trigger: HTMLButtonElement) => {
      beginTaxControlTransition("collect", provider, trigger)
    },
    [beginTaxControlTransition]
  )

  const beginDisableCollection = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (snapshot) {
        beginTaxControlTransition(
          "disabled",
          snapshot.control.activeProvider,
          event.currentTarget
        )
      }
    },
    [beginTaxControlTransition, snapshot]
  )

  const cancelTaxControlTransition = useCallback(() => {
    if (!saving) {
      dismissTaxControlTransition()
    }
  }, [dismissTaxControlTransition, saving])

  const confirmTaxControlTransition = useCallback(
    async ({ acknowledgement, reason }: TaxControlTransitionConfirmation) => {
      if (!canUpdate || !snapshot || !transitionDraft || saving) {
        return
      }
      const transitionBase = {
        expectedGeneration: snapshot.control.generation,
        idempotencyKey: transitionDraft.idempotencyKey,
        reason,
        targetProvider: transitionDraft.targetProvider,
      }
      const input =
        transitionDraft.targetCollectionMode === "disabled"
          ? {
              ...transitionBase,
              acknowledgement: acknowledgement ?? "",
              targetCollectionMode: "disabled" as const,
            }
          : {
              ...transitionBase,
              targetCollectionMode: "collect" as const,
            }
      const targetLabel = collectionChoiceLabel(
        transitionDraft.targetCollectionMode,
        transitionDraft.targetProvider
      )

      try {
        const next = await mutateTaxControlTransition(input)
        queryClient.setQueryData(TAX_CONTROL_QUERY_KEY, next)
        dismissTaxControlTransition()
        toast.success(`${targetLabel} is now active`)
        await queryClient.invalidateQueries({
          queryKey: TAX_CONTROL_QUERY_KEY,
        })
      } catch (caught) {
        const reconciled = await taxControlQuery.refetch()
        if (
          taxControlTransitionWasApplied({
            activeProvider: reconciled.data?.control.activeProvider,
            collectionMode: reconciled.data?.control.collectionMode,
            currentGeneration: reconciled.data?.control.generation,
            expectedGeneration: input.expectedGeneration,
            targetCollectionMode: transitionDraft.targetCollectionMode,
            targetProvider: transitionDraft.targetProvider,
          })
        ) {
          resetTaxControlTransition()
          dismissTaxControlTransition()
          toast.success(`${targetLabel} was confirmed after refresh`)
          return
        }
        toast.error(
          getAdminRequestErrorMessage(
            caught,
            "The tax collection decision could not be changed."
          )
        )
      }
    },
    [
      canUpdate,
      dismissTaxControlTransition,
      mutateTaxControlTransition,
      queryClient,
      resetTaxControlTransition,
      saving,
      snapshot,
      transitionDraft,
      taxControlQuery,
    ]
  )

  const refreshQuota = useCallback(async () => {
    if (!canUpdate || quotaRefreshLockRef.current || refreshingQuota) {
      return
    }
    quotaRefreshLockRef.current = true
    try {
      const next = await mutateQuotaRefresh()
      queryClient.setQueryData(TAX_CONTROL_QUERY_KEY, next)
      toast.success("TaxRate.io quota refreshed")
      await queryClient.invalidateQueries({
        queryKey: TAX_CONTROL_QUERY_KEY,
      })
    } catch (caught) {
      toast.error(
        getAdminRequestErrorMessage(
          caught,
          "TaxRate.io quota could not be refreshed."
        )
      )
    } finally {
      quotaRefreshLockRef.current = false
    }
  }, [canUpdate, mutateQuotaRefresh, queryClient, refreshingQuota])

  const retryLoad = useCallback(() => {
    void taxControlQuery.refetch()
  }, [taxControlQuery])

  if (taxControlQuery.isPending) {
    return <LoadingState />
  }

  if (!snapshot) {
    const error = getAdminRequestErrorMessage(
      taxControlQuery.error,
      "The tax control state could not be loaded."
    )
    return (
      <AdminRetryState
        message={error}
        onRetry={retryLoad}
        retrying={taxControlQuery.isFetching}
        title="Tax control is unavailable"
      />
    )
  }

  const quota = snapshot.providers.taxRateIo.quota
  const quotaPercent = quota
    ? Math.max(0, Math.min(100, quota.usagePercent))
    : 0
  const activeProvider = snapshot.control.activeProvider
  const collectionMode = snapshot.control.collectionMode
  const collectingTax = collectionMode === "collect"
  const selectedProviderReadiness =
    activeProvider === "stripe_tax"
      ? snapshot.providers.stripeTax
      : snapshot.providers.taxRateIo
  const activeCalculationBasis = !collectingTax
    ? "$0.00 decision without a provider lookup"
    : activeProvider === "stripe_tax"
      ? "Shipping address and line tax codes"
      : "US shipping ZIP code"
  const activeProviderDetail =
    activeProvider === "stripe_tax"
      ? `${snapshot.providers.stripeTax.accountMode === "sandbox" ? "Sandbox" : snapshot.providers.stripeTax.accountMode === "live" ? "Live" : "Unknown"} account · ${snapshot.providers.stripeTax.activeRegistrationCount} active registration${
          snapshot.providers.stripeTax.activeRegistrationCount === 1 ? "" : "s"
        }`
      : quota
        ? `${quota.remaining} of ${quota.quota} monthly lookups remaining`
        : "No usage response recorded yet"

  return (
    <AdminSingleColumnLayout>
      <Container>
        <AdminPageHeader
          description="Choose whether new checkouts collect tax, review provider readiness, and keep every change auditable."
          status={
            <StatusBadge
              color={
                !collectingTax
                  ? "orange"
                  : selectedProviderReadiness.ready
                    ? "green"
                    : "orange"
              }
            >
              {!collectingTax
                ? "Tax not collected"
                : selectedProviderReadiness.ready
                  ? "Collecting tax"
                  : "Needs attention"}
            </StatusBadge>
          }
          title="Tax control"
        />

        <section
          aria-label={`Current tax collection decision: ${collectionChoiceLabel(
            collectionMode,
            activeProvider
          )}`}
          className="mt-6 border-t border-ui-border-base pt-5"
          data-testid="active-provider-overview"
        >
          <Heading level="h2">Current setup</Heading>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Collection decision
              </Text>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Text size="small" weight="plus">
                  {collectingTax ? "Collect tax" : "Do not collect tax"}
                </Text>
                <StatusBadge color="grey">Current</StatusBadge>
              </div>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {collectingTax ? "Provider" : "Provider when re-enabled"}
              </Text>
              <Text size="small" weight="plus" className="mt-1">
                {providerLabel(activeProvider)}
              </Text>
            </div>
            <div>
              <Text size="xsmall" className="text-ui-fg-subtle">
                Checkout behavior
              </Text>
              <Text size="small" weight="plus" className="mt-1">
                {activeCalculationBasis}
              </Text>
              {collectingTax ? (
                <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                  {activeProviderDetail}
                </Text>
              ) : null}
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

          {!collectingTax ? (
            <Alert className="mt-5" variant="warning">
              New eligible checkouts receive an explicit $0.00 tax decision.
              Sales remain visible as pending tax review; this setting does not
              classify them as exempt or nontaxable.
            </Alert>
          ) : null}

          <div className="mt-5 rounded-md bg-ui-bg-subtle p-3">
            <Text size="xsmall" className="text-ui-fg-subtle">
              Last change reason
            </Text>
            <Text size="small" className="mt-1">
              {snapshot.control.lastSwitchReason ??
                "Initial tax control configuration; no change has been recorded."}
            </Text>
          </div>
        </section>

        <section
          aria-labelledby="switch-impact-title"
          className="mt-5 rounded-lg border border-ui-border-base p-4"
        >
          <Heading id="switch-impact-title" level="h3">
            When the collection decision changes
          </Heading>
          <Text size="small" className="mt-1 text-ui-fg-subtle">
            New or refreshed quotes use the new decision. Existing reviewed
            quotes and completed orders keep their historical tax decision.
          </Text>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Text size="large" weight="plus">
                {snapshot.impact.preparedCheckouts}
              </Text>
              <Text size="small" weight="plus" className="mt-1">
                Decision-locked checkouts
              </Text>
              <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                Open carts updated within the last{" "}
                {snapshot.impact.activityWindowDays} days that already have a
                processable Stripe payment session.
              </Text>
            </div>
            <div>
              <Text size="large" weight="plus">
                {snapshot.impact.frozenByCollectionMode.collect}
              </Text>
              <Text size="small" weight="plus" className="mt-1">
                Frozen collecting
              </Text>
              <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                Prepared checkouts that keep their provider-backed tax quote.
              </Text>
            </div>
            <div>
              <Text size="large" weight="plus">
                {snapshot.impact.frozenByCollectionMode.disabled}
              </Text>
              <Text size="small" weight="plus" className="mt-1">
                Frozen not collecting
              </Text>
              <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                Prepared checkouts that keep their reviewed $0.00 tax decision.
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
        <div>
          <Heading level="h2">Choose tax collection</Heading>
          <Text size="small" className="mt-1 text-ui-fg-subtle">
            Start with the operating decision. Provider setup remains available
            below and is only used while tax collection is on.
          </Text>
        </div>

        <section
          aria-label={`Do not collect tax${!collectingTax ? ", current decision" : ""}`}
          className="mt-5 rounded-lg border border-ui-border-base p-4"
          data-active={!collectingTax ? "true" : "false"}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Heading level="h3">Do not collect tax</Heading>
              <Text
                id="tax-collection-disabled-description"
                size="small"
                className="mt-1 text-ui-fg-subtle"
              >
                Record an explicit $0.00 decision for new eligible checkouts
                without calling a tax provider.
              </Text>
            </div>
            {!collectingTax ? (
              <StatusBadge color="grey">Current</StatusBadge>
            ) : null}
          </div>
          <div className="mt-4 rounded-md bg-ui-bg-subtle p-3">
            <Text size="xsmall" className="text-ui-fg-subtle">
              Existing prepared checkouts and completed orders keep their frozen
              decision. New disabled sales are reported separately as pending
              tax review, never as automatically exempt or nontaxable.
            </Text>
          </div>
          <div className="mt-4 border-t border-ui-border-base pt-4">
            {!collectingTax ? (
              <Text size="small" className="text-ui-fg-subtle">
                Used for new or refreshed checkout tax decisions.
              </Text>
            ) : canUpdate ? (
              <Button
                aria-describedby="tax-collection-disabled-description"
                disabled={saving}
                onClick={beginDisableCollection}
                type="button"
                variant="danger"
              >
                Review turning off tax collection
              </Button>
            ) : (
              <Text size="small" className="text-ui-fg-subtle">
                View-only access. A role with Tax control update permission is
                required to change tax collection.
              </Text>
            )}
          </div>
        </section>

        <div className="mt-8">
          <Heading level="h2">Collect tax with a provider</Heading>
          <Text size="small" className="mt-1 text-ui-fg-subtle">
            Compare readiness, then choose the provider that should calculate
            tax for new or refreshed checkouts.
          </Text>
        </div>

        <div className="mt-5 grid items-start gap-4 lg:grid-cols-2">
          <ProviderCard
            active={collectingTax && activeProvider === "taxrate_io"}
            canUpdate={canUpdate}
            description="ZIP-code sales-tax rates with a monthly lookup quota."
            name="TaxRate.io"
            onSwitch={beginProviderCollection}
            provider="taxrate_io"
            readiness={snapshot.providers.taxRateIo}
            saving={saving}
            selectedForReenable={
              !collectingTax && activeProvider === "taxrate_io"
            }
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
              {canUpdate ? (
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
              ) : (
                <Text size="xsmall" className="text-ui-fg-subtle">
                  View-only access
                </Text>
              )}
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
            active={collectingTax && activeProvider === "stripe_tax"}
            canUpdate={canUpdate}
            description="Address-aware calculations linked to Stripe payments, reporting, and refund reversals."
            name="Stripe Tax"
            onSwitch={beginProviderCollection}
            provider="stripe_tax"
            readiness={snapshot.providers.stripeTax}
            saving={saving}
            selectedForReenable={
              !collectingTax && activeProvider === "stripe_tax"
            }
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

        {canUpdate && transitionDraft ? (
          <TaxControlTransitionPrompt
            activeCollectionMode={collectionMode}
            activeProvider={activeProvider}
            impact={snapshot.impact}
            onCancel={cancelTaxControlTransition}
            onConfirm={confirmTaxControlTransition}
            pending={saving}
            targetCollectionMode={transitionDraft.targetCollectionMode}
            targetProvider={transitionDraft.targetProvider}
          />
        ) : null}
      </Container>

      <Container>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Heading level="h2">Payment tax evidence</Heading>
            <Text size="small" className="mt-1 text-ui-fg-subtle">
              Stripe payments are linked to the exact collection decision used
              at checkout and rechecked after captures and refunds.
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
                            incident.currencyCode
                          )}{" "}
                          · Stripe{" "}
                          {incident.stripeEvidenceAvailable
                            ? formatMinorAmount(
                                incident.stripeRefundAmountMinor,
                                incident.currencyCode
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
        <Heading level="h2">Tax decision history</Heading>
        <Text size="small" className="mt-1 text-ui-fg-subtle">
          Every provider or collection-mode change records the administrator,
          reason, generation, and control acknowledgement version.
        </Text>
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
                      <Text size="small" weight="plus">
                        {collectionChoiceLabel(
                          audit.fromCollectionMode,
                          audit.fromProvider
                        )}{" "}
                        →{" "}
                        {collectionChoiceLabel(
                          audit.toCollectionMode,
                          audit.toProvider
                        )}
                      </Text>
                      <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                        Generation {audit.fromGeneration} → {audit.toGeneration}
                      </Text>
                    </Table.Cell>
                    <Table.Cell className="min-w-64">
                      {audit.reason}
                      <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                        Control {audit.acknowledgementVersion}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>{audit.actorId}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>
        ) : (
          <Text size="small" className="mt-4 text-ui-fg-subtle">
            No tax collection changes have been recorded.
          </Text>
        )}
      </Container>
    </AdminSingleColumnLayout>
  )
})

TaxControlPageContent.displayName = "TaxControlPageContent"

export const TaxControlPage = memo(() => (
  <AdminPermissionBoundary
    actions={operationsAdminActions.taxControl.read}
    workspace="Tax control"
  >
    <TaxControlPageContent />
  </AdminPermissionBoundary>
))

TaxControlPage.displayName = "TaxControlPage"

const LegacyTaxControlPage = memo(() => {
  useEffect(() => {
    const { location } = globalThis
    replaceLegacyTaxControlLocation(location)
  }, [])

  return null
})

LegacyTaxControlPage.displayName = "LegacyTaxControlPage"

export default LegacyTaxControlPage
