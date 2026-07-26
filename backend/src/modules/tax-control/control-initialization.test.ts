import { MedusaError } from "@medusajs/framework/utils";

import { ensureTaxProviderControlSingleton } from "./control-initialization";

describe("tax provider control initialization", () => {
  it("returns the existing singleton without writing", async () => {
    const control = { active_provider: "taxrate_io", generation: 4 };
    const create = jest.fn();
    const retrieve = jest.fn(async () => control);

    await expect(
      ensureTaxProviderControlSingleton({ create, retrieve }),
    ).resolves.toBe(control);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates the singleton only after a genuine not-found", async () => {
    const control = { active_provider: "taxrate_io", generation: 1 };
    const create = jest.fn(async () => control);
    const retrieve = jest.fn(async () => {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "missing");
    });

    await expect(
      ensureTaxProviderControlSingleton({ create, retrieve }),
    ).resolves.toBe(control);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("re-reads the winner when another request creates it first", async () => {
    const control = { active_provider: "taxrate_io", generation: 1 };
    const create = jest.fn(async () => {
      throw new MedusaError(MedusaError.Types.DUPLICATE_ERROR, "duplicate");
    });
    const retrieve = jest
      .fn()
      .mockRejectedValueOnce(
        new MedusaError(MedusaError.Types.NOT_FOUND, "missing"),
      )
      .mockResolvedValueOnce(control);

    await expect(
      ensureTaxProviderControlSingleton({ create, retrieve }),
    ).resolves.toBe(control);
    expect(retrieve).toHaveBeenCalledTimes(2);
  });

  it("does not rewrite operational retrieval failures as initialization", async () => {
    const failure = new MedusaError(
      MedusaError.Types.DB_ERROR,
      "database unavailable",
    );
    const create = jest.fn();
    const retrieve = jest.fn(async () => {
      throw failure;
    });

    await expect(
      ensureTaxProviderControlSingleton({ create, retrieve }),
    ).rejects.toBe(failure);
    expect(create).not.toHaveBeenCalled();
  });
});
