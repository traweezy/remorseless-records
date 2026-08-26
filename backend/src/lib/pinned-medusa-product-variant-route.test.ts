import path from "node:path";

import { MedusaError } from "@medusajs/framework/utils";

const refetchEntityMock = jest.fn();
const runWorkflowMock = jest.fn();
const updateProductVariantsWorkflowMock = jest.fn(() => ({
  run: runWorkflowMock,
}));
const remapKeysForProductMock = jest.fn(() => ["id", "variants.id"]);
const remapProductResponseMock = jest.fn(() => ({ id: "serialized_product" }));

type NativeVariantPost = (
  req: {
    params: { id: string; variant_id: string };
    queryConfig: { fields?: string[] };
    scope: object;
    validatedBody: Record<string, unknown>;
  },
  res: {
    json: jest.Mock;
    status: jest.Mock;
  },
) => Promise<void>;

const medusaEntry = require.resolve("@medusajs/medusa");
const medusaDirectory = path.dirname(medusaEntry);
const helpersPath = path.join(
  medusaDirectory,
  "api/admin/products/helpers.js",
);
const variantRoutePath = path.join(
  medusaDirectory,
  "api/admin/products/[id]/variants/[variant_id]/route.js",
);

const loadVariantPost = (): NativeVariantPost => {
  jest.resetModules();
  jest.doMock("@medusajs/core-flows", () => ({
    updateProductVariantsWorkflow: updateProductVariantsWorkflowMock,
  }));
  jest.doMock("@medusajs/framework/http", () => ({
    refetchEntity: refetchEntityMock,
  }));
  jest.doMock(helpersPath, () => ({
    remapKeysForProduct: remapKeysForProductMock,
    remapProductResponse: remapProductResponseMock,
  }));

  return jest.requireActual<{ POST: NativeVariantPost }>(variantRoutePath).POST;
};

const createRequest = () => ({
  params: {
    id: "prod_01",
    variant_id: "variant_01",
  },
  queryConfig: {
    fields: ["id", "variants.id"],
  },
  scope: {},
  validatedBody: {
    additional_data: { source: "test" },
    title: "Updated title",
  },
});

const createResponse = () => {
  const response = {
    json: jest.fn(),
    status: jest.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
};

describe("pinned Medusa Product Variant update route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects a missing Product and Variant pair before the workflow", async () => {
    refetchEntityMock.mockResolvedValueOnce(undefined);
    const post = loadVariantPost();
    const request = createRequest();
    const response = createResponse();

    await expect(post(request, response)).rejects.toMatchObject({
      message:
        'Product variant with id "variant_01" not found for product with id "prod_01"',
      type: MedusaError.Types.NOT_FOUND,
    });

    expect(refetchEntityMock).toHaveBeenCalledWith({
      entity: "variant",
      fields: ["id"],
      idOrFilter: {
        id: "variant_01",
        product_id: "prod_01",
      },
      scope: request.scope,
    });
    expect(updateProductVariantsWorkflowMock).not.toHaveBeenCalled();
    expect(response.status).not.toHaveBeenCalled();
  });

  it("rejects when a concurrent change leaves no affected Variant", async () => {
    refetchEntityMock.mockResolvedValueOnce({ id: "variant_01" });
    runWorkflowMock.mockResolvedValueOnce({ result: [] });
    const post = loadVariantPost();
    const request = createRequest();
    const response = createResponse();

    await expect(post(request, response)).rejects.toMatchObject({
      type: MedusaError.Types.NOT_FOUND,
    });

    expect(runWorkflowMock).toHaveBeenCalledWith({
      input: {
        additional_data: { source: "test" },
        selector: {
          id: "variant_01",
          product_id: "prod_01",
        },
        update: { title: "Updated title" },
      },
    });
    expect(refetchEntityMock).toHaveBeenCalledTimes(1);
    expect(response.status).not.toHaveBeenCalled();
  });

  it("returns not found when the parent Product disappears", async () => {
    refetchEntityMock
      .mockResolvedValueOnce({ id: "variant_01" })
      .mockResolvedValueOnce(undefined);
    runWorkflowMock.mockResolvedValueOnce({ result: [{ id: "variant_01" }] });
    const post = loadVariantPost();
    const request = createRequest();
    const response = createResponse();

    await expect(post(request, response)).rejects.toMatchObject({
      message: 'Product with id "prod_01" not found',
      type: MedusaError.Types.NOT_FOUND,
    });

    expect(response.status).not.toHaveBeenCalled();
  });

  it("preserves the successful native response contract", async () => {
    const product = { id: "prod_01", variants: [{ id: "variant_01" }] };
    refetchEntityMock
      .mockResolvedValueOnce({ id: "variant_01" })
      .mockResolvedValueOnce(product);
    runWorkflowMock.mockResolvedValueOnce({ result: [{ id: "variant_01" }] });
    const post = loadVariantPost();
    const request = createRequest();
    const response = createResponse();

    await post(request, response);

    expect(refetchEntityMock).toHaveBeenNthCalledWith(2, {
      entity: "product",
      fields: ["id", "variants.id"],
      idOrFilter: "prod_01",
      scope: request.scope,
    });
    expect(remapProductResponseMock).toHaveBeenCalledWith(product);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      product: { id: "serialized_product" },
    });
  });
});
