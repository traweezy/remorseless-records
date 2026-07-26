"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { BuildingTax, CheckCircle, XCircle } from "@medusajs/icons";
import {
  Button,
  Container,
  Heading,
  Label,
  Prompt,
  RadioGroup,
  Skeleton,
  StatusBadge,
  Table,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui";
import {
  canReviewProviderSwitch,
  getProviderCardState,
  isProviderName,
  normalizeTargetProvider,
  providerLabel,
  resolveProviderSelection,
  type ProviderName,
} from "./ui-state";

type FocusableTextarea = HTMLTextAreaElement & {
  focus: (options?: { preventScroll?: boolean }) => void;
  scrollIntoView: (options?: {
    behavior?: "auto" | "smooth";
    block?: "center";
  }) => void;
};

type ReadinessCheck = {
  detail: string;
  id: string;
  label: string;
  ready: boolean;
};

type ProviderReadiness = {
  checks: ReadinessCheck[];
  configured: boolean;
  message: string;
  ready: boolean;
};

type TaxControlSnapshot = {
  audits: Array<{
    actorId: string;
    createdAt: string | null;
    fromGeneration: number;
    fromProvider: ProviderName;
    id: string;
    reason: string;
    toGeneration: number;
    toProvider: ProviderName;
  }>;
  control: {
    activeProvider: ProviderName;
    generation: number;
    lastSwitchReason: string | null;
    lastSwitchedAt: string | null;
    lastSwitchedBy: string | null;
  };
  evidence: {
    incidents: Array<{
      associationStatus: string | null;
      id: string;
      lastVerifiedAt: string | null;
      currencyCode: string;
      medusaRefundAmountMinor: number | null;
      orderId: string | null;
      paymentIntentId: string;
      provider: ProviderName;
      status:
        | "association_failed"
        | "disputed"
        | "refund_ledger_mismatch"
        | "refund_pending";
      stripeEvidenceAvailable: boolean;
      stripeRefundAmountMinor: number | null;
    }>;
    needsAttention: number;
    pendingRefundReversals: number;
    prepared: number;
    refundLedger: {
      available: boolean;
      checked: number;
      mismatches: number;
      truncated: boolean;
    };
    refunds: number;
    succeeded: number;
    tracked: number;
  };
  impact: {
    activeCartWindowDays: number;
    activeCarts: number;
    finalizingCarts: number;
    frozenByProvider: Record<ProviderName, number>;
    preparedCarts: number;
    truncated: boolean;
  };
  providers: {
    stripeTax: ProviderReadiness & {
      accountMode: "live" | "sandbox" | "unknown";
      activeRegistrationCount: number;
      missingFields: string[];
    };
    taxRateIo: ProviderReadiness & {
      manualRefreshConfigured: boolean;
      quota: {
        observedAt: string | null;
        quota: number;
        remaining: number;
        source: string;
        usage: number;
        usagePercent: number;
      } | null;
    };
  };
};

type ProviderCardProps = {
  active: boolean;
  children?: ReactNode;
  description: string;
  name: string;
  pending: boolean;
  provider: ProviderName;
  readiness: ProviderReadiness;
  highlighted: boolean;
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

const extractErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as {
      message?: string;
      detail?: string;
    };
    return body.detail ?? body.message ?? response.statusText;
  } catch {
    return response.statusText;
  }
};

const fetchJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
  return (await response.json()) as T;
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

