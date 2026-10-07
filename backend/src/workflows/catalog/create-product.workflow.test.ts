import {
  WorkflowManager,
  type WorkflowStepHandler,
} from "@medusajs/framework/orchestration"
import {
  Modules,
  OrchestrationUtils,
  TransactionState,
  createMedusaContainer,
} from "@medusajs/framework/utils"
import { StepResponse } from "@medusajs/framework/workflows-sdk"
import { asValue } from "@medusajs/framework/awilix"

import { catalogProductCreateSchema } from "@/lib/catalog/product-create-contract"
import { createCatalogProductWorkflow } from "./create-product"

type WorkflowBoundary = {
  action: string
  reversible: boolean
}

type WorkflowNode = {
  action: string
  next?: WorkflowNode
  noCompensation?: boolean
}

type WorkflowHandler = {
  compensate?: WorkflowStepHandler
  invoke: WorkflowStepHandler
}

type WorkflowDefinition = {
  flow_: WorkflowNode
  handlers_: Map<string, WorkflowHandler>
}

const workflowRegistry = WorkflowManager as unknown as {
  getWorkflow: (name: string) => unknown
}

const expectedBoundaries: WorkflowBoundary[] = [
  { action: "acquire-lock-step", reversible: true },
  { action: "begin-catalog-product-creation", reversible: true },
  { action: "resolve-catalog-product-create-context", reversible: false },
  { action: "create-products-as-step", reversible: true },
  { action: "resolve-catalog-created-product", reversible: false },
  { action: "resolve-created-catalog-media-lease", reversible: false },
  { action: "acquire-created-catalog-media-lease", reversible: true },
  { action: "mutate-catalog-product-profile-as-step", reversible: true },
  {
    action: "mutate-catalog-product-variant-profiles-as-step",
    reversible: true,
  },
  { action: "mutate-catalog-product-media-as-step", reversible: true },
  { action: "mutate-catalog-bundle-as-step", reversible: true },
  { action: "resolve-catalog-product-inventory-levels", reversible: false },
  { action: "create-inventory-levels-workflow-as-step", reversible: true },
  { action: "update-product-variants-as-step", reversible: true },
  { action: "release-lock-step", reversible: false },
  { action: "complete-catalog-product-creation", reversible: false },
]

const commandFixture = () => ({
  ...catalogProductCreateSchema.parse({
    idempotencyKey: "00000000-0000-4000-8000-000000000001",
    kind: "music_release",
    options: [{ title: "Format", values: ["LP"] }],
    profile: { artists: [{ name: "Test Artist", role: "primary" }] },
    title: "Workflow Contract Test",
    variants: [
      {
        key: "lp",
        options: { Format: "LP" },
        prices: [{ amount: 20, currencyCode: "usd" }],
        profile: { format: { label: "LP" } },
        sku: "WORKFLOW-LP",
        stockQuantity: 5,
        title: "LP",
      },
    ],
  }),
  actorId: "user_workflow_contract",
  requestSha256: "workflow_contract_hash",
})

const getWorkflow = (): WorkflowDefinition => {
  const workflow = workflowRegistry.getWorkflow("create-catalog-product")
  if (!workflow || typeof workflow !== "object") {
    throw new Error("The catalog product creation workflow is not registered.")
  }
  const definition = workflow as Partial<WorkflowDefinition>
  if (!definition.flow_ || !(definition.handlers_ instanceof Map)) {
    throw new Error("The catalog product creation workflow is malformed.")
  }
  return definition as WorkflowDefinition
}

const readBoundaries = (): WorkflowBoundary[] => {
  const boundaries: WorkflowBoundary[] = []
  let node = getWorkflow().flow_ as WorkflowNode | undefined

  while (node) {
    boundaries.push({
      action: node.action,
      reversible: node.noCompensation !== true,
    })
    node = node.next
  }

  return boundaries
}

const workflowData = (output: unknown) => ({
  __type: OrchestrationUtils.SymbolWorkflowWorkflowData,
  output: new StepResponse(output, output).toJSON(),
})

