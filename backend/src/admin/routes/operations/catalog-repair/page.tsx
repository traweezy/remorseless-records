"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Alert,
  Button,
  Checkbox,
  Container,
  Heading,
  Input,
  Text,
} from "@medusajs/ui"

import {
  adminPermissionKey,
  catalogAdminActions,
  nativeAdminActions,
} from "../../../../lib/admin-permissions"
import { AdminFormField } from "../../../components/admin-form-field"
import {
  AdminPageHeader,
  AdminSingleColumnLayout,
} from "../../../components/admin-page"
import { AdminPermissionBoundary } from "../../../components/admin-permission-boundary"
import { useAdminPermissions } from "../../../lib/admin-permissions"
import {
  beginRepair,
  catalogRepairStorageKey,
  clearConfirmedRepair,
  previewRepair,
  restoreRepair,
  retryRepair,
  scheduleRepairRestore,
  type SavedRepair,
} from "./command-state"
import {
  repairContextSchema,
  type RepairContext,
  type RepairPreview,
} from "./query"

export const catalogRepairReadActions = [
  catalogAdminActions.authoring.read,
  nativeAdminActions.product.read,
  nativeAdminActions.productVariant.read,
] as const
export const catalogRepairApplyActions = [
  catalogAdminActions.authoring.update,
  catalogAdminActions.authoring.delete,
] as const

type Fields = Omit<RepairContext, "backendOrigin">
const emptyFields: Fields = { creationOperationId: "", productId: "", sha: "" }

