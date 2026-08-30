import providerExport from "../index";
import configureTaxCaches from "./cache-config";

describe("tax cache provider loader registration", () => {
  it("registers startup cache validation with the provider", () => {
    expect(providerExport.loaders).toContain(configureTaxCaches);
  });
});
