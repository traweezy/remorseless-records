"use client"

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from "react"
import { ArrowDownTray } from "@medusajs/icons"
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
} from "@medusajs/ui"
import { useQuery } from "@tanstack/react-query"

import { operationsAdminActions } from "../../../lib/admin-permissions"
import { AdminPermissionBoundary } from "../../components/admin-permission-boundary"
import {
  AdminPageHeader,
  AdminSingleColumnLayout,
} from "../../components/admin-page"
import { AdminRetryState } from "../../components/admin-retry-state"
import { AdminStatCard } from "../../components/admin-stat-card"
import { OperationsWorkspaceNavigation } from "../../features/operations/operations-navigation"
import {
  replaceLegacyOperationsLocation,
  type ReplaceAdminLocation,
} from "../../features/operations/operations-routes"
import {
  filingBucketFor,
  TAX_FILING_PROFILES,
  TAX_FILING_STATES,
  type TaxFilingState,
} from "../../../lib/tax-reporting/filing-states"
import {
  taxPeriodForPreset,
  taxPeriodPresetOptions,
  type TaxPeriodPreset,
} from "../../../lib/tax-reporting/periods"
import type {
  TaxDestinationSummary,
  TaxRecord,
  TaxRecordProvider,
  TaxRecordQuality,
} from "../../../lib/tax-reporting/types"
import { getAdminRequestErrorMessage } from "../../lib/admin-request"
import { taxRecordsQueryOptions, type TaxRecordFilters } from "./query"

const INITIAL_FILTERS: TaxRecordFilters = {
  collectionMode: "all",
  limit: 50,
  page: 1,
  provider: "all",
  q: "",
  quality: "all",
  type: "all",
}

type UiPeriod = { end: string; start: string }

const uiPeriodForPreset = (
  filingState: TaxFilingState,
  preset: TaxPeriodPreset
): UiPeriod => {
  const period = taxPeriodForPreset({ filingState, preset })
  return { end: period.endDate, start: period.startDate }
}

const formatMoney = (value: string, currencyCode = "usd"): string =>
  new Intl.NumberFormat(undefined, {
    currency: currencyCode.toUpperCase(),
    style: "currency",
  }).format(Number(value))

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))

const providerLabel = (provider: TaxRecordProvider): string => {
  if (provider === "not_applicable") {
    return "Not applicable"
  }
  if (provider === "taxrate_io") {
    return "TaxRate.io"
  }
  if (provider === "stripe_tax") {
    return "Stripe Tax"
  }
  return `${provider.charAt(0).toUpperCase()}${provider.slice(1)}`
}

const qualityColor = (quality: TaxRecordQuality): "green" | "orange" | "red" =>
  quality === "complete" ? "green" : quality === "review" ? "orange" : "red"

const qualityLabel = (quality: TaxRecordQuality): string =>
  quality === "complete"
    ? "Complete"
    : quality === "review"
      ? "Review"
      : "Incomplete"

const destinationLabel = (record: TaxRecord): string =>
  [
    record.destination.city,
    record.destination.county,
    record.destination.stateCode,
    record.destination.postalCode,
  ]
    .filter(Boolean)
    .join(", ") || "Destination missing"

const destinationSummaryLabel = (destination: TaxDestinationSummary): string =>
  [
    destination.city,
    destination.county,
    destination.stateCode,
    destination.postalCode,
  ]
    .filter(Boolean)
    .join(", ") || "Destination missing"

const refundTimingLabel = (
  timing: TaxRecord["refundCreditTiming"]
): string | null => {
  if (timing === "prior_period") {
    return "Prior-period credit"
  }
  if (timing === "same_period") {
    return "Same-period credit"
  }
  if (timing === "unknown") {
    return "Credit timing unknown"
  }
  return null
}

const LoadingState = memo(() => (
  <div
    className="flex flex-col gap-4"
    aria-label="Loading tax records"
    role="status"
  >
    <Skeleton className="h-44 w-full" />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, index) => (
        <Skeleton className="h-24 w-full" key={index} />
      ))}
    </div>
    <Skeleton className="h-96 w-full" />
  </div>
))

