"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ArrowDownTray, ReceiptPercent } from "@medusajs/icons";
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

type Provider =
  | "legacy"
  | "mixed"
  | "stripe_tax"
  | "taxrate_io"
  | "unknown";
type Quality = "complete" | "incomplete" | "review";
type RecordType = "refund" | "sale";

type TaxRecord = {
  currencyCode: string;
  destination: {
    city: string | null;
    countryCode: string | null;
    county: string | null;
    jurisdictionLevel: string | null;
    jurisdictionName: string | null;
    postalCode: string | null;
    stateCode: string | null;
  };
  displayId: number;
  generation: number | null;
  grossSales: string;
  id: string;
  issues: string[];
  nontaxableSales: string;
  occurredAt: string;
  orderId: string;
  provider: Provider;
  quality: Quality;
  refundId: string | null;
  refundTaxMethod: "estimated" | "exact" | null;
  taxAmount: string;
  taxableSales: string;
  taxCalculationId: string | null;
  taxRatePercent: string | null;
  total: string;
  type: RecordType;
};

type DestinationSummary = {
  city: string | null;
  countryCode: string | null;
  county: string | null;
  grossSales: string;
  jurisdictionLevel: string | null;
  jurisdictionName: string | null;
  nontaxableSales: string;
  postalCode: string | null;
  refundedSales: string;
  refundedTax: string;
  stateCode: string | null;
  taxCollected: string;
  taxRatePercent: string | null;
  taxableSales: string;
};

type TaxReport = {
  destinations: DestinationSummary[];
  filters: {
    providers: Provider[];
    states: string[];
  };
  generatedAt: string;
  period: {
    endDate: string;
    endExclusive: string;
    label: string;
    startDate: string;
    startInclusive: string;
    timeZone: "America/New_York";
  };
  records: TaxRecord[];
  resultCount: number;
  source: {
    medusaOrdersScanned: number;
    truncated: boolean;
  };
  summary: {
    completeRecords: number;
    grossSales: string;
    incompleteRecords: number;
    netSales: string;
    netTax: string;
    nontaxableSales: string;
    orderCount: number;
    refundCount: number;
    refundedSales: string;
    refundedTax: string;
    reviewRecords: number;
    taxCollected: string;
    taxableSales: string;
  };
};

type PeriodPreset =
  | "current-quarter"
  | "current-year"
  | "custom"
  | "previous-quarter"
  | "previous-year";

type Filters = {
  limit: number;
  page: number;
  provider: "all" | Provider;
  q: string;
  quality: "all" | Quality;
  state: string;
  type: "all" | RecordType;
};

const TIME_ZONE = "America/New_York";
const INITIAL_FILTERS: Filters = {
  limit: 50,
  page: 1,
  provider: "all",
  q: "",
  quality: "all",
  state: "ALL",
  type: "all",
};

const dateString = (year: number, month: number): string =>
  `${year}-${String(month).padStart(2, "0")}-01`;

const localYearMonth = (): { month: number; year: number } => {
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    timeZone: TIME_ZONE,
    year: "numeric",
  }).formatToParts(new Date());
  return {
    month: Number(parts.find((part) => part.type === "month")?.value),
    year: Number(parts.find((part) => part.type === "year")?.value),
  };
};

const quarterPeriod = (offset: number): { end: string; start: string } => {
  const { month, year } = localYearMonth();
  const salesTaxYear = month >= 3 ? year : year - 1;
  const quarter =
    month >= 12 || month < 3 ? 3 : Math.floor((month - 3) / 3);
  const index = salesTaxYear * 4 + quarter + offset;
  const indexedYear = Math.floor(index / 4);
  const indexedQuarter = ((index % 4) + 4) % 4;
  const rawStartMonth = 3 + indexedQuarter * 3;
  const startYear = rawStartMonth > 12 ? indexedYear + 1 : indexedYear;
  const startMonth = rawStartMonth > 12 ? rawStartMonth - 12 : rawStartMonth;
  const rawEndMonth = startMonth + 3;
  const endYear = rawEndMonth > 12 ? startYear + 1 : startYear;
  const endMonth = rawEndMonth > 12 ? rawEndMonth - 12 : rawEndMonth;
  return {
    end: dateString(endYear, endMonth),
    start: dateString(startYear, startMonth),
  };
};

const salesTaxYearPeriod = (
  offset: number,
): { end: string; start: string } => {
  const { month, year } = localYearMonth();
  const startYear = (month >= 3 ? year : year - 1) + offset;
  return {
    end: dateString(startYear + 1, 3),
    start: dateString(startYear, 3),
  };
};