const ProviderCard = memo<ProviderCardProps>(
  ({
    active,
    children,
    description,
    highlighted,
    name,
    pending,
    provider,
    readiness,
  }) => (
    <section
      className={`flex min-h-full flex-col rounded-lg border p-4 transition-[border-color,box-shadow,background-color] duration-200 motion-reduce:transition-none ${
        active
          ? "border-ui-border-interactive bg-ui-bg-base-hover ring-1 ring-ui-fg-interactive"
          : pending
            ? "border-ui-border-strong shadow-elevation-card-rest"
            : "border-ui-border-base"
      }`}
      aria-label={`${name}${active ? ", active provider" : ""}`}
      data-active={active ? "true" : "false"}
      data-highlighted={highlighted ? "true" : "false"}
      data-pending={pending ? "true" : "false"}
    >
      <div className="flex items-start gap-3">
        <RadioGroup.Item
          aria-describedby={`tax-provider-${provider}-description`}
          className="mt-0.5 shrink-0"
          id={`tax-provider-${provider}`}
          value={provider}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <Label
                className="cursor-pointer"
                htmlFor={`tax-provider-${provider}`}
                size="base"
                weight="plus"
              >
                {name}
              </Label>
              <Text
                id={`tax-provider-${provider}-description`}
                size="small"
                className="mt-1 text-ui-fg-subtle"
              >
                {description}
              </Text>
            </div>
            <div className="flex flex-wrap gap-2">
              {active ? (
                <StatusBadge color="blue">Active provider</StatusBadge>
              ) : null}
              {pending ? (
                <StatusBadge color="orange">Pending change</StatusBadge>
              ) : null}
              <StatusBadge color={readiness.ready ? "green" : "orange"}>
                {readiness.ready ? "Ready" : "Needs setup"}
              </StatusBadge>
            </div>
          </div>
        </div>
      </div>

      <Text size="small" className="mt-4">
        {readiness.message}
      </Text>
      <ul className="mt-4 flex flex-1 flex-col gap-3">
        {readiness.checks.map((item) => (
          <li key={item.id} className="flex items-start gap-2">
            {item.ready ? (
              <CheckCircle
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-ui-fg-success"
              />
            ) : (
              <XCircle
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-ui-fg-error"
              />
            )}
            <div className="min-w-0">
              <Text size="small" weight="plus">
                {item.label}
              </Text>
              <Text size="xsmall" className="text-ui-fg-subtle">
                {item.detail}
              </Text>
            </div>
          </li>
        ))}
      </ul>

      {children ? (
        <div className="mt-5 border-t border-ui-border-base pt-4">
          {children}
        </div>
      ) : null}
    </section>
  ),
);

const LoadingState = memo(() => (
  <div className="flex flex-col gap-4" aria-label="Loading tax control">
    <Skeleton className="h-28 w-full" />
    <div className="grid gap-4 lg:grid-cols-2">
      <Skeleton className="h-80 w-full" />
      <Skeleton className="h-80 w-full" />
    </div>
  </div>
));

