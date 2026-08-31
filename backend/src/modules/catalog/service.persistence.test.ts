import type {
  CatalogBundleInventoryLinkState,
  CatalogBundleMutationInput,
  CatalogBundleStateSnapshot,
} from "./bundle-authoring"
import CatalogModuleService from "./service"
import { catalogOperationFixture } from "../../lib/catalog/transaction-persistence-fixtures.test-helpers"

type MutableRecord = Record<string, unknown>
const sharedContext = { manager: {}, transactionManager: {} } as never

const inputFixture = (
  overrides: Partial<CatalogBundleMutationInput> = {}
): CatalogBundleMutationInput => ({
  actorId: "user_1",
  aggregateId: "prod_1",
  command: "catalog.bundle.upsert",
  components: [
    {
      component_inventory_item_id: "iitem_1",
      component_product_id: "prod_2",
      component_variant_id: "variant_2",
      is_required: true,
      metadata: {},
      quantity: 2,
      sku: "COMP-2",
      sort_order: 0,
      title: "Component",
      variant_title: "Black",
    },
  ],
  expectedVersion: 0,
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
  profile: {
    bundle_type: "fixed",
    description_html: null,
    display_title: "Starter set",
    fulfillment_mode: "ship_components",
    inventory_mode: "component_derived",
    is_active: true,
    metadata: {},
    product_id: "prod_1",
    product_profile_id: "cprof_1",
  },
  requestSha256: "a".repeat(64),
  ...overrides,
})

const serviceHarness = () => {
  const service = Object.create(CatalogModuleService.prototype) as InstanceType<
    typeof CatalogModuleService
  >
  const mutableService = service as unknown as Record<string, jest.Mock>
  ;(
    service as unknown as {
      baseRepository_: {
        getFreshManager: () => Record<string, never>
        transaction: <T>(
          task: (manager: Record<string, never>) => Promise<T>
        ) => Promise<T>
      }
    }
  ).baseRepository_ = {
    getFreshManager: () => ({}),
    transaction: async (task) => task({}),
  }
  let profiles: MutableRecord[] = []
  let components: MutableRecord[] = []
  let operations: MutableRecord[] = []
  let inventoryLinks: MutableRecord[] = []

  mutableService.listCatalogBundleProfiles = jest.fn(
    async (filters: MutableRecord) =>
      profiles.filter(
        (profile) =>
          filters.product_id === undefined ||
          profile.product_id === filters.product_id
      )
  )
  mutableService.listCatalogBundleComponents = jest.fn(
    async (filters: MutableRecord) =>
      components.filter(
        (component) =>
          filters.bundle_profile_id === undefined ||
          component.bundle_profile_id === filters.bundle_profile_id
      )
  )
  mutableService.createCatalogBundleProfiles = jest.fn(
    async (payloads: MutableRecord[]) => {
      const created = payloads.map((payload, index) => ({
        id: payload.id ?? `cbundle_${index + 1}`,
        ...payload,
      }))
      profiles.push(...created)
      return created
    }
  )
  mutableService.updateCatalogBundleProfiles = jest.fn(
    async (payloads: MutableRecord[]) =>
      payloads.map((payload) => {
        const index = profiles.findIndex(({ id }) => id === payload.id)
        const updated = { ...profiles[index], ...payload }
        profiles[index] = updated
        return updated
      })
  )
  mutableService.deleteCatalogBundleProfiles = jest.fn(
    async (ids: string | string[]) => {
      const deleted = new Set(Array.isArray(ids) ? ids : [ids])
      profiles = profiles.filter(({ id }) => !deleted.has(String(id)))
    }
  )
  mutableService.createCatalogBundleComponents = jest.fn(
    async (payloads: MutableRecord[]) => {
      const created = payloads.map((payload, index) => ({
        id: payload.id ?? `cbcomp_${index + 1}`,
        ...payload,
      }))
      components.push(...created)
      return created
    }
  )
  mutableService.deleteCatalogBundleComponents = jest.fn(
    async (ids: string | string[]) => {
      const deleted = new Set(Array.isArray(ids) ? ids : [ids])
      components = components.filter(({ id }) => !deleted.has(String(id)))
    }
  )
  mutableService.listCatalogAuthoringOperations = jest.fn(
    async (filters: MutableRecord) =>
      operations.filter(
        (operation) =>
          (filters.id === undefined || operation.id === filters.id) &&
          (filters.idempotency_key === undefined ||
            operation.idempotency_key === filters.idempotency_key)
      )
  )
  mutableService.createCatalogAuthoringOperations = jest.fn(
    async (payloads: MutableRecord[]) => {
      const created = payloads.map((payload, index) =>
        catalogOperationFixture({
          id: `catop_${index + 1}`,
          ...payload,
        })
      )
      operations.push(...created)
      return created
    }
  )
  mutableService.updateCatalogAuthoringOperations = jest.fn(
    async (payloads: MutableRecord[]) =>
      payloads.map((payload) => {
        const index = operations.findIndex(({ id }) => id === payload.id)
        const updated = { ...operations[index], ...payload }
        operations[index] = updated
        return updated
      })
  )
  mutableService.listCatalogBundleInventoryLinks = jest.fn(
    async (filters: MutableRecord) =>
      inventoryLinks.filter(
        (link) =>
          filters.bundle_profile_id === undefined ||
          link.bundle_profile_id === filters.bundle_profile_id
      )
  )
  mutableService.createCatalogBundleInventoryLinks = jest.fn(
    async (payloads: MutableRecord[]) => {
      const created = payloads.map((payload, index) => ({
        id: `cbilink_${index + 1}`,
        ...payload,
      }))
      inventoryLinks.push(...created)
      return created
    }
  )
  mutableService.deleteCatalogBundleInventoryLinks = jest.fn(
    async (ids: string | string[]) => {
      const deleted = new Set(Array.isArray(ids) ? ids : [ids])
      inventoryLinks = inventoryLinks.filter(
        ({ id }) => !deleted.has(String(id))
      )
    }
  )

  return {
    components: () => components,
    inventoryLinks: () => inventoryLinks,
    mocks: mutableService,
    operations: () => operations,
    profiles: () => profiles,
    service,
    setComponents: (value: MutableRecord[]) => {
      components = value
    },
    setInventoryLinks: (value: MutableRecord[]) => {
      inventoryLinks = value
    },
    setOperations: (value: MutableRecord[]) => {
      operations = value
    },
    setProfiles: (value: MutableRecord[]) => {
      profiles = value
    },
  }
}