const MobileTaxRecord = memo(({ record }: { record: TaxRecord }) => {
  const timing = refundTimingLabel(record.refundCreditTiming)
  return (
    <article className="border-b border-ui-border-base p-4 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <a
            className="inline-flex min-h-6 min-w-6 items-center rounded-sm text-ui-fg-interactive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-fg-interactive"
            href={`/app/orders/${record.orderId}`}
          >
            Order #{record.displayId}
          </a>
          <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
            {formatDate(record.occurredAt)}
          </Text>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge color={record.type === "refund" ? "orange" : "grey"}>
            {record.type === "refund" ? "Refund" : "Sale"}
          </StatusBadge>
          <StatusBadge color={qualityColor(record.quality)}>
            {qualityLabel(record.quality)}
          </StatusBadge>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 rounded-md bg-ui-bg-subtle p-3">
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle">
            {record.collectionMode === "disabled"
              ? "Pending tax review"
              : "Taxable"}
          </Text>
          <Text size="small" weight="plus" className="tabular-nums">
            {record.type === "refund" ? "−" : ""}
            {formatMoney(
              record.collectionMode === "disabled"
                ? record.unclassifiedSales
                : record.taxableSales,
              record.currencyCode
            )}
          </Text>
        </div>
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle">
            Tax
          </Text>
          <Text size="small" weight="plus" className="tabular-nums">
            {record.type === "refund" ? "−" : ""}
            {formatMoney(record.taxAmount, record.currencyCode)}
          </Text>
        </div>
        <div className="col-span-2 border-t border-ui-border-base pt-2">
          <Text size="xsmall" className="text-ui-fg-subtle">
            Total including tax
          </Text>
          <Text weight="plus" className="tabular-nums">
            {record.type === "refund" ? "−" : ""}
            {formatMoney(record.total, record.currencyCode)}
          </Text>
        </div>
      </div>

      <div className="mt-3">
        <Text size="small">{destinationLabel(record)}</Text>
        <Text size="xsmall" className="text-ui-fg-subtle">
          {record.collectionMode === "disabled"
            ? "Tax not collected"
            : providerLabel(record.provider)}
          {record.taxRatePercent
            ? ` · ${Number(record.taxRatePercent).toFixed(3)}%`
            : " · No tax"}
          {timing ? ` · ${timing}` : ""}
        </Text>
      </div>

      {record.issues.length ? (
        <Text className="mt-3 text-ui-fg-subtle" size="xsmall">
          {record.issues.join(" ")}
        </Text>
      ) : null}
    </article>
  )
})

const MobileDestination = memo(
  ({
    destination,
    filingState,
  }: {
    destination: TaxDestinationSummary
    filingState: TaxFilingState
  }) => (
    <article className="border-b border-ui-border-base p-4 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Text size="small" weight="plus">
            {destinationSummaryLabel(destination)}
          </Text>
          <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
            Filing bucket: {filingBucketFor({ destination, filingState })}
          </Text>
        </div>
        <Text
          size="xsmall"
          weight="plus"
          className="shrink-0 uppercase text-ui-fg-subtle"
        >
          {destination.currencyCode} ·{" "}
          {destination.taxRatePercent
            ? `${Number(destination.taxRatePercent).toFixed(3)}%`
            : "No rate"}
        </Text>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle">
            Gross sales
          </Text>
          <Text size="small" className="tabular-nums">
            {formatMoney(destination.grossSales, destination.currencyCode)}
          </Text>
        </div>
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle">
            Refunded
          </Text>
          <Text size="small" className="tabular-nums">
            {formatMoney(destination.refundedSales, destination.currencyCode)}
          </Text>
        </div>
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle">
            Net taxable
          </Text>
          <Text size="small" className="tabular-nums">
            {formatMoney(destination.taxableSales, destination.currencyCode)}
          </Text>
        </div>
        <div>
          <Text size="xsmall" className="text-ui-fg-subtle">
            Net tax
          </Text>
          <Text size="small" className="tabular-nums">
            {formatMoney(destination.netTax, destination.currencyCode)}
          </Text>
        </div>
      </div>
    </article>
  )
)