const periodForPreset = (
  preset: PeriodPreset,
): { end: string; start: string } => {
  if (preset === "current-year") {
    return salesTaxYearPeriod(0);
  }
  if (preset === "previous-year") {
    return salesTaxYearPeriod(-1);
  }
  if (preset === "previous-quarter") {
    return quarterPeriod(-1);
  }
  return quarterPeriod(0);
};

const extractErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as {
      detail?: string;
      message?: string;
    };
    return body.detail ?? body.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
};

const formatMoney = (value: string, currencyCode = "usd"): string =>
  new Intl.NumberFormat(undefined, {
    currency: currencyCode.toUpperCase(),
    style: "currency",
  }).format(Number(value));

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const providerLabel = (provider: Provider): string => {
  if (provider === "taxrate_io") {
    return "TaxRate.io";
  }
  if (provider === "stripe_tax") {
    return "Stripe Tax";
  }
  return `${provider.charAt(0).toUpperCase()}${provider.slice(1)}`;
};

const qualityColor = (
  quality: Quality,
): "green" | "orange" | "red" =>
  quality === "complete"
    ? "green"
    : quality === "review"
      ? "orange"
      : "red";

const qualityLabel = (quality: Quality): string =>
  quality === "complete"
    ? "Complete"
    : quality === "review"
      ? "Review"
      : "Incomplete";

const destinationLabel = (record: TaxRecord): string =>
  [
    record.destination.city,
    record.destination.county,
    record.destination.stateCode,
    record.destination.postalCode,
  ]
    .filter(Boolean)
    .join(", ") || "Destination missing";

const LoadingState = memo(() => (
  <div className="flex flex-col gap-4" aria-label="Loading tax records">
    <Skeleton className="h-44 w-full" />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, index) => (
        <Skeleton className="h-24 w-full" key={index} />
      ))}
    </div>
    <Skeleton className="h-96 w-full" />
  </div>
));

const SummaryCard = memo(
  ({
    label,
    note,
    value,
  }: {
    label: string;
    note?: string;
    value: string;
  }) => (
    <div className="rounded-lg border border-ui-border-base bg-ui-bg-base p-4">
      <Text size="xsmall" className="text-ui-fg-subtle">
        {label}
      </Text>
      <Text size="large" weight="plus" className="mt-1">
        {value}
      </Text>
      {note ? (
        <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
          {note}
        </Text>
      ) : null}
    </div>
  ),
);