export const CatalogRepairReview = ({
  preview,
  record,
}: {
  preview: RepairPreview | null
  record: SavedRepair | null
}) => {
  const ids =
    record?.expectedIds ??
    (preview
      ? {
          profileId: preview.manifest.profile.id,
          variantProfileIds: preview.manifest.variants.map((row) => row.id),
          mediaLinkIds: preview.manifest.media.map((row) => row.id),
          retainedAssetIds: preview.manifest.assets.map((row) => row.id),
        }
      : null)
  if (!ids) return null
  return (
    <Container>
      <Heading level="h2">
        {record?.status === "succeeded"
          ? "Repair confirmed"
          : "Reviewed catalog records"}
      </Heading>
      <Text className="mt-2 text-ui-fg-subtle" size="small">
        {ids.variantProfileIds.length} variant profiles and{" "}
        {ids.mediaLinkIds.length} media links{" "}
        {record?.status === "succeeded" ? "were removed" : "will be removed"}{" "}
        with the product profile. {ids.retainedAssetIds.length} managed media
        files are retained.
      </Text>
      <dl className="mt-4 grid min-w-0 gap-2 text-sm">
        <dt className="font-medium">Product profile</dt>
        <dd className="break-all">{ids.profileId}</dd>
        <dt className="font-medium">Manifest fingerprint</dt>
        <dd className="break-all">
          {record?.body.expectedManifestSha256 ?? preview?.manifestSha256}
        </dd>
        {record ? (
          <>
            <dt className="font-medium">Saved request</dt>
            <dd className="break-all">{record.body.idempotencyKey}</dd>
          </>
        ) : null}
        {record?.result ? (
          <>
            <dt className="font-medium">Confirmed operation</dt>
            <dd className="break-all">{record.result.operationId}</dd>
          </>
        ) : null}
      </dl>
      <details className="mt-4 min-w-0">
        <summary className="cursor-pointer py-2">
          Inspect the exact record identifiers
        </summary>
        {(
          [
            ["Variant profiles", ids.variantProfileIds],
            ["Media links", ids.mediaLinkIds],
            ["Retained media", ids.retainedAssetIds],
          ] as const
        ).map(([title, values]) => (
          <section className="mt-3" key={title}>
            <Heading level="h3">{title}</Heading>
            <ul className="mt-1 space-y-1 text-sm">
              {values.map((value) => (
                <li className="break-all" key={value}>
                  {value}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </details>
    </Container>
  )
}

const CatalogRepairContent = () => {
  const permissions = useAdminPermissions()
  const canApply = catalogRepairApplyActions.every(permissions.hasPermission)
  const [fields, setFields] = useState<Fields>(emptyFields)
  const [preview, setPreview] = useState<RepairPreview | null>(null)
  const [record, setRecord] = useState<SavedRepair | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const epoch = useRef(0)
  const mounted = useRef(true)
  const inputRefs = useRef<Partial<Record<keyof Fields, HTMLInputElement>>>({})
  const backendOrigin =
    typeof window === "undefined" ? "" : window.location.origin
  const boundary = useCallback(
    (version: number) => ({
      storage: window.localStorage,
      locks: navigator.locks,
      isCurrent: () => mounted.current && epoch.current === version,
    }),
    []
  )
  const current = useCallback(
    (version: number) => mounted.current && epoch.current === version,
    []
  )
  const restore = useCallback(async () => {
    const version = ++epoch.current
    setReady(false)
    setBusy(true)
    setPreview(null)
    setReviewed(false)
    try {
      const saved = await restoreRepair(backendOrigin, boundary(version))
      if (!current(version)) return
      setRecord(saved)
      if (saved) {
        const { creationOperationId, productId, sha } = saved.context
        setFields({ creationOperationId, productId, sha })
      }
      setReady(true)
      setError(null)
    } catch {
      if (current(version)) {
        setRecord(null)
        setError(
          "The saved repair state or current administrator could not be verified. Return to the original administrator and server, then refresh saved state."
        )
      }
    } finally {
      if (current(version)) setBusy(false)
    }
  }, [backendOrigin, boundary, current])

  useEffect(() => {
    mounted.current = true
    const version = ++epoch.current
    void scheduleRepairRestore(() => current(version), restore)
    const changed = (event: StorageEvent) => {
      if (
        event.storageArea === window.localStorage &&
        (event.key === catalogRepairStorageKey || event.key === null)
      )
        void restore()
    }
    window.addEventListener("storage", changed)
    return () => {
      mounted.current = false
      epoch.current++
      window.removeEventListener("storage", changed)
    }
    // This route's session SDK resolves its "/" base URL to this origin.
    // Changes in another tab invalidate the local preview before resumption.
  }, [current, restore])

  const locked = busy || !ready || record !== null
  const context = (): RepairContext | null => {
    const parsed = repairContextSchema.safeParse({ ...fields, backendOrigin })
    if (parsed.success) return parsed.data
    const key = parsed.error.issues[0]?.path[0]
    setFieldError(typeof key === "string" ? key : null)
    if (typeof key === "string") inputRefs.current[key as keyof Fields]?.focus()
    setError(
      "Enter the creation operation, product identifier and exact 40-character revision before previewing."
    )
    return null
  }
  const inspect = async () => {
    const target = context()
    if (!target || locked) return
    const version = ++epoch.current
    setBusy(true)
    setPreview(null)
    setReviewed(false)
    setError(null)
    try {
      const result = await previewRepair(target, boundary(version))
      if (current(version)) setPreview(result)
    } catch {
      if (current(version))
        setError(
          "The preview could not be verified. Check the identifiers, revision and current access, or refresh saved state if another tab started a repair."
        )
    } finally {
      if (current(version)) setBusy(false)
    }
  }
  const apply = async () => {
    if (!canApply || busy || !ready || (!record && (!preview || !reviewed)))
      return
    const target = context()
    if (!target) return
    const version = ++epoch.current
    setBusy(true)
    setError(null)
    try {
      const result = record
        ? await retryRepair(record, backendOrigin, boundary(version))
        : await beginRepair(target, preview!, boundary(version))
      if (!current(version)) return
      setRecord(result.record)
      setPreview(null)
      setReviewed(false)
      const { creationOperationId, productId, sha } = result.record.context
      setFields({ creationOperationId, productId, sha })
      if (result.error)
        setError(
          "The repair outcome was not confirmed. Keep this saved request and retry it after restoring access or service availability."
        )
    } catch {
      if (current(version)) {
        setPreview(null)
        setReady(false)
        setError(
          "The request could not safely proceed. Refresh saved state before continuing; an existing request will be preserved."
        )
      }
    } finally {
      if (current(version)) setBusy(false)
    }
  }
  const startAnother = async () => {
    if (!record || record.status !== "succeeded" || busy) return
    const version = ++epoch.current
    setBusy(true)
    try {
      await clearConfirmedRepair(record, backendOrigin, boundary(version))
      if (current(version)) {
        setRecord(null)
        setFields(emptyFields)
        setError(null)
      }
    } catch {
      if (current(version))
        setError(
          "The confirmed request could not be cleared. Refresh saved state."
        )
    } finally {
      if (current(version)) setBusy(false)
    }
  }

  return (
    <AdminSingleColumnLayout aria-busy={busy}>
      <Container>
        <AdminPageHeader
          title="Catalog repair"
          description="Review and remove leftover catalog records from a failed product creation. Native commerce records must already be absent; managed media files are retained."
        />
        <Text className="mt-3 break-all text-ui-fg-subtle" size="small">
          Server: {backendOrigin}
        </Text>
      </Container>
      {error ? (
        <Alert role="alert" variant="error">
          {error}
        </Alert>
      ) : null}
      {record?.status === "uncertain" ? (
        <Alert role="status" variant="warning">
          This saved repair has an unconfirmed outcome. Retry this same request;
          its target and request identity remain locked across reloads and tabs.
        </Alert>
      ) : null}
      <Container>
        <Heading level="h2">Failed creation</Heading>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void inspect()
          }}
        >
          {(
            [
              ["creationOperationId", "Creation operation", "catop_…"],
              ["productId", "Product identifier", "prod_…"],
              ["sha", "Backend revision", "40-character commit revision"],
            ] as const
          ).map(([key, label, placeholder]) => (
            <AdminFormField
              key={key}
              label={label}
              error={fieldError === key ? "Check this identifier." : undefined}
            >
              {(control) => (
                <Input
                  {...control}
                  ref={(node) => {
                    if (node) inputRefs.current[key] = node
                  }}
                  className="mt-2"
                  autoComplete="off"
                  disabled={locked}
                  value={fields[key]}
                  placeholder={placeholder}
                  required
                  onChange={(event) => {
                    epoch.current++
                    setFields({ ...fields, [key]: event.target.value })
                    setPreview(null)
                    setReviewed(false)
                    setFieldError(null)
                    setError(null)
                  }}
                />
              )}
            </AdminFormField>
          ))}
          {!record ? (
            <Button
              className="min-h-10"
              type="submit"
              variant="secondary"
              disabled={busy || !ready}
            >
              Preview repair
            </Button>
          ) : null}
        </form>
        <Button
          className="mt-3 min-h-10"
          type="button"
          variant="transparent"
          disabled={busy}
          onClick={() => void restore()}
        >
          Refresh saved state
        </Button>
      </Container>
      <CatalogRepairReview preview={preview} record={record} />
      {preview && !record ? (
        <Container>
          {!canApply ? (
            <Text size="small">
              Your role can review this plan. Applying it also requires Catalog
              authoring update and delete permissions.
            </Text>
          ) : (
            <>
              <label className="flex min-h-8 items-start gap-3 py-2 text-sm">
                <Checkbox
                  checked={reviewed}
                  disabled={busy}
                  onCheckedChange={(value) => setReviewed(value === true)}
                />
                <span>
                  I reviewed the exact catalog records and retained media.
                </span>
              </label>
              <Button
                className="mt-4 min-h-10"
                type="button"
                disabled={busy || !reviewed}
                onClick={() => void apply()}
              >
                Apply reviewed repair
              </Button>
            </>
          )}
        </Container>
      ) : null}
      {record?.status === "uncertain" ? (
        <Container>
          {canApply ? (
            <Button
              className="min-h-10"
              type="button"
              disabled={busy || !ready}
              onClick={() => void apply()}
            >
              Retry saved request
            </Button>
          ) : (
            <Text size="small">
              The saved request is preserved. Its original administrator needs
              Catalog authoring update and delete permissions to recover the
              acknowledgment.
            </Text>
          )}
        </Container>
      ) : null}
      {record?.status === "succeeded" ? (
        <Container role="status">
          <Text size="small">
            The exact repair was confirmed
            {record.result?.replayed ? " by replaying the saved request" : ""}.
            Managed media files remain retained.
          </Text>
          <Button
            className="mt-4 min-h-10"
            type="button"
            disabled={busy}
            variant="secondary"
            onClick={() => void startAnother()}
          >
            Start another repair
          </Button>
        </Container>
      ) : null}
    </AdminSingleColumnLayout>
  )
}

export const CatalogRepairPage = () => (
  <AdminPermissionBoundary
    actions={catalogRepairReadActions}
    workspace="Catalog repair"
  >
    <CatalogRepairContent />
  </AdminPermissionBoundary>
)

export const config = defineRouteConfig({ label: "Catalog repair", rank: 4 })
export const handle = {
  breadcrumb: () => "Catalog repair",
  permissions: catalogRepairReadActions.map(adminPermissionKey),
}
export default CatalogRepairPage
