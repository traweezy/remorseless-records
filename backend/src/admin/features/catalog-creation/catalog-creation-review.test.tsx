import { renderToStaticMarkup } from "react-dom/server"

import { resolveCatalogCreationAvailability } from "./catalog-creation-availability"
import {
  CatalogCreationReview,
  resolveCatalogCreationReadiness,
} from "./catalog-creation-review"
import { CatalogCreationValidationSummary } from "./catalog-creation-validation-summary"
import { resolveCatalogCreationValidationIssues } from "./catalog-creation-validation"
import {
  createCatalogCreationDefaults,
  type CatalogCreationFormValues,
} from "./catalog-product-create-form"

const completeMusicDraft = (): CatalogCreationFormValues => {
  const values = createCatalogCreationDefaults()
  values.title = "A New Record"
  values.artistName = "The Artist"
  values.description = "A customer-facing description."
  values.tracklist = "First song\nSecond song"
  values.media = [
    {
      altText: "Red album cover with a black band logo",
      byteSize: 1_024,
      id: "media_1",
      mediaAssetId: "asset_1",
      mimeType: "image/jpeg",
      originalFilename: "cover.jpg",
      sourceFileKey: "uploads/cover.jpg",
      sourceUrl: "https://cdn.example.com/cover.jpg",
    },
  ]
  values.offerings[0] = {
    ...values.offerings[0]!,
    priceUsd: "20.00",
    sku: "RECORD-RED-LP",
    stockQuantity: "4",
    title: "Red LP",
  }
  return values
}

describe("catalog creation review", () => {
  it("links schema issues to the owning step and exact control", () => {
    const values = createCatalogCreationDefaults()
    const issues = resolveCatalogCreationValidationIssues(values)

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Enter a product name.",
          step: 1,
          targetId: "catalog-create-title",
        }),
        expect.objectContaining({
          message: "Choose or enter the primary artist.",
          step: 1,
          targetId: "catalog-create-artist",
        }),
      ]),
    )

    const markup = renderToStaticMarkup(
      <CatalogCreationValidationSummary
        issues={issues}
        onNavigate={jest.fn()}
      />,
    )
    expect(markup).toContain("Review these details")
    expect(markup).toContain("Step 2: Enter a product name.")
    expect(markup).toContain("data-issue-key=")
  })

  it("targets dynamic offering, component, and media controls", () => {
    const values = completeMusicDraft()
    const duplicate = {
      ...values.offerings[0]!,
      id: "offering_2",
      title: "Second LP",
    }
    values.offerings.push(duplicate)
    values.media[0]!.altText = ""

    const issues = resolveCatalogCreationValidationIssues(values)
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Each offering combination must be unique.",
          targetId: "offering-offering_2-format",
        }),
        expect.objectContaining({
          message: "Describe every image for customers who cannot see it.",
          targetId: "catalog-create-media-alt-media_1",
        }),
      ]),
    )

    const bundle = createCatalogCreationDefaults("fixed_bundle")
    bundle.title = "Bundle"
    expect(resolveCatalogCreationValidationIssues(bundle)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "Add at least one included product.",
          targetId: "catalog-create-add-bundle-component",
        }),
      ]),
    )
  })

  it("separates safe draft validity from publication recommendations", () => {
    const values = createCatalogCreationDefaults()
    values.title = "Draft release"
    values.artistName = "The Artist"
    values.offerings[0] = {
      ...values.offerings[0]!,
      priceUsd: "20.00",
      sku: "DRAFT-RELEASE-CD",
    }

    expect(resolveCatalogCreationReadiness(values)).toMatchObject({
      draftReady: true,
      publishReady: false,
    })

    const complete = completeMusicDraft()
    expect(resolveCatalogCreationReadiness(complete)).toMatchObject({
      draftIssueCount: 0,
      draftReady: true,
      publishReady: true,
    })

    complete.offerings[0]!.stockQuantity = "0"
    expect(resolveCatalogCreationReadiness(complete).publishReady).toBe(true)
  })

  it("renders distinct card and detail previews without purchase controls", () => {
    const values = completeMusicDraft()
    const offering = values.offerings[0]!
    const availability = resolveCatalogCreationAvailability({
      bundleComponents: [],
      choices: [],
      kind: values.kind,
      offering,
      releaseDate: values.releaseDate,
      releaseDatePrecision: values.releaseDatePrecision,
    })
    const markup = renderToStaticMarkup(
      <CatalogCreationReview
        availabilityByOfferingId={new Map([[offering.id, availability]])}
        values={values}
      />,
    )

    expect(markup).toContain("Ready to create a draft")
    expect(markup).toContain("Customer content is publication-ready")
    expect(markup).toContain("Catalog card")
    expect(markup).toContain("Product detail")
    expect(markup).toContain("Non-interactive storefront card preview")
    expect(markup).not.toContain("Add to cart")
  })
})
