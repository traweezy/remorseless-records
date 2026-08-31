import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"

import { loadBundleComponents } from "./helpers"
import { GET } from "./route"

jest.mock("./helpers", () => {
  const actual = jest.requireActual("./helpers") as Record<string, unknown>
  return {
    ...actual,
    loadBundleComponents: jest.fn(async () => []),
  }
})

const loadComponentsMock = loadBundleComponents as jest.MockedFunction<
  typeof loadBundleComponents
>

const bundle = (overrides: Record<string, unknown> = {}) => ({
  bundle_type: "fixed",
  created_at: "2026-08-30T00:00:00.000Z",
  description_html: null,
  display_title: "Starter set",
  fulfillment_mode: "ship_components",
  id: "cbundle_1",
  inventory_mode: "component_derived",
  is_active: true,
  metadata: {},
  product_id: "prod_1",
  product_profile_id: "cprof_1",
  updated_at: "2026-08-30T00:00:00.000Z",
  version: 1,
  ...overrides,
})

type ResponseState = { body: unknown; status: number }

const responseFixture = (): { res: MedusaResponse; state: ResponseState } => {
  const state: ResponseState = { body: null, status: 200 }
  const response = {} as MedusaResponse
  response.status = jest.fn((status: number) => {
    state.status = status
    return response
  }) as MedusaResponse["status"]
  response.json = jest.fn((body: unknown) => {
    state.body = body
    return response
  }) as MedusaResponse["json"]
  return { res: response, state }
}

const requestFixture = (
  page: unknown,
  query: Record<string, unknown> = {}
): MedusaRequest =>
  ({
    query,
    scope: {
      resolve: jest.fn(() => ({
        listAndCountCatalogBundleProfiles: jest.fn().mockResolvedValue(page),
      })),
    },
  }) as unknown as MedusaRequest

describe("catalog bundle collection route", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("returns a validated counted page and bounded component reads", async () => {
    const { res, state } = responseFixture()

    await GET(
      requestFixture([[bundle()], 1], {
        limit: "25",
        productId: "prod_1",
      }),
      res
    )

    expect(loadComponentsMock).toHaveBeenCalledWith(
      expect.any(Object),
      "cbundle_1"
    )
    expect(state).toEqual({
      body: {
        bundles: [
          {
            bundle: expect.objectContaining({
              id: "cbundle_1",
              productId: "prod_1",
              version: 1,
            }),
            components: [],
          },
        ],
        count: 1,
        limit: 25,
        offset: 0,
      },
      status: 200,
    })
  })

  it.each([
    [[bundle()], 0],
    [[bundle({ product_id: "prod_other" })], 1],
    [[bundle(), bundle()], 2],
    [[bundle({ inventory_mode: "invented" })], 1],
  ])("rejects malformed or cross-owned pages %#", async (page) => {
    await expect(
      GET(requestFixture(page, { productId: "prod_1" }), {} as MedusaResponse)
    ).rejects.toThrow("transaction persistence boundary")
    expect(loadComponentsMock).not.toHaveBeenCalled()
  })
})
