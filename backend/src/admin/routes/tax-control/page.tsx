"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { BuildingTax, CheckCircle, XCircle } from "@medusajs/icons";
import {
  Button,
  Container,
  Heading,
  Label,
  Prompt,
  Skeleton,
  StatusBadge,
  Table,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui";

type ProviderName = "stripe_tax" | "taxrate_io";

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
  description: string;
  name: string;
  provider: ProviderName;
  readiness: ProviderReadiness;
  selected: boolean;
  onSelect: (provider: ProviderName) => void;
};

const providerLabel = (provider: ProviderName): string =>
  provider === "stripe_tax" ? "Stripe Tax" : "TaxRate.io";

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
  ({ active, description, name, onSelect, provider, readiness, selected }) => {
    const handleSelect = useCallback(() => {
      onSelect(provider);
    }, [onSelect, provider]);

    return (
      <section
        className={`flex min-h-full flex-col rounded-lg border p-4 ${
          selected
            ? "border-ui-border-interactive shadow-elevation-card-rest"
            : "border-ui-border-base"
        }`}
        aria-label={name}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <Heading level="h2">{name}</Heading>
            <Text size="small" className="mt-1 text-ui-fg-subtle">
              {description}
            </Text>
          </div>
          <div className="flex flex-wrap gap-2">
            {active ? <StatusBadge color="blue">Active</StatusBadge> : null}
            {selected && !active ? (
              <StatusBadge color="orange">Selected</StatusBadge>
            ) : null}
            <StatusBadge color={readiness.ready ? "green" : "orange"}>
              {readiness.ready ? "Ready" : "Needs setup"}
            </StatusBadge>
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

        <Button
          className="mt-5"
          disabled={active}
          onClick={handleSelect}
          type="button"
          variant={selected ? "primary" : "secondary"}
        >
          {active
            ? "Currently active"
            : selected
              ? `${name} selected`
              : `Choose ${name}`}
        </Button>
      </section>
    );
  },
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

  const selectProvider = useCallback((provider: ProviderName) => {
    setSelectedProvider(provider);
    setSelectionAnnouncement(
      `${providerLabel(provider)} selected. Enter a reason to review this switch.`,
    );
    const browser = globalThis as unknown as {
      matchMedia: (query: string) => { matches: boolean };
      requestAnimationFrame: (callback: () => void) => number;
    };
    browser.requestAnimationFrame(() => {
      reasonRef.current?.scrollIntoView({
        behavior: browser.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "center",
      });
      reasonRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const handleReason = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = (event.currentTarget as unknown as { value?: unknown })
        .value;
      setReason(typeof value === "string" ? value : "");
    },
    [],
  );

  const selectedReadiness = useMemo(() => {
    if (!snapshot || !selectedProvider) {
      return null;
    }
    return selectedProvider === "stripe_tax"
      ? snapshot.providers.stripeTax
      : snapshot.providers.taxRateIo;
  }, [selectedProvider, snapshot]);

  const canSwitch =
    Boolean(snapshot && selectedProvider && selectedReadiness?.ready) &&
    reason.trim().length >= 10 &&
    !saving;

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

  return (
    <div className="flex flex-col gap-4">
      <Container>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Heading>Tax control</Heading>
            <Text className="mt-1 text-ui-fg-subtle">
              Choose the calculation engine used for new tax quotes.
            </Text>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge color="blue">
              {providerLabel(snapshot.control.activeProvider)}
            </StatusBadge>
            <Text size="xsmall" className="text-ui-fg-subtle">
              Generation {snapshot.control.generation}
            </Text>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-md bg-ui-bg-subtle p-3">
            <Text size="xsmall" className="text-ui-fg-subtle">
              Active carts · last {snapshot.impact.activeCartWindowDays} days
            </Text>
            <Text size="large" weight="plus">
              {snapshot.impact.activeCarts}
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

      <div className="grid gap-4 lg:grid-cols-2">
        <ProviderCard
          active={snapshot.control.activeProvider === "taxrate_io"}
          description="ZIP-code sales-tax rates with a monthly lookup quota."
          name="TaxRate.io"
          onSelect={selectProvider}
          provider="taxrate_io"
          readiness={snapshot.providers.taxRateIo}
          selected={selectedProvider === "taxrate_io"}
        />
        <ProviderCard
          active={snapshot.control.activeProvider === "stripe_tax"}
          description="Address-aware tax calculations linked to Stripe payments and reporting."
          name="Stripe Tax"
          onSelect={selectProvider}
          provider="stripe_tax"
          readiness={snapshot.providers.stripeTax}
          selected={selectedProvider === "stripe_tax"}
        />
      </div>
      <div aria-live="polite" className="sr-only">
        {selectionAnnouncement}
      </div>

      <Container>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Heading level="h2">Switch provider</Heading>
            <Text size="small" className="mt-1 text-ui-fg-subtle">
              Select a provider above, record the reason, and review the impact
              before confirming. Every switch is versioned in the audit log.
            </Text>
          </div>
          {selectedProvider ? (
            <StatusBadge color="orange">
              {providerLabel(selectedProvider)} selected
            </StatusBadge>
          ) : null}
        </div>
        <div className="mt-5 max-w-2xl">
          <Label htmlFor="tax-switch-reason">Reason for this change</Label>
          <Textarea
            ref={reasonRef}
            id="tax-switch-reason"
            className="mt-2"
            disabled={!selectedProvider}
            maxLength={500}
            onChange={handleReason}
            placeholder={
              selectedProvider
                ? "Example: Stripe sandbox validation completed and approved."
                : "Choose another provider above to begin."
            }
            rows={3}
            value={reason}
          />
          <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
            Minimum 10 characters · {reason.length}/500
          </Text>
        </div>

        <Prompt>
          <Prompt.Trigger asChild>
            <Button className="mt-4" disabled={!canSwitch} type="button">
              {selectedProvider
                ? `Review switch to ${providerLabel(selectedProvider)}`
                : "Choose another provider above"}
            </Button>
          </Prompt.Trigger>
          <Prompt.Content>
            <Prompt.Header>
              <Prompt.Title>
                Switch to{" "}
                {selectedProvider
                  ? providerLabel(selectedProvider)
                  : "provider"}
                ?
              </Prompt.Title>
              <Prompt.Description>
                New and unprepared carts will use generation{" "}
                {snapshot.control.generation + 1}. Prepared payments and
                completed orders keep their existing tax quote.
              </Prompt.Description>
            </Prompt.Header>
            <Prompt.Footer>
              <Prompt.Cancel>Keep current provider</Prompt.Cancel>
              <Prompt.Action disabled={saving} onClick={switchProvider}>
                {saving ? "Switching…" : "Confirm switch"}
              </Prompt.Action>
            </Prompt.Footer>
          </Prompt.Content>
        </Prompt>
        <div aria-live="polite" className="sr-only">
          {saving ? "Switching tax provider" : ""}
        </div>
      </Container>

      <Container>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Heading level="h2">TaxRate.io usage</Heading>
            <Text size="small" className="mt-1 text-ui-fg-subtle">
              This is the last quota value returned by TaxRate.io, not an
              estimate.
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
            Use 1 lookup to refresh
          </Button>
        </div>

        {quota ? (
          <div className="mt-5">
            <div className="flex items-center justify-between gap-3">
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
          </div>
        ) : (
          <Text size="small" className="mt-5 text-ui-fg-subtle">
            No quota response has been recorded yet. A real checkout lookup
            updates this automatically.
          </Text>
        )}
        {!snapshot.providers.taxRateIo.manualRefreshConfigured ? (
          <div className="mt-4 rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
            <Text size="small" weight="plus" className="text-ui-fg-warning">
              Usage monitoring needs setup
            </Text>
            <Text size="xsmall" className="mt-1 text-ui-fg-subtle">
              Configure TAX_RATE_LOOKUP_MONITOR_POSTAL_CODE to enable a
              deliberate quota refresh. Checkout tax calculation is still ready,
              and real checkout lookups continue recording usage.
            </Text>
          </div>
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
