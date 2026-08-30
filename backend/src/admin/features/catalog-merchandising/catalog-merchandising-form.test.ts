import {
  catalogShelfCreateValidationIssues,
  catalogShelfFingerprint,
  catalogShelfValidationIssues,
} from "./catalog-merchandising-form";
import type {
  CreateShelfState,
  ShelfFormState,
} from "./catalog-merchandising-types";

const shelf = (): ShelfFormState => ({
  automationType: "none",
  description: "A customer-facing collection.",
  endsAt: "",
  handle: "new-releases",
  isActive: true,
  mode: "manual",
  productLimit: "12",
  products: [
    {
      endsAt: "",
      isPinned: false,
      key: "line-1",
      productId: "prod_1",
      sortOrder: "0",
      startsAt: "",
    },
  ],
  ribbonLabel: "",
  ribbonPriority: "100",
  showRibbon: false,
  startsAt: "",
  title: "New Releases",
  version: 4,
});

describe("Catalog merchandising form", () => {
  it("accepts an ordinary manual shelf", () => {
    expect(catalogShelfValidationIssues(shelf())).toEqual([]);
  });

  it("maps customer-facing validation problems to focus targets", () => {
    const value = shelf();
    value.title = "";
    value.handle = "Not Valid";
    value.showRibbon = true;
    value.products.push({ ...value.products[0]!, key: "line-2" });
    expect(catalogShelfValidationIssues(value)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetId: "shelf-title" }),
        expect.objectContaining({ targetId: "shelf-handle" }),
        expect.objectContaining({ targetId: "shelf-ribbon-label" }),
        expect.objectContaining({ targetId: "shelf-products" }),
      ]),
    );
  });

  it("requires safe automatic and scheduling settings", () => {
    const value = shelf();
    value.mode = "automatic";
    value.startsAt = "2030-01-02T00:00";
    value.endsAt = "2030-01-01T00:00";
    expect(catalogShelfValidationIssues(value).map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        "Choose an automation rule for an automatic shelf.",
        "Shelf end time must be later than its start time.",
      ]),
    );
  });

  it("validates create values and ignores transport fields in fingerprints", () => {
    const create: CreateShelfState = {
      automationType: "none",
      handle: "",
      mode: "manual",
      productLimit: "0",
      ribbonLabel: "",
      ribbonPriority: "-1",
      showRibbon: false,
      title: "",
    };
    expect(catalogShelfCreateValidationIssues(create)).toHaveLength(4);

    const before = shelf();
    const after = shelf();
    after.version = 10;
    after.products[0]!.key = "different-render-key";
    expect(catalogShelfFingerprint(after)).toBe(catalogShelfFingerprint(before));
    after.title = "Changed";
    expect(catalogShelfFingerprint(after)).not.toBe(
      catalogShelfFingerprint(before),
    );
  });
});