const TaxControlPage = memo(() => {
  const [snapshot, setSnapshot] = useState<TaxControlSnapshot | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderName | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshingQuota, setRefreshingQuota] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectionAnnouncement, setSelectionAnnouncement] = useState("");
  const loadLockRef = useRef(false);
  const switchLockRef = useRef(false);
  const quotaRefreshLockRef = useRef(false);
  const reasonRef = useRef<FocusableTextarea>(null);

  const load = useCallback(async () => {
    if (loadLockRef.current) {
      return;
    }
    loadLockRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchJson<TaxControlSnapshot>("/admin/tax-control");
      setSnapshot(next);
      setSelectedProvider((current) =>
        current && current !== next.control.activeProvider ? current : null,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Tax control could not be loaded.",
      );
    } finally {
      loadLockRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectProvider = useCallback(
    (value: string) => {
      if (!snapshot || !isProviderName(value)) {
        return;
      }
      const targetProvider = normalizeTargetProvider(
        snapshot.control.activeProvider,
        value,
      );
      setSelectedProvider(targetProvider);
      if (!targetProvider) {
        setReason("");
        setSelectionAnnouncement(
          `${providerLabel(value)} remains the active provider. No change is pending.`,
        );
        return;
      }

      setSelectionAnnouncement(
        `${providerLabel(targetProvider)} selected as the pending provider. Enter a reason to review this change.`,
      );
      const browser = globalThis as unknown as {
        matchMedia: (query: string) => { matches: boolean };
        requestAnimationFrame: (callback: () => void) => number;
      };
      browser.requestAnimationFrame(() => {
        reasonRef.current?.scrollIntoView({
          behavior: browser.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "auto"
            : "smooth",
          block: "center",
        });
        reasonRef.current?.focus({ preventScroll: true });
      });
    },
    [snapshot],
  );

  const handleReason = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = (event.currentTarget as unknown as { value?: unknown })
        .value;
      setReason(typeof value === "string" ? value : "");
    },
    [],
  );

  const cancelPendingChange = useCallback(() => {
    if (!snapshot) {
      return;
    }
    setSelectedProvider(null);
    setReason("");
    setSelectionAnnouncement(
      `${providerLabel(snapshot.control.activeProvider)} remains the active provider. The pending change was canceled.`,
    );
  }, [snapshot]);

  const selectedReadiness = useMemo(() => {
    if (!snapshot || !selectedProvider) {
      return null;
    }
    return selectedProvider === "stripe_tax"
      ? snapshot.providers.stripeTax
      : snapshot.providers.taxRateIo;
  }, [selectedProvider, snapshot]);

  const canSwitch = snapshot
    ? canReviewProviderSwitch({
        activeProvider: snapshot.control.activeProvider,
        reason,
        saving,
        targetProvider: selectedProvider,
        targetReady: selectedReadiness?.ready ?? false,
      })
    : false;

  const switchProvider = useCallback(async () => {
    if (!snapshot || !selectedProvider || !canSwitch || switchLockRef.current) {
      return;
    }
    switchLockRef.current = true;
    setSaving(true);
    try {
      const next = await fetchJson<TaxControlSnapshot>(
        "/admin/tax-control/switch",
        {
          body: JSON.stringify({
            expectedGeneration: snapshot.control.generation,
            idempotencyKey: crypto.randomUUID(),
            reason: reason.trim(),
            targetProvider: selectedProvider,
          }),
          method: "POST",
        },
      );
      setSnapshot(next);
      setSelectedProvider(null);
      setReason("");
      setSelectionAnnouncement(
        `${providerLabel(selectedProvider)} is now active.`,
      );
      toast.success(`${providerLabel(selectedProvider)} is now active`);
    } catch (caught) {
      toast.error(
        caught instanceof Error
          ? caught.message
          : "The provider could not be switched.",
      );
      await load();
    } finally {
      switchLockRef.current = false;
      setSaving(false);
    }
  }, [canSwitch, load, reason, selectedProvider, snapshot]);

  const refreshQuota = useCallback(async () => {
    if (quotaRefreshLockRef.current) {
      return;
    }
    quotaRefreshLockRef.current = true;
    setRefreshingQuota(true);
    try {
      const next = await fetchJson<TaxControlSnapshot>(
        "/admin/tax-control/taxrate-io/refresh",
        { method: "POST" },
      );
      setSnapshot(next);
      toast.success("TaxRate.io quota refreshed");
    } catch (caught) {
      toast.error(
        caught instanceof Error
          ? caught.message
          : "TaxRate.io quota could not be refreshed.",
      );
    } finally {
      quotaRefreshLockRef.current = false;
      setRefreshingQuota(false);
    }
  }, []);

  if (loading) {
    return <LoadingState />;
  }

  if (!snapshot) {
    return (
      <Container>
        <Heading>Tax control is unavailable</Heading>
        <Text className="mt-2 text-ui-fg-subtle">
          {error ?? "The tax control state could not be loaded."}
        </Text>
        <Button className="mt-4" onClick={load} type="button">
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
  const activeDescription =
    activeProvider === "stripe_tax"
      ? "Address-aware calculations are attached to Stripe payments for tax reporting and refund reversals."
      : "US ZIP-code rates are applied in Medusa and each real lookup records TaxRate.io's returned quota.";
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
  const selectedValue = resolveProviderSelection(
    activeProvider,
    selectedProvider,
  );
  const taxRateIoCardState = getProviderCardState({
    activeProvider,
    provider: "taxrate_io",
    targetProvider: selectedProvider,
  });
  const stripeTaxCardState = getProviderCardState({
    activeProvider,
    provider: "stripe_tax",
    targetProvider: selectedProvider,
  });

  return (
    <div className="flex flex-col gap-4">
      <Container>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Heading>Tax control</Heading>
            <Text className="mt-1 text-ui-fg-subtle">
              Review the active calculation engine, usage, and payment impact
              before making a versioned change.
            </Text>
          </div>
          <StatusBadge color={activeReadiness.ready ? "green" : "orange"}>
            {activeReadiness.ready ? "Operational" : "Needs attention"}
          </StatusBadge>
        </div>

        <section
          aria-label={`Active provider: ${providerLabel(activeProvider)}`}
          className="mt-6 rounded-lg border border-ui-border-interactive bg-ui-bg-base-hover p-4 ring-1 ring-ui-fg-interactive"
          data-testid="active-provider-overview"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Text size="xsmall" weight="plus" className="text-ui-fg-base">
                Active provider
              </Text>
              <Heading level="h2" className="mt-1">
                {providerLabel(activeProvider)}
              </Heading>
              <Text size="small" className="mt-2 max-w-3xl text-ui-fg-subtle">
                {activeDescription}
              </Text>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge color="blue">Applied now</StatusBadge>
              <StatusBadge color={activeReadiness.ready ? "green" : "orange"}>
                {activeReadiness.ready ? "Ready" : "Needs setup"}
              </StatusBadge>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-md bg-ui-bg-base p-3">
              <Text size="xsmall" className="text-ui-fg-subtle">
                Calculation basis
              </Text>
              <Text size="small" weight="plus" className="mt-1">
                {activeCalculationBasis}
              </Text>
            </div>
            <div className="rounded-md bg-ui-bg-base p-3">
              <Text size="xsmall" className="text-ui-fg-subtle">
                Provider status
              </Text>
              <Text size="small" weight="plus" className="mt-1">
                {activeProviderDetail}
              </Text>
            </div>
            <div className="rounded-md bg-ui-bg-base p-3">
              <Text size="xsmall" className="text-ui-fg-subtle">
                Configuration generation
              </Text>
              <Text size="small" weight="plus" className="mt-1">
                {snapshot.control.generation}
              </Text>
            </div>
            <div className="rounded-md bg-ui-bg-base p-3">
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

          <div className="mt-3 rounded-md border border-ui-border-base bg-ui-bg-base p-3">
            <Text size="xsmall" className="text-ui-fg-subtle">
              Last change reason
            </Text>
            <Text size="small" className="mt-1">
              {snapshot.control.lastSwitchReason ??
                "Initial provider configuration; no switch has been recorded."}
            </Text>
          </div>
        </section>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-md bg-ui-bg-subtle p-3">
            <Text size="xsmall" className="text-ui-fg-subtle">
              Active carts · last {snapshot.impact.activeCartWindowDays} days
            </Text>
            <Text size="large" weight="plus">
              {snapshot.impact.activeCarts}
              {snapshot.impact.truncated ? "+" : ""}
            </Text>
          </div>
          <div className="rounded-md bg-ui-bg-subtle p-3">
            <Text size="xsmall" className="text-ui-fg-subtle">
              Prepared checkouts
            </Text>
            <Text size="large" weight="plus">
              {snapshot.impact.preparedCarts}
            </Text>
          </div>
          <div className="rounded-md bg-ui-bg-subtle p-3">
            <Text size="xsmall" className="text-ui-fg-subtle">
              Payments finalizing
            </Text>
            <Text size="large" weight="plus">
              {snapshot.impact.finalizingCarts}
            </Text>
          </div>
        </div>
        <Text size="small" className="mt-4 text-ui-fg-subtle">
          Open carts without a prepared payment use the new provider on their
          next tax refresh. Prepared payments stay frozen to their reviewed
          quote, and captured orders are never repriced.
        </Text>
        {snapshot.impact.truncated ? (
          <Text size="xsmall" className="mt-2 text-ui-fg-warning">
            The active-cart impact preview reached its 500-cart display limit.
          </Text>
        ) : null}
      </Container>

      <Container>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Heading level="h2">Calculation provider</Heading>
            <Text size="small" className="mt-1 text-ui-fg-subtle">
              Select the engine Medusa should use for new tax quotes. The blue
              outline always identifies the provider currently applied.
            </Text>
          </div>
        </div>

        <RadioGroup
          aria-label="Tax calculation provider"
          className="mt-5 grid gap-4 lg:grid-cols-2"
          onValueChange={selectProvider}
          orientation="horizontal"
          value={selectedValue}
        >
          <ProviderCard
            active={taxRateIoCardState.active}
            description="ZIP-code sales-tax rates with a monthly lookup quota."
            highlighted={taxRateIoCardState.highlighted}
            name="TaxRate.io"
            pending={taxRateIoCardState.pending}
            provider="taxrate_io"
            readiness={snapshot.providers.taxRateIo}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Text size="small" weight="plus">
                  Monthly lookup usage
                </Text>
                <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                  Provider-reported usage, never an estimate.
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
                    {quota.remaining} of {quota.quota} remaining
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
                  {quota.usage} used · source {quota.source}
                </Text>
              </div>
            ) : (
              <Text size="small" className="mt-4 text-ui-fg-subtle">
                No quota response has been recorded. A real checkout lookup
                updates this automatically.
              </Text>
            )}

            {!snapshot.providers.taxRateIo.manualRefreshConfigured ? (
              <div className="mt-4 rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
                <Text size="small" weight="plus" className="text-ui-fg-warning">
                  Manual usage refresh needs setup
                </Text>
                <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                  A monitoring ZIP code has not been configured. Checkout
                  calculations still record usage automatically; ask the store
                  administrator to enable deliberate quota checks.
                </Text>
              </div>
            ) : null}
          </ProviderCard>

          <ProviderCard
            active={stripeTaxCardState.active}
            description="Address-aware calculations linked to Stripe payments, reporting, and refund reversals."
            highlighted={stripeTaxCardState.highlighted}
            name="Stripe Tax"
            pending={stripeTaxCardState.pending}
            provider="stripe_tax"
            readiness={snapshot.providers.stripeTax}
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
        </RadioGroup>

        <div aria-live="polite" className="sr-only">
          {selectionAnnouncement}
        </div>

        {selectedProvider ? (
          <section
            aria-labelledby="pending-provider-change-title"
            className="mt-6 rounded-lg border border-ui-border-strong bg-ui-bg-subtle p-4"
            data-testid="provider-change-review"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Text
                  size="xsmall"
                  weight="plus"
                  className="text-ui-fg-warning"
                >
                  Pending configuration change
                </Text>
                <Heading
                  id="pending-provider-change-title"
                  level="h3"
                  className="mt-1"
                >
                  Change from {providerLabel(activeProvider)} to{" "}
                  {providerLabel(selectedProvider)}
                </Heading>
                <Text size="small" className="mt-2 text-ui-fg-subtle">
                  Nothing changes until an admin confirms this review.
                </Text>
              </div>
              <StatusBadge
                color={selectedReadiness?.ready ? "green" : "orange"}
              >
                {selectedReadiness?.ready
                  ? "Target ready"
                  : "Target needs setup"}
              </StatusBadge>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-md bg-ui-bg-base p-3">
                <Text size="xsmall" className="text-ui-fg-subtle">
                  New generation
                </Text>
                <Text size="small" weight="plus" className="mt-1">
                  {snapshot.control.generation + 1}
                </Text>
              </div>
              <div className="rounded-md bg-ui-bg-base p-3">
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Active carts reviewed
                </Text>
                <Text size="small" weight="plus" className="mt-1">
                  {snapshot.impact.activeCarts}
                  {snapshot.impact.truncated ? "+" : ""}
                </Text>
              </div>
              <div className="rounded-md bg-ui-bg-base p-3">
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Frozen prepared checkouts
                </Text>
                <Text size="small" weight="plus" className="mt-1">
                  {snapshot.impact.preparedCarts}
                </Text>
              </div>
            </div>
            <Text size="small" className="mt-4 text-ui-fg-subtle">
              Open carts without a prepared payment refresh onto the new
              generation. Prepared payments and captured orders keep their
              reviewed tax quote.
            </Text>

            {!selectedReadiness?.ready ? (
              <div className="mt-4 rounded-md border border-ui-border-base bg-ui-bg-base p-3">
                <Text size="small" weight="plus" className="text-ui-fg-warning">
                  Complete the provider checks above before switching.
                </Text>
              </div>
            ) : null}

            <div className="mt-5 max-w-2xl">
              <Label htmlFor="tax-switch-reason">Reason for this change</Label>
              <Textarea
                ref={reasonRef}
                id="tax-switch-reason"
                className="mt-2"
                maxLength={500}
                onChange={handleReason}
                placeholder="Example: Stripe sandbox validation completed and approved."
                rows={3}
                value={reason}
              />
              <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
                Minimum 10 characters · {reason.length}/500
              </Text>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Prompt>
                <Prompt.Trigger asChild>
                  <Button disabled={!canSwitch} type="button">
                    Review and switch to {providerLabel(selectedProvider)}
                  </Button>
                </Prompt.Trigger>
                <Prompt.Content>
                  <Prompt.Header>
                    <Prompt.Title>
                      Switch to {providerLabel(selectedProvider)}?
                    </Prompt.Title>
                    <Prompt.Description>
                      New and unprepared carts will use generation{" "}
                      {snapshot.control.generation + 1}. Prepared payments and
                      completed orders keep their existing tax quote. The reason
                      will be written to the immutable provider history.
                      <span className="mt-2 block font-medium text-ui-fg-base">
                        Reason: {reason.trim()}
                      </span>
                    </Prompt.Description>
                  </Prompt.Header>
                  <Prompt.Footer>
                    <Prompt.Cancel>Back to review</Prompt.Cancel>
                    <Prompt.Action disabled={saving} onClick={switchProvider}>
                      {saving ? "Switching…" : "Confirm provider change"}
                    </Prompt.Action>
                  </Prompt.Footer>
                </Prompt.Content>
              </Prompt>
              <Button
                disabled={saving}
                onClick={cancelPendingChange}
                type="button"
                variant="secondary"
              >
                Cancel change
              </Button>
            </div>
          </section>
        ) : null}
        <div aria-live="polite" className="sr-only">
          {saving ? "Switching tax provider" : ""}
        </div>
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

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="rounded-md bg-ui-bg-subtle p-3">
            <Text size="xsmall" className="text-ui-fg-subtle">
              Payments tracked
            </Text>
            <Text size="large" weight="plus">
              {snapshot.evidence.tracked}
            </Text>
          </div>
          <div className="rounded-md bg-ui-bg-subtle p-3">
            <Text size="xsmall" className="text-ui-fg-subtle">
              Awaiting final state
            </Text>
            <Text size="large" weight="plus">
              {snapshot.evidence.prepared}
            </Text>
          </div>
          <div className="rounded-md bg-ui-bg-subtle p-3">
            <Text size="xsmall" className="text-ui-fg-subtle">
              Successful
            </Text>
            <Text size="large" weight="plus">
              {snapshot.evidence.succeeded}
            </Text>
          </div>
          <div className="rounded-md bg-ui-bg-subtle p-3">
            <Text size="xsmall" className="text-ui-fg-subtle">
              Partially or fully refunded
            </Text>
            <Text size="large" weight="plus">
              {snapshot.evidence.refunds}
            </Text>
          </div>
          <div className="rounded-md bg-ui-bg-subtle p-3">
            <Text size="xsmall" className="text-ui-fg-subtle">
              Tax reversals pending
            </Text>
            <Text size="large" weight="plus">
              {snapshot.evidence.pendingRefundReversals}
            </Text>
          </div>
          <div className="rounded-md bg-ui-bg-subtle p-3">
            <Text size="xsmall" className="text-ui-fg-subtle">
              Refund ledger mismatches
            </Text>
            <Text size="large" weight="plus">
              {snapshot.evidence.refundLedger.mismatches}
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
                      <Text size="xsmall" className="block text-ui-fg-subtle">
                        Generation {audit.fromGeneration} → {audit.toGeneration}
                      </Text>
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