const installStepDoubles = (failAt: string | null, compensated: string[]) => {
  const handlers = getWorkflow().handlers_

  for (const boundary of expectedBoundaries) {
    const invoke: WorkflowStepHandler = async () => {
      if (boundary.action === failAt) {
        throw new Error(`Injected failure at ${boundary.action}`)
      }
      return workflowData({ boundary: boundary.action })
    }
    const compensate: WorkflowStepHandler = async () => {
      compensated.push(boundary.action)
      return { output: undefined }
    }

    handlers.set(boundary.action, { compensate, invoke })
  }
}

const expectedCompensationsThrough = (failedAction: string) => {
  const failureIndex = expectedBoundaries.findIndex(
    ({ action }) => action === failedAction
  )

  return expectedBoundaries
    .slice(0, failureIndex + 1)
    .filter(({ reversible }) => reversible)
    .map(({ action }) => action)
    .reverse()
}

const errorMessage = (error: unknown) => {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message
  }
  return String(error)
}

describe("catalog product creation workflow contract", () => {
  const workflow = getWorkflow()
  let originalHandlers: Map<string, WorkflowHandler>

  beforeEach(() => {
    originalHandlers = new Map(workflow.handlers_)
  })

  afterEach(() => {
    workflow.handlers_.clear()
    for (const [action, handler] of originalHandlers) {
      workflow.handlers_.set(action, handler)
    }
  })

  it("keeps every external boundary and compensation owner explicit", () => {
    expect(readBoundaries()).toEqual(expectedBoundaries)
    expect(Array.from(workflow.handlers_.keys())).toEqual(
      expectedBoundaries.map(({ action }) => action)
    )
  })

  it("completes through the real workflow engine without compensating", async () => {
    const compensated: string[] = []
    installStepDoubles(null, compensated)

    const { errors, result } = await createCatalogProductWorkflow.run({
      container: createMedusaContainer(),
      input: commandFixture(),
    })

    expect(errors).toEqual([])
    expect(result).toEqual({
      boundary: "complete-catalog-product-creation",
    })
    expect(compensated).toEqual([])
  })

  it("releases the renamed native media lease using its own saved UUID after late creation failure", async () => {
    const action = "acquire-created-catalog-media-lease"
    const native = workflow.handlers_.get(action)!
    const lease = {
      keys: ["catalog:product-media:prod_1", "catalog:media-asset:cmedia_1"],
      ownerId: "00000000-0000-4000-8000-000000000003",
    }
    const locking = { acquire: jest.fn(), release: jest.fn() }
    const container = createMedusaContainer()
    container.register(Modules.LOCKING, asValue(locking))
    installStepDoubles("complete-catalog-product-creation", [])
    workflow.handlers_.set(action, native)
    workflow.handlers_.set("resolve-created-catalog-media-lease", {
      invoke: async () => workflowData(lease),
    })
    const execution = await createCatalogProductWorkflow.run({
      container,
      input: commandFixture(),
      throwOnError: false,
    })
    expect(execution.transaction.getState()).toBe(TransactionState.REVERTED)
    expect(locking.acquire).toHaveBeenCalledWith(lease.keys, {
      expire: 120,
      ownerId: lease.ownerId,
      provider: undefined,
    })
    expect(locking.release).toHaveBeenCalledTimes(1)
    expect(locking.release).toHaveBeenCalledWith(lease.keys, {
      ownerId: lease.ownerId,
      provider: undefined,
    })
  })

  it.each(expectedBoundaries.map(({ action }) => action))(
    "reverses completed writes when %s fails",
    async (failedAction) => {
      const compensated: string[] = []
      installStepDoubles(failedAction, compensated)

      const execution = await createCatalogProductWorkflow.run({
        container: createMedusaContainer(),
        input: commandFixture(),
        throwOnError: false,
      })

      expect(
        execution.errors.map(({ error }) => errorMessage(error))
      ).toContain(`Injected failure at ${failedAction}`)
      expect(compensated).toEqual(expectedCompensationsThrough(failedAction))
    }
  )
})