export const TaxRecordsPageContent = memo(() => {
  const initialPeriod = useMemo(
    () => uiPeriodForPreset("CT", "current-quarter"),
    []
  )
  const [filingState, setFilingState] = useState<TaxFilingState>("CT")
  const [preset, setPreset] = useState<TaxPeriodPreset>("current-quarter")
  const [draftStart, setDraftStart] = useState(initialPeriod.start)
  const [draftEnd, setDraftEnd] = useState(initialPeriod.end)
  const [period, setPeriod] = useState(initialPeriod)
  const [filters, setFilters] = useState<TaxRecordFilters>(INITIAL_FILTERS)
  const [draftSearch, setDraftSearch] = useState("")
  const [reportingCurrency, setReportingCurrency] = useState("usd")
  const {
    data: report,
    error: queryError,
    isFetching: loading,
    refetch,
  } = useQuery(
    taxRecordsQueryOptions({
      filingState,
      filters,
      period,
    })
  )
  const error = queryError
    ? getAdminRequestErrorMessage(
        queryError,
        "Tax records could not be loaded."
      )
    : null
  const handleRetry = useCallback(() => {
    void refetch()
  }, [refetch])

  const handleFilingState = useCallback((value: string) => {
    const nextState = value as TaxFilingState
    const nextPeriod = uiPeriodForPreset(nextState, "current-quarter")
    setFilingState(nextState)
    setPreset("current-quarter")
    setDraftStart(nextPeriod.start)
    setDraftEnd(nextPeriod.end)
    setPeriod(nextPeriod)
    setFilters(INITIAL_FILTERS)
    setDraftSearch("")
    setReportingCurrency("usd")
  }, [])

  const handlePreset = useCallback(
    (value: string) => {
      const next = value as TaxPeriodPreset
      setPreset(next)
      if (next !== "custom") {
        const nextPeriod = uiPeriodForPreset(filingState, next)
        setDraftStart(nextPeriod.start)
        setDraftEnd(nextPeriod.end)
      }
    },
    [filingState]
  )

  const handleStart = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setPreset("custom")
    setDraftStart(
      String(
        (event.currentTarget as unknown as { value?: unknown }).value ?? ""
      )
    )
  }, [])

  const handleEnd = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setPreset("custom")
    setDraftEnd(
      String(
        (event.currentTarget as unknown as { value?: unknown }).value ?? ""
      )
    )
  }, [])

  const applyPeriod = useCallback(() => {
    setFilters((current) => ({ ...current, page: 1 }))
    setPeriod({ end: draftEnd, start: draftStart })
  }, [draftEnd, draftStart])

  const handleSearch = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setDraftSearch(
      String(
        (event.currentTarget as unknown as { value?: unknown }).value ?? ""
      )
    )
  }, [])

  const applySearch = useCallback(() => {
    setFilters((current) => ({
      ...current,
      page: 1,
      q: draftSearch.trim(),
    }))
  }, [draftSearch])

  const clearSearch = useCallback(() => {
    setDraftSearch("")
    setFilters((current) => ({ ...current, page: 1, q: "" }))
  }, [])

  const handleSearchKey = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        applySearch()
      }
    },
    [applySearch]
  )

  const handleProvider = useCallback((value: string) => {
    setFilters((current) => ({
      ...current,
      page: 1,
      provider: value as TaxRecordFilters["provider"],
    }))
  }, [])

  const handleCollectionMode = useCallback((value: string) => {
    setFilters((current) => ({
      ...current,
      collectionMode: value as TaxRecordFilters["collectionMode"],
      page: 1,
    }))
  }, [])

  const handleQuality = useCallback((value: string) => {
    setFilters((current) => ({
      ...current,
      page: 1,
      quality: value as TaxRecordFilters["quality"],
    }))
  }, [])

  const handleType = useCallback((value: string) => {
    setFilters((current) => ({
      ...current,
      page: 1,
      type: value as TaxRecordFilters["type"],
    }))
  }, [])

  const handleReportingCurrency = useCallback((value: string) => {
    setReportingCurrency(value)
  }, [])

  const previousPage = useCallback(() => {
    setFilters((current) => ({
      ...current,
      page: Math.max(1, current.page - 1),
    }))
  }, [])

  const nextPage = useCallback(() => {
    setFilters((current) => ({ ...current, page: current.page + 1 }))
  }, [])

  const download = useCallback(
    (format: "destinations" | "transactions") => {
      const searchParams = new URLSearchParams({
        end: period.end,
        filing_state: filingState,
        format,
        start: period.start,
      })
      const browser = globalThis as unknown as {
        location: { assign: (url: string) => void }
      }
      browser.location.assign(`/admin/tax-records/export?${searchParams}`)
    },
    [filingState, period]
  )

  const downloadTransactions = useCallback(
    () => download("transactions"),
    [download]
  )
  const downloadDestinations = useCallback(
    () => download("destinations"),
    [download]
  )

  const reportView = useMemo(() => {
    if (!report) {
      return null
    }
    const activeSummary =
      report.summaries.find(
        (summary) => summary.currencyCode === reportingCurrency
      ) ?? report.summaries[0]
    const activeCurrency = activeSummary?.currencyCode
    return {
      activeCurrency,
      activeDestinations: activeCurrency
        ? report.destinations.filter(
            (destination) => destination.currencyCode === activeCurrency
          )
        : [],
      activeSummary,
      currencies: report.summaries.map((summary) => summary.currencyCode),
      incompleteRecordCount: report.summaries.reduce(
        (total, summary) => total + summary.incompleteRecords,
        0
      ),
      pageCount: Math.max(1, Math.ceil(report.resultCount / filters.limit)),
      priorPeriodRefundCount: report.summaries.reduce(
        (total, summary) => total + summary.priorPeriodRefundCount,
        0
      ),
      reviewRecordCount: report.summaries.reduce(
        (total, summary) => total + summary.reviewRecords,
        0
      ),
    }
  }, [filters.limit, report, reportingCurrency])

  const reportMatchesSelection =
    report?.filingState === filingState &&
    report.period.startDate === period.start &&
    report.period.endDate === period.end

  if ((!report || !reportMatchesSelection) && loading) {
    return <LoadingState />
  }

  if (!report || !reportMatchesSelection) {
    return (
      <AdminRetryState
        message={error ?? "The report could not be loaded."}
        onRetry={handleRetry}
        retrying={loading}
        title="Tax records are unavailable"
      />
    )
  }

  if (!reportView?.activeSummary || !reportView.activeCurrency) {
    return (
      <AdminRetryState
        message="The report returned no reporting-currency summary. Try again before using any workpapers."
        onRetry={handleRetry}
        retrying={loading}
        title="Tax summary is unavailable"
      />
    )
  }
  const {
    activeCurrency,
    activeDestinations,
    activeSummary,
    currencies,
    incompleteRecordCount,
    pageCount,
    priorPeriodRefundCount,
    reviewRecordCount,
  } = reportView
  const hasQualityIssues = reviewRecordCount > 0 || incompleteRecordCount > 0
  const filingProfile = TAX_FILING_PROFILES[filingState]
  const periodOptions = taxPeriodPresetOptions(filingState)
  const exportsBlocked =
    report.source.truncated || report.source.unassignedStateRecords > 0

  return (
    <AdminSingleColumnLayout aria-busy={loading}>
      <Container>
        <AdminPageHeader
          actions={
            <div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={exportsBlocked}
                  onClick={downloadTransactions}
                  type="button"
                  variant="secondary"
                >
                  <ArrowDownTray aria-hidden="true" />
                  Transaction CSV
                </Button>
                <Button
                  disabled={exportsBlocked}
                  onClick={downloadDestinations}
                  type="button"
                  variant="primary"
                >
                  <ArrowDownTray aria-hidden="true" />
                  Destination CSV
                </Button>
              </div>
              <Text size="xsmall" className="mt-2 max-w-sm text-ui-fg-subtle">
                Exports include the full {filingProfile.name} filing scope and
                selected period across all currencies; table filters do not
                change them.
              </Text>
            </div>
          }
          description="Build separate Connecticut, New York, and Pennsylvania workpapers from Medusa sales, refunds, tax, and delivery destinations."
          title="Tax records"
        />
        <OperationsWorkspaceNavigation active="tax-records" className="mt-5" />

        <div className="mt-6 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
            <div>
              <Label htmlFor="tax-filing-state">Filing jurisdiction</Label>
              <Select value={filingState} onValueChange={handleFilingState}>
                <Select.Trigger className="mt-1" id="tax-filing-state">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {TAX_FILING_STATES.map((state) => (
                    <Select.Item key={state} value={state}>
                      {TAX_FILING_PROFILES[state].name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
            <div>
              <Text size="small" weight="plus">
                {filingProfile.returnName}
              </Text>
              <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                {filingProfile.filingFrequencyGuidance}
              </Text>
            </div>
            <div>
              <Text size="small" weight="plus">
                Official filing portal
              </Text>
              <a
                className="mt-1 inline-flex min-h-6 min-w-6 cursor-pointer items-center rounded-sm text-ui-fg-interactive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-fg-interactive"
                href={filingProfile.portalUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open {filingProfile.portalName}
              </a>
            </div>
          </div>
          <div className="mt-5 grid gap-4 border-t border-ui-border-base pt-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
            <div>
              <Label htmlFor="tax-period-preset">Filing period</Label>
              <Select value={preset} onValueChange={handlePreset}>
                <Select.Trigger className="mt-1" id="tax-period-preset">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {periodOptions.map((option) => (
                    <Select.Item key={option.value} value={option.value}>
                      {option.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
            <div>
              <Label htmlFor="tax-period-start">Start date</Label>
              <Input
                className="mt-1"
                id="tax-period-start"
                onChange={handleStart}
                type="date"
                value={draftStart}
              />
            </div>
            <div>
              <Label htmlFor="tax-period-end">End date, exclusive</Label>
              <Input
                className="mt-1"
                id="tax-period-end"
                onChange={handleEnd}
                type="date"
                value={draftEnd}
              />
            </div>
            <Button onClick={applyPeriod} type="button" variant="secondary">
              Apply period
            </Button>
          </div>
          <Text size="xsmall" className="mt-3 text-ui-fg-subtle">
            {report.period.label} · {report.period.timeZone} · end date is not
            included
          </Text>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-ui-border-base bg-ui-bg-base p-3">
              <Text size="xsmall" weight="plus">
                Due-date guidance
              </Text>
              <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                {filingProfile.dueDateGuidance}
              </Text>
            </div>
            <div className="rounded-md border border-ui-border-base bg-ui-bg-base p-3">
              <Text size="xsmall" weight="plus">
                Destination treatment
              </Text>
              <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                {filingProfile.destinationGuidance}
              </Text>
            </div>
          </div>
        </div>

        <Alert className="mt-4" variant="warning">
          <Text weight="plus">Keep each state obligation separate.</Text>
          <Text size="small">
            A move from Connecticut to Pennsylvania does not transfer or close a
            tax registration. Continue required Connecticut, New York, and
            Pennsylvania zero, periodic, and final returns until the respective
            agency confirms a change or closure.
          </Text>
        </Alert>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <Text size="small" weight="plus">
              {filingProfile.name} period totals
            </Text>
            <Text size="xsmall" className="text-ui-fg-subtle">
              Currencies are never combined.
            </Text>
          </div>
          {currencies.length > 1 ? (
            <div className="min-w-36">
              <Label htmlFor="tax-reporting-currency">Reporting currency</Label>
              <Select
                value={activeCurrency}
                onValueChange={handleReportingCurrency}
              >
                <Select.Trigger className="mt-1" id="tax-reporting-currency">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  {currencies.map((currency) => (
                    <Select.Item key={currency} value={currency}>
                      {currency.toUpperCase()}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
          ) : (
            <Text
              size="xsmall"
              weight="plus"
              className="uppercase text-ui-fg-subtle"
            >
              {activeCurrency}
            </Text>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <AdminStatCard description="Tax excluded" label="Gross sales">
            <Text size="large" weight="plus" className="break-words">
              {formatMoney(activeSummary.grossSales, activeCurrency)}
            </Text>
          </AdminStatCard>
          <AdminStatCard
            description={`${activeSummary.refundCount} refund record${
              activeSummary.refundCount === 1 ? "" : "s"
            }`}
            label="Sales refunded"
          >
            <Text size="large" weight="plus" className="break-words">
              {formatMoney(activeSummary.refundedSales, activeCurrency)}
            </Text>
          </AdminStatCard>
          {(
            [
              ["Net taxable sales", activeSummary.taxableSales],
              ["Net nontaxable sales", activeSummary.nontaxableSales],
              ["Sales pending tax review", activeSummary.unclassifiedSales],
              ["Tax collected", activeSummary.taxCollected],
              ["Tax refunded", activeSummary.refundedTax],
              ["Net sales", activeSummary.netSales],
            ] satisfies ReadonlyArray<readonly [string, string]>
          ).map(([label, value]) => (
            <AdminStatCard key={label} label={label}>
              <Text size="large" weight="plus" className="break-words">
                {formatMoney(value, activeCurrency)}
              </Text>
            </AdminStatCard>
          ))}
          <AdminStatCard description="Reconcile before filing" label="Net tax">
            <Text size="large" weight="plus" className="break-words">
              {formatMoney(activeSummary.netTax, activeCurrency)}
            </Text>
          </AdminStatCard>
        </div>

        {report.source.unassignedStateRecords > 0 ? (
          <Alert className="mt-4" variant="error">
            <Text weight="plus">
              A destination is missing the state needed for filing.
            </Text>
            <Text size="small">
              {report.source.unassignedStateRecords} United States or
              country-unknown record
              {report.source.unassignedStateRecords === 1 ? "" : "s"} could not
              be assigned to a filing jurisdiction. Exports are blocked until
              the source shipping address is corrected.
            </Text>
            <ul className="mt-2 list-inside list-disc">
              {report.unassignedRecordExamples.slice(0, 5).map((record) => (
                <li key={record.orderId}>
                  <a
                    className="cursor-pointer rounded-sm text-ui-fg-interactive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-fg-interactive"
                    href={`/app/orders/${record.orderId}`}
                  >
                    Order #{record.displayId}
                  </a>{" "}
                  <span className="text-ui-fg-subtle">
                    ({formatDate(record.occurredAt)})
                  </span>
                </li>
              ))}
            </ul>
            {report.source.unassignedStateRecords > 5 ? (
              <Text size="xsmall" className="mt-2 text-ui-fg-subtle">
                Showing the first 5 affected orders. Ask an engineer for the
                remaining source rows before filing.
              </Text>
            ) : null}
          </Alert>
        ) : null}

        {activeSummary.disabledRecordCount > 0 ? (
          <Alert className="mt-4" variant="warning">
            <Text weight="plus">Tax was not collected on some records.</Text>
            <Text size="small">
              {activeSummary.disabledRecordCount} sale or refund record
              {activeSummary.disabledRecordCount === 1 ? "" : "s"} used the
              audited disabled mode. Their sales remain separately classified as
              pending tax review; they are not labeled exempt or nontaxable.
              Confirm filing treatment with the store owner's tax professional.
            </Text>
          </Alert>
        ) : null}

        {report.source.truncated ? (
          <Alert className="mt-4" variant="error">
            <Text weight="plus">The source scan is incomplete.</Text>
            <Text size="small">
              It reached the 50,000-order bounded scan. Exports are blocked. Use
              an earlier period end or contact an engineer before filing.
            </Text>
          </Alert>
        ) : null}

        {hasQualityIssues ? (
          <Alert className="mt-4" variant="warning">
            <Text weight="plus">Review before using these workpapers.</Text>
            <Text size="small">
              {incompleteRecordCount} incomplete record
              {incompleteRecordCount === 1 ? "" : "s"} and {reviewRecordCount}{" "}
              review record
              {reviewRecordCount === 1 ? "" : "s"} are included. Legacy rows may
              lack locality evidence, partial-refund tax can be estimated, and{" "}
              {priorPeriodRefundCount} prior-period credit
              {priorPeriodRefundCount === 1 ? "" : "s"} require separate review.
            </Text>
          </Alert>
        ) : (
          <Alert className="mt-4" variant="success">
            <Text weight="plus">No structural exceptions were detected.</Text>
            <Text size="small">
              This is not filing approval. Reconcile the exports with the
              accounting ledger and current filing instructions.
            </Text>
          </Alert>
        )}
      </Container>

      <Container className="p-0">
        <div className="z-10 border-b border-ui-border-base bg-ui-bg-base p-4 md:sticky md:top-0">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <Label htmlFor="tax-record-search">Search records</Label>
              <div className="mt-1 flex flex-wrap gap-2">
                <Input
                  className="min-w-[180px] flex-1"
                  id="tax-record-search"
                  onChange={handleSearch}
                  onKeyDown={handleSearchKey}
                  placeholder="Order, city, county, or ZIP"
                  value={draftSearch}
                />
                <Button onClick={applySearch} type="button" variant="secondary">
                  Search
                </Button>
                {filters.q ? (
                  <Button
                    onClick={clearSearch}
                    type="button"
                    variant="transparent"
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="min-w-36">
              <Label htmlFor="tax-record-type">Record type</Label>
              <Select value={filters.type} onValueChange={handleType}>
                <Select.Trigger className="mt-1" id="tax-record-type">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="all">All records</Select.Item>
                  <Select.Item value="sale">Sales</Select.Item>
                  <Select.Item value="refund">Refunds</Select.Item>
                </Select.Content>
              </Select>
            </div>

            <div className="min-w-36">
              <Label htmlFor="tax-record-quality">Quality</Label>
              <Select value={filters.quality} onValueChange={handleQuality}>
                <Select.Trigger className="mt-1" id="tax-record-quality">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="all">All quality</Select.Item>
                  <Select.Item value="complete">Complete</Select.Item>
                  <Select.Item value="review">Review</Select.Item>
                  <Select.Item value="incomplete">Incomplete</Select.Item>
                </Select.Content>
              </Select>
            </div>

            <div className="min-w-36">
              <Label htmlFor="tax-record-collection-mode">
                Collection decision
              </Label>
              <Select
                value={filters.collectionMode}
                onValueChange={handleCollectionMode}
              >
                <Select.Trigger
                  className="mt-1"
                  id="tax-record-collection-mode"
                >
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="all">All decisions</Select.Item>
                  <Select.Item value="collect">Tax collected</Select.Item>
                  <Select.Item value="disabled">Tax not collected</Select.Item>
                  <Select.Item value="unknown">Decision unknown</Select.Item>
                </Select.Content>
              </Select>
            </div>

            <div className="min-w-36">
              <Label htmlFor="tax-record-provider">Provider</Label>
              <Select value={filters.provider} onValueChange={handleProvider}>
                <Select.Trigger className="mt-1" id="tax-record-provider">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="all">All providers</Select.Item>
                  {report.filters.providers.map((provider) => (
                    <Select.Item key={provider} value={provider}>
                      {providerLabel(provider)}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>
          </div>
          <div
            aria-live="polite"
            className="mt-3 flex flex-wrap items-center justify-between gap-2"
          >
            <Text size="small" className="text-ui-fg-subtle">
              {loading
                ? "Updating records…"
                : `${report.resultCount} matching record${
                    report.resultCount === 1 ? "" : "s"
                  }`}
            </Text>
            <Text size="xsmall" className="text-ui-fg-subtle">
              Generated {formatDate(report.generatedAt)}
            </Text>
          </div>
        </div>

        <div className="md:hidden">
          {report.records.length ? (
            report.records.map((record) => (
              <MobileTaxRecord key={record.id} record={record} />
            ))
          ) : (
            <div className="p-8 text-center">
              <Text weight="plus">No matching tax records</Text>
              <Text size="small" className="mt-1 text-ui-fg-subtle">
                Adjust the dates or filters. A registered vendor may still need
                to file a zero return.
              </Text>
            </div>
          )}
        </div>

        <div
          aria-label="Tax record table; scroll horizontally for all columns"
          className="hidden max-w-full overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ui-fg-interactive md:block"
          role="region"
          tabIndex={0}
        >
          <Table className="min-w-[1080px]">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Date</Table.HeaderCell>
                <Table.HeaderCell>Order</Table.HeaderCell>
                <Table.HeaderCell>Record</Table.HeaderCell>
                <Table.HeaderCell>Destination</Table.HeaderCell>
                <Table.HeaderCell>Tax decision</Table.HeaderCell>
                <Table.HeaderCell className="text-right">
                  Taxable
                </Table.HeaderCell>
                <Table.HeaderCell className="text-right">Tax</Table.HeaderCell>
                <Table.HeaderCell className="text-right">
                  Total
                </Table.HeaderCell>
                <Table.HeaderCell>Quality</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {report.records.length ? (
                report.records.map((record) => (
                  <Table.Row key={record.id}>
                    <Table.Cell>{formatDate(record.occurredAt)}</Table.Cell>
                    <Table.Cell>
                      <a
                        className="inline-flex min-h-6 min-w-6 items-center rounded-sm text-ui-fg-interactive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-fg-interactive"
                        href={`/app/orders/${record.orderId}`}
                      >
                        #{record.displayId}
                      </a>
                    </Table.Cell>
                    <Table.Cell>
                      <StatusBadge
                        color={record.type === "refund" ? "orange" : "grey"}
                      >
                        {record.type === "refund" ? "Refund" : "Sale"}
                      </StatusBadge>
                      {record.refundCreditTiming ? (
                        <Text className="mt-1 text-ui-fg-subtle" size="xsmall">
                          {refundTimingLabel(record.refundCreditTiming)}
                        </Text>
                      ) : null}
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="small">{destinationLabel(record)}</Text>
                      {record.destination.jurisdictionName ? (
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          {record.destination.jurisdictionName}
                        </Text>
                      ) : null}
                    </Table.Cell>
                    <Table.Cell>
                      <Text size="small">
                        {record.collectionMode === "disabled"
                          ? "Tax not collected"
                          : providerLabel(record.provider)}
                      </Text>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {record.collectionMode === "disabled"
                          ? "Explicit $0.00 decision"
                          : record.taxRatePercent
                            ? `${Number(record.taxRatePercent).toFixed(3)}%`
                            : "No tax"}
                      </Text>
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums">
                      {record.type === "refund" ? "−" : ""}
                      {formatMoney(
                        record.collectionMode === "disabled"
                          ? record.unclassifiedSales
                          : record.taxableSales,
                        record.currencyCode
                      )}
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums">
                      {record.type === "refund" ? "−" : ""}
                      {formatMoney(record.taxAmount, record.currencyCode)}
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums">
                      {record.type === "refund" ? "−" : ""}
                      {formatMoney(record.total, record.currencyCode)}
                    </Table.Cell>
                    <Table.Cell>
                      <StatusBadge color={qualityColor(record.quality)}>
                        {qualityLabel(record.quality)}
                      </StatusBadge>
                      {record.issues.length ? (
                        <Text
                          className="mt-1 max-w-64 text-ui-fg-subtle"
                          size="xsmall"
                        >
                          {record.issues.join(" ")}
                        </Text>
                      ) : null}
                    </Table.Cell>
                  </Table.Row>
                ))
              ) : (
                <Table.Row>
                  <Table.Cell>
                    <div className="py-12 text-center">
                      <Text weight="plus">No matching tax records</Text>
                      <Text size="small" className="mt-1 text-ui-fg-subtle">
                        Adjust the dates or filters. A registered vendor may
                        still need to file a zero return.
                      </Text>
                    </div>
                  </Table.Cell>
                  {Array.from({ length: 8 }, (_, index) => (
                    <Table.Cell aria-hidden="true" key={index} />
                  ))}
                </Table.Row>
              )}
            </Table.Body>
          </Table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ui-border-base p-4">
          <Text size="small" className="text-ui-fg-subtle">
            Page {filters.page} of {pageCount}
          </Text>
          <div className="flex gap-2">
            <Button
              disabled={filters.page <= 1}
              onClick={previousPage}
              type="button"
              variant="secondary"
            >
              Previous
            </Button>
            <Button
              disabled={filters.page >= pageCount}
              onClick={nextPage}
              type="button"
              variant="secondary"
            >
              Next
            </Button>
          </div>
        </div>
      </Container>

      <Container className="p-0">
        <div className="border-b border-ui-border-base p-4">
          <Heading level="h2">Destination workpaper</Heading>
          <Text size="small" className="mt-1 text-ui-fg-subtle">
            Sales and credits grouped by destination and effective rate. Showing{" "}
            {activeCurrency.toUpperCase()}. {filingProfile.destinationGuidance}
          </Text>
        </div>
        <div className="md:hidden">
          {activeDestinations.length ? (
            activeDestinations.map((destination) => (
              <MobileDestination
                destination={destination}
                filingState={filingState}
                key={[
                  destination.currencyCode,
                  destination.countryCode,
                  destination.stateCode,
                  destination.county,
                  destination.city,
                  destination.postalCode,
                  destination.taxRatePercent,
                ].join(":")}
              />
            ))
          ) : (
            <div className="p-8 text-center">
              <Text weight="plus">No destination rows</Text>
              <Text size="small" className="mt-1 text-ui-fg-subtle">
                No sales or refund credits were recorded for this period and
                currency.
              </Text>
            </div>
          )}
        </div>
        <div
          aria-label="Destination workpaper table; scroll horizontally for all columns"
          className="hidden max-w-full overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ui-fg-interactive md:block"
          role="region"
          tabIndex={0}
        >
          <Table className="min-w-[1040px]">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Destination</Table.HeaderCell>
                <Table.HeaderCell>Filing bucket</Table.HeaderCell>
                <Table.HeaderCell>Rate</Table.HeaderCell>
                <Table.HeaderCell className="text-right">
                  Gross sales
                </Table.HeaderCell>
                <Table.HeaderCell className="text-right">
                  Refunded
                </Table.HeaderCell>
                <Table.HeaderCell className="text-right">
                  Net taxable
                </Table.HeaderCell>
                <Table.HeaderCell className="text-right">
                  Tax collected
                </Table.HeaderCell>
                <Table.HeaderCell className="text-right">
                  Tax refunded
                </Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {activeDestinations.length ? (
                activeDestinations.map((destination) => (
                  <Table.Row
                    key={[
                      destination.currencyCode,
                      destination.countryCode,
                      destination.stateCode,
                      destination.county,
                      destination.city,
                      destination.postalCode,
                      destination.taxRatePercent,
                    ].join(":")}
                  >
                    <Table.Cell>
                      <Text size="small">
                        {destinationSummaryLabel(destination)}
                      </Text>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {destination.jurisdictionName ??
                          destination.countryCode ??
                          "No jurisdiction evidence"}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      {filingBucketFor({ destination, filingState })}
                    </Table.Cell>
                    <Table.Cell>
                      {destination.taxRatePercent
                        ? `${Number(destination.taxRatePercent).toFixed(3)}%`
                        : "—"}
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums">
                      {formatMoney(
                        destination.grossSales,
                        destination.currencyCode
                      )}
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums">
                      {formatMoney(
                        destination.refundedSales,
                        destination.currencyCode
                      )}
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums">
                      {formatMoney(
                        destination.taxableSales,
                        destination.currencyCode
                      )}
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums">
                      {formatMoney(
                        destination.taxCollected,
                        destination.currencyCode
                      )}
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums">
                      {formatMoney(
                        destination.refundedTax,
                        destination.currencyCode
                      )}
                    </Table.Cell>
                  </Table.Row>
                ))
              ) : (
                <Table.Row>
                  <Table.Cell>
                    <div className="py-12 text-center">
                      <Text weight="plus">No destination rows</Text>
                      <Text size="small" className="mt-1 text-ui-fg-subtle">
                        No sales or refund credits were recorded for this period
                        and currency.
                      </Text>
                    </div>
                  </Table.Cell>
                  {Array.from({ length: 7 }, (_, index) => (
                    <Table.Cell aria-hidden="true" key={index} />
                  ))}
                </Table.Row>
              )}
            </Table.Body>
          </Table>
        </div>
      </Container>

      <Container>
        <Heading level="h2">What this report does not file</Heading>
        <Text size="small" className="mt-2 max-w-4xl text-ui-fg-subtle">
          {filingProfile.separateReconciliation} Review the official{" "}
          {filingProfile.returnName} instructions, then file through{" "}
          <a
            className="cursor-pointer rounded-sm text-ui-fg-interactive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-fg-interactive"
            href={filingProfile.portalUrl}
            rel="noreferrer"
            target="_blank"
          >
            {filingProfile.portalName}
          </a>
          .
        </Text>
        <Text size="xsmall" className="mt-3 text-ui-fg-subtle">
          {report.source.medusaOrdersScanned} Medusa order
          {report.source.medusaOrdersScanned === 1 ? "" : "s"} created before
          the period end scanned so refunds for older sales are not missed. No
          customer names, email addresses, phone numbers, or street addresses
          are included in exports.
        </Text>
      </Container>
    </AdminSingleColumnLayout>
  )
})

TaxRecordsPageContent.displayName = "TaxRecordsPageContent"

export const TaxRecordsPage = memo(() => (
  <AdminPermissionBoundary
    actions={operationsAdminActions.taxRecords.read}
    workspace="Tax records"
  >
    <TaxRecordsPageContent />
  </AdminPermissionBoundary>
))

TaxRecordsPage.displayName = "TaxRecordsPage"

const LegacyTaxRecordsPage = memo(() => {
  useEffect(() => {
    const { location } = globalThis as unknown as {
      location: ReplaceAdminLocation
    }
    replaceLegacyOperationsLocation(location, "tax-records")
  }, [])

  return null
})

LegacyTaxRecordsPage.displayName = "LegacyTaxRecordsPage"

export default LegacyTaxRecordsPage
