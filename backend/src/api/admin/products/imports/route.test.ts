import { MedusaError } from "@medusajs/framework/utils";

import { reuseResolvedProductOptions } from "./route";

describe("product import option reuse", () => {
  it("reuses the oldest matching option instead of creating a duplicate", () => {
    const product = {
      id: "prod_1",
      handle: "music-release-artist-album",
      options: [{ title: "Format", values: ["CD", "Vinyl"] }],
    };

    reuseResolvedProductOptions(product, [
      {
        id: "opt_newer",
        title: "Format",
        values: ["CD", "Vinyl"],
        createdAt: "2026-07-19T16:34:00.000Z",
      },
      {
        id: "opt_original",
        title: "Format",
        values: ["Vinyl", "CD"],
        createdAt: "2026-07-19T16:33:00.000Z",
      },
    ]);

    expect(product).toEqual({
      id: "prod_1",
      handle: "music-release-artist-album",
      option_ids: ["opt_original"],
    });
  });

  it("rejects new values that are absent from the existing option", () => {
    const product = {
      id: "prod_1",
      handle: "music-release-artist-album",
      options: [{ title: "Format", values: ["Cassette"] }],
    };

    expect(() =>
      reuseResolvedProductOptions(product, [
        {
          id: "opt_format",
          title: "Format",
          values: ["CD"],
          createdAt: "2026-07-19T16:33:00.000Z",
        },
      ])
    ).toThrow(MedusaError);
    expect(product.options).toBeDefined();
  });
});