const TaxRecordsPage = memo(() => {
  const initialPeriod = useMemo(() => periodForPreset("current-quarter"), []);
  const [preset, setPreset] = useState<PeriodPreset>("current-quarter");
  const [draftStart, setDraftStart] = useState(initialPeriod.start);
  const [draftEnd, setDraftEnd] = useState(initialPeriod.end);
  const [period, setPeriod] = useState(initialPeriod);
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [draftSearch, setDraftSearch] = useState("");
  const [report, setReport] = useState<TaxReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    const searchParams = new URLSearchParams({
      end: period.end,
      limit: String(filters.limit),
      page: String(filters.page),
      provider: filters.provider,
      q: filters.q,
      quality: filters.quality,
      start: period.start,
      state: filters.state,
      type: filters.type,
    });

    try {
      const response = await fetch(`/admin/tax-records?${searchParams}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(await extractErrorMessage(response));
      }
      const next = (await response.json()) as TaxReport;
      if (sequence === loadSequence.current) {
        setReport(next);
      }
    } catch (caught) {
      if (sequence === loadSequence.current) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Tax records could not be loaded.",
        );
      }
    } finally {
      if (sequence === loadSequence.current) {
        setLoading(false);
      }
    }
  }, [filters, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const handlePreset = useCallback((value: string) => {
    const next = value as PeriodPreset;
    setPreset(next);
    if (next !== "custom") {
      const nextPeriod = periodForPreset(next);
      setDraftStart(nextPeriod.start);
      setDraftEnd(nextPeriod.end);
    }
  }, []);

  const handleStart = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setPreset("custom");
    setDraftStart(
      String(
        (event.currentTarget as unknown as { value?: unknown }).value ?? "",
      ),
    );
  }, []);

  const handleEnd = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setPreset("custom");
    setDraftEnd(
      String(
        (event.currentTarget as unknown as { value?: unknown }).value ?? "",
      ),
    );
  }, []);

  const applyPeriod = useCallback(() => {
    setFilters((current) => ({ ...current, page: 1 }));
    setPeriod({ end: draftEnd, start: draftStart });
  }, [draftEnd, draftStart]);

  const handleSearch = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setDraftSearch(
      String(
        (event.currentTarget as unknown as { value?: unknown }).value ?? "",
      ),
    );
  }, []);

  const applySearch = useCallback(() => {
    setFilters((current) => ({
      ...current,
      page: 1,
      q: draftSearch.trim(),
    }));
  }, [draftSearch]);

  const clearSearch = useCallback(() => {
    setDraftSearch("");
    setFilters((current) => ({ ...current, page: 1, q: "" }));
  }, []);

  const handleSearchKey = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        applySearch();
      }
    },
    [applySearch],
  );

  const handleProvider = useCallback((value: string) => {
    setFilters((current) => ({
      ...current,
      page: 1,
      provider: value as Filters["provider"],
    }));
  }, []);

  const handleQuality = useCallback((value: string) => {
    setFilters((current) => ({
      ...current,
      page: 1,
      quality: value as Filters["quality"],
    }));
  }, []);

  const handleState = useCallback((value: string) => {
    setFilters((current) => ({ ...current, page: 1, state: value }));
  }, []);

  const handleType = useCallback((value: string) => {
    setFilters((current) => ({
      ...current,
      page: 1,
      type: value as Filters["type"],
    }));
  }, []);

  const previousPage = useCallback(() => {
    setFilters((current) => ({
      ...current,
      page: Math.max(1, current.page - 1),
    }));
  }, []);

  const nextPage = useCallback(() => {
    setFilters((current) => ({ ...current, page: current.page + 1 }));
  }, []);

  const download = useCallback(
    (format: "destinations" | "transactions") => {
      const searchParams = new URLSearchParams({
        end: period.end,
        format,
        start: period.start,
      });
      const browser = globalThis as unknown as {
        location: { assign: (url: string) => void };
      };
      browser.location.assign(`/admin/tax-records/export?${searchParams}`);
    },
    [period],
  );

  const downloadTransactions = useCallback(
    () => download("transactions"),
    [download],
  );
  const downloadDestinations = useCallback(
    () => download("destinations"),
    [download],
  );

  if (!report && loading) {
    return <LoadingState />;
  }

  if (!report) {
    return (
      <Container>
        <Heading>Tax records are unavailable</Heading>
        <Text className="mt-2 text-ui-fg-subtle">
          {error ?? "The report could not be loaded."}
        </Text>
        <Button className="mt-4" onClick={load} type="button">
          Try again
        </Button>
      </Container>
    );
  }

  const pageCount = Math.max(
    1,
    Math.ceil(report.resultCount / filters.limit),
  );
  const hasQualityIssues =
    report.summary.reviewRecords > 0 ||
    report.summary.incompleteRecords > 0;

  return (
    <div className="flex flex-col gap-4" aria-busy={loading}>
      <Container>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <Heading>Tax records</Heading>
            <Text className="mt-1 text-ui-fg-subtle">
              Reconcile Medusa sales, refunds, tax, and delivery destinations
              before preparing a return.
            </Text>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={downloadTransactions}
              type="button"
              variant="secondary"
            >
              <ArrowDownTray aria-hidden="true" />
              Transaction CSV
            </Button>
            <Button
              onClick={downloadDestinations}
              type="button"
              variant="primary"
            >
              <ArrowDownTray aria-hidden="true" />
              Destination CSV
            </Button>
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
            <div>
              <Label htmlFor="tax-period-preset">Filing period</Label>
              <Select value={preset} onValueChange={handlePreset}>
                <Select.Trigger className="mt-1" id="tax-period-preset">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="current-quarter">
                    Current NY quarter
                  </Select.Item>
                  <Select.Item value="previous-quarter">
                    Previous NY quarter
                  </Select.Item>
                  <Select.Item value="current-year">
                    Current NY sales-tax year
                  </Select.Item>
                  <Select.Item value="previous-year">
                    Previous NY sales-tax year
                  </Select.Item>
                  <Select.Item value="custom">Custom dates</Select.Item>
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
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard
            label="Gross sales"
            note="Tax excluded"
            value={formatMoney(report.summary.grossSales)}
          />
          <SummaryCard
            label="Sales refunded"
            note={`${report.summary.refundCount} refund record${
              report.summary.refundCount === 1 ? "" : "s"
            }`}
            value={formatMoney(report.summary.refundedSales)}
          />
          <SummaryCard
            label="Net taxable sales"
            value={formatMoney(report.summary.taxableSales)}
          />
          <SummaryCard
            label="Net nontaxable sales"
            value={formatMoney(report.summary.nontaxableSales)}
          />
          <SummaryCard
            label="Tax collected"
            value={formatMoney(report.summary.taxCollected)}
          />
          <SummaryCard
            label="Tax refunded"
            value={formatMoney(report.summary.refundedTax)}
          />
          <SummaryCard
            label="Net sales"
            value={formatMoney(report.summary.netSales)}
          />
          <SummaryCard
            label="Net tax"
            note="Reconcile before filing"
            value={formatMoney(report.summary.netTax)}
          />
        </div>

        {report.source.truncated ? (
          <Alert className="mt-4" variant="error">
            <Text weight="plus">The source scan is incomplete.</Text>
            <Text size="small">
              It reached the 50,000-order safety limit. Narrow the period;
              exports are blocked while results are truncated.
            </Text>
          </Alert>
        ) : null}

        {hasQualityIssues ? (
          <Alert className="mt-4" variant="warning">
            <Text weight="plus">Review before using these workpapers.</Text>
            <Text size="small">
              {report.summary.incompleteRecords} incomplete and{" "}
              {report.summary.reviewRecords} review record
              {report.summary.reviewRecords === 1 ? "" : "s"} are included.
              Legacy rows do not contain locality evidence, and partial
              refund tax can be estimated.
            </Text>
          </Alert>
        ) : (
          <Alert className="mt-4" variant="success">
            <Text weight="plus">All records are structurally complete.</Text>
            <Text size="small">
              Still reconcile the exports with the accounting ledger and
              filing instructions.
            </Text>
          </Alert>
        )}
      </Container>

      <Container className="p-0">
        <div className="sticky top-0 z-10 border-b border-ui-border-base bg-ui-bg-base p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <Label htmlFor="tax-record-search">Search records</Label>
              <div className="mt-1 flex gap-2">
                <Input
                  id="tax-record-search"
                  onChange={handleSearch}
                  onKeyDown={handleSearchKey}
                  placeholder="Order, city, county, or ZIP"
                  value={draftSearch}
                />
                <Button
                  onClick={applySearch}
                  type="button"
                  variant="secondary"
                >
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

            <div className="min-w-32">
              <Label htmlFor="tax-record-state">State</Label>
              <Select value={filters.state} onValueChange={handleState}>
                <Select.Trigger className="mt-1" id="tax-record-state">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value="ALL">All states</Select.Item>
                  {report.filters.states.map((state) => (
                    <Select.Item key={state} value={state}>
                      {state}
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

        <div className="max-w-full overflow-x-auto">
          <Table className="min-w-[1080px]">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Date</Table.HeaderCell>
                <Table.HeaderCell>Order</Table.HeaderCell>
                <Table.HeaderCell>Record</Table.HeaderCell>
                <Table.HeaderCell>Destination</Table.HeaderCell>
                <Table.HeaderCell>Provider</Table.HeaderCell>
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
                        className="text-ui-fg-interactive hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-fg-interactive"
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
                        {providerLabel(record.provider)}
                      </Text>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {record.taxRatePercent
                          ? `${Number(record.taxRatePercent).toFixed(3)}%`
                          : "No tax"}
                      </Text>
                    </Table.Cell>
                    <Table.Cell className="text-right tabular-nums">
                      {record.type === "refund" ? "−" : ""}
                      {formatMoney(
                        record.taxableSales,
                        record.currencyCode,
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
            Sales and credits grouped by destination and effective rate.
            Confirm New York jurisdiction codes before filing.
          </Text>
        </div>
        <div className="max-w-full overflow-x-auto">
          <Table className="min-w-[900px]">
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Destination</Table.HeaderCell>
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
              {report.destinations.map((destination) => (
                <Table.Row
                  key={[
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
                      {[
                        destination.city,
                        destination.county,
                        destination.stateCode,
                        destination.postalCode,
                      ]
                        .filter(Boolean)
                        .join(", ") || "Destination missing"}
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {destination.jurisdictionName ??
                        destination.countryCode ??
                        "No jurisdiction evidence"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    {destination.taxRatePercent
                      ? `${Number(destination.taxRatePercent).toFixed(3)}%`
                      : "—"}
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">
                    {formatMoney(destination.grossSales)}
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">
                    {formatMoney(destination.refundedSales)}
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">
                    {formatMoney(destination.taxableSales)}
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">
                    {formatMoney(destination.taxCollected)}
                  </Table.Cell>
                  <Table.Cell className="text-right tabular-nums">
                    {formatMoney(destination.refundedTax)}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      </Container>

      <Container>
        <Heading level="h2">What this report does not file</Heading>
        <Text size="small" className="mt-2 max-w-4xl text-ui-fg-subtle">
          Business use-tax purchases, exemption certificates, marketplace
          statements, bad-debt adjustments, and special taxes are not derived
          from storefront orders. Reconcile those separately, review the
          official return instructions, and file through New York Online
          Services.
        </Text>
        <Text size="xsmall" className="mt-3 text-ui-fg-muted">
          {report.source.medusaOrdersScanned} Medusa order
          {report.source.medusaOrdersScanned === 1 ? "" : "s"} scanned. No
          customer names, email addresses, phone numbers, or street addresses
          are included in exports.
        </Text>
      </Container>
    </div>
  );
});

export const config = defineRouteConfig({
  icon: ReceiptPercent,
  label: "Tax records",
  rank: 91,
});

export const handle = {
  breadcrumb: () => "Tax records",
};

export default TaxRecordsPage;