describe("catalog module transaction persistence", () => {
  it("persists an exact bundle profile, components, and pending operation", async () => {
    const harness = serviceHarness()

    await expect(
      harness.service.mutateBundle(inputFixture(), sharedContext)
    ).resolves.toEqual(
      expect.objectContaining({
        operationId: "catop_1",
        profileId: "cbundle_1",
        replayed: false,
        version: 1,
      })
    )
    expect(harness.profiles()).toEqual([
      expect.objectContaining({
        id: "cbundle_1",
        product_id: "prod_1",
        version: 1,
      }),
    ])
    expect(harness.components()).toEqual([
      expect.objectContaining({
        bundle_profile_id: "cbundle_1",
        component_product_id: "prod_2",
        quantity: 2,
      }),
    ])
    expect(harness.operations()).toEqual([
      expect.objectContaining({ id: "catop_1", status: "pending" }),
    ])
  })

  it("fails closed on duplicate snapshots and partial write acknowledgements", async () => {
    const duplicateHarness = serviceHarness()
    duplicateHarness.setProfiles([
      { ...inputFixture().profile, id: "cbundle_1", version: 1 },
      { ...inputFixture().profile, id: "cbundle_2", version: 1 },
    ])
    await expect(
      duplicateHarness.service.mutateBundle(
        inputFixture({ expectedVersion: 1 }),
        sharedContext
      )
    ).rejects.toThrow("transaction persistence boundary")

    const partialHarness = serviceHarness()
    partialHarness.mocks.createCatalogBundleComponents!.mockResolvedValue([])
    await expect(
      partialHarness.service.mutateBundle(inputFixture(), sharedContext)
    ).rejects.toThrow("transaction persistence boundary")
  })

  it("replays only an exact succeeded bundle result", async () => {
    const harness = serviceHarness()
    const input = inputFixture()
    harness.setOperations([
      catalogOperationFixture({
        aggregate_id: input.aggregateId,
        command: input.command,
        idempotency_key: input.idempotencyKey,
        request_sha256: input.requestSha256,
        result: {
          deleted: false,
          productId: input.aggregateId,
          profileId: "cbundle_1",
          version: 1,
        },
        status: "succeeded",
      }),
    ])

    await expect(
      harness.service.mutateBundle(input, sharedContext)
    ).resolves.toEqual(
      expect.objectContaining({
        profileId: "cbundle_1",
        replayed: true,
        version: 1,
      })
    )
    harness.setOperations([
      catalogOperationFixture({
        aggregate_id: input.aggregateId,
        command: input.command,
        idempotency_key: input.idempotencyKey,
        request_sha256: input.requestSha256,
        result: { profileId: "cbundle_1" },
        status: "succeeded",
      }),
    ])
    await expect(
      harness.service.mutateBundle(input, sharedContext)
    ).rejects.toThrow("transaction persistence boundary")
  })

  it("restores a prior snapshot only while its operation is pending", async () => {
    const harness = serviceHarness()
    const input = inputFixture()
    const previous: CatalogBundleStateSnapshot = {
      components: [
        {
          ...input.components[0]!,
          bundle_profile_id: "cbundle_old",
          id: "cbcomp_old",
        },
      ],
      profile: {
        ...input.profile!,
        id: "cbundle_old",
        version: 1,
      },
    }
    harness.setProfiles([{ ...input.profile, id: "cbundle_new", version: 2 }])
    harness.setComponents([
      {
        ...input.components[0],
        bundle_profile_id: "cbundle_new",
        id: "cbcomp_new",
      },
    ])
    harness.setOperations([
      catalogOperationFixture({
        aggregate_id: input.aggregateId,
        command: input.command,
        id: "catop_1",
      }),
    ])

    await expect(
      harness.service.compensateBundleMutation(
        {
          aggregateId: "prod_1",
          operationId: "catop_1",
          previous,
        },
        sharedContext
      )
    ).resolves.toBeUndefined()
    expect(harness.profiles()).toEqual([previous.profile])
    expect(harness.components()).toEqual(previous.components)
    expect(harness.operations()).toEqual([
      expect.objectContaining({ status: "compensated" }),
    ])

    harness.setOperations([
      catalogOperationFixture({
        aggregate_id: input.aggregateId,
        command: input.command,
        id: "catop_1",
        result: {
          deleted: false,
          productId: "prod_1",
          profileId: "cbundle_old",
          version: 1,
        },
        status: "succeeded",
      }),
    ])
    await expect(
      harness.service.compensateBundleMutation(
        {
          aggregateId: "prod_1",
          operationId: "catop_1",
          previous,
        },
        sharedContext
      )
    ).rejects.toThrow("compensation operation could not be verified")
  })

  it("verifies exact inventory replacement and operation completion", async () => {
    const harness = serviceHarness()
    const links: CatalogBundleInventoryLinkState[] = [
      {
        bundle_profile_id: "cbundle_1",
        bundle_variant_id: "variant_bundle_1",
        inventory_item_id: "iitem_1",
        metadata: {},
        required_quantity: 2,
      },
    ]
    await expect(
      harness.service.replaceBundleInventoryLinks(
        "cbundle_1",
        links,
        sharedContext
      )
    ).resolves.toBeUndefined()
    expect(harness.inventoryLinks()).toEqual([
      expect.objectContaining({ id: "cbilink_1", required_quantity: 2 }),
    ])

    const input = inputFixture()
    harness.setOperations([
      catalogOperationFixture({
        aggregate_id: input.aggregateId,
        command: input.command,
        id: "catop_1",
      }),
    ])
    const result = {
      deleted: false,
      productId: "prod_1",
      profileId: "cbundle_1",
      version: 1,
    }
    await expect(
      harness.service.completeCatalogAuthoringOperation(
        "catop_1",
        result,
        sharedContext
      )
    ).resolves.toEqual([
      expect.objectContaining({ result, status: "succeeded" }),
    ])
    await expect(
      harness.service.completeCatalogAuthoringOperation(
        "catop_1",
        result,
        sharedContext
      )
    ).rejects.toThrow("completion could not be verified")
  })
})
