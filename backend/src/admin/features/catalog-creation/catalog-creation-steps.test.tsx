import { renderToStaticMarkup } from "react-dom/server"

import { resolveCatalogCreationAvailability } from "./catalog-creation-availability"
import { CatalogCreationBasicsStep } from "./catalog-creation-basics-step"
import { CatalogCreationDetailsStep } from "./catalog-creation-details-step"
import { CatalogCreationKindStep } from "./catalog-creation-kind-step"
import { CatalogCreationOfferingsStep } from "./catalog-creation-offerings-step"
import { CatalogCreationReviewStep } from "./catalog-creation-review-step"
import {
  CatalogCreationActions,
  CatalogCreationProgress,
} from "./catalog-creation-wizard-shell"
import {
  createCatalogCreationDefaults,
  type CatalogCreationFormValues,
  type CatalogCreationKind,
} from "./catalog-product-create-form"
import type { CatalogCreationProductChoiceWithStock } from "./catalog-product-create-query"

const handlers = {
  onArtistChange: jest.fn(),
  onGenreChange: jest.fn(),
  onLabelChange: jest.fn(),
  onMediaChange: jest.fn(),
  onMerchandiseTypeChange: jest.fn(),
  onProductTypeChange: jest.fn(),
  onReleaseDatePrecisionChange: jest.fn(),
  onTextChange: jest.fn(),
  onUploadingChange: jest.fn(),
  onVocabularyRetry: jest.fn(),
}

const renderBasics = (kind: CatalogCreationKind): string =>
  renderToStaticMarkup(
    <CatalogCreationBasicsStep
      artistOptions={[]}
      onArtistChange={handlers.onArtistChange}
      onGenreChange={handlers.onGenreChange}
      onLabelChange={handlers.onLabelChange}
      onMerchandiseTypeChange={handlers.onMerchandiseTypeChange}
      onProductTypeChange={handlers.onProductTypeChange}
      onReleaseDatePrecisionChange={handlers.onReleaseDatePrecisionChange}
      onTextChange={handlers.onTextChange}
      onVocabularyRetry={handlers.onVocabularyRetry}
      referenceOptions={{
        format: [],
        formatDetail: [],
        genre: [],
        label: [],
        merchType: [],
        productType: [],
      }}
      values={createCatalogCreationDefaults(kind)}
      vocabularyLoading={false}
      vocabularyUnavailable={false}
    />
  )

const renderDetails = (kind: CatalogCreationKind): string =>
  renderToStaticMarkup(
    <CatalogCreationDetailsStep
      onMediaChange={handlers.onMediaChange}
      onTextChange={handlers.onTextChange}
      onUploadingChange={handlers.onUploadingChange}
      values={createCatalogCreationDefaults(kind)}
    />
  )

const availabilityMap = (
  values: CatalogCreationFormValues,
  choices: CatalogCreationProductChoiceWithStock[] = []
) =>
  new Map(
    values.offerings.map((offering) => [
      offering.id,
      resolveCatalogCreationAvailability({
        bundleComponents: values.bundleComponents,
        choices,
        kind: values.kind,
        offering,
        releaseDate: values.releaseDate,
        releaseDatePrecision: values.releaseDatePrecision,
      }),
    ])
  )

const offeringsHandlers = {
  onAddBundleComponent: jest.fn(),
  onAddOffering: jest.fn(),
  onApplyMerchandiseTemplate: jest.fn(),
  onApplyMusicReleaseTemplate: jest.fn(),
  onChoicesRetry: jest.fn(),
  onFillMissingSkus: jest.fn(),
  onRemoveBundleComponent: jest.fn(),
  onRemoveOffering: jest.fn(),
  onUpdateBundleComponent: jest.fn(),
  onUpdateBundleMapping: jest.fn(),
  onUpdateOffering: jest.fn(),
}

describe("catalog creation step components", () => {
  it("renders every product kind and marks the selected kind", () => {
    const markup = renderToStaticMarkup(
      <CatalogCreationKindStep kind="fixed_bundle" onSelect={jest.fn()} />
    )

    expect(markup).toContain("Music release")
    expect(markup).toContain("Merchandise")
    expect(markup).toContain("Fixed bundle")
    expect(markup).toContain("Mystery box")
    expect(markup).toContain('data-kind="fixed_bundle"')
    expect(markup).toContain('aria-pressed="true"')
  })

  it("keeps basics fields specific to music, merchandise, and bundles", () => {
    const music = renderBasics("music_release")
    expect(music).toContain("Release title")
    expect(music).toContain("Primary artist")
    expect(music).toContain("Release date detail")
    expect(music).toContain("Catalog number")
    expect(music).not.toContain("Merchandise type")

    const merchandise = renderBasics("merch")
    expect(merchandise).toContain("Product name")
    expect(merchandise).toContain("Merchandise type")
    expect(merchandise).not.toContain("Primary artist")
    expect(merchandise).not.toContain("Catalog number")

    const fixedBundle = renderBasics("fixed_bundle")
    const mysteryBundle = renderBasics("mystery_bundle")
    expect(fixedBundle).not.toContain("Primary artist")
    expect(mysteryBundle).not.toContain("Merchandise type")
  })

  it("keeps details fields specific to all four product kinds", () => {
    const music = renderDetails("music_release")
    expect(music).toContain("Tracklist")
    expect(music).toContain("Credits")

    const merchandise = renderDetails("merch")
    expect(merchandise).toContain("Material")
    expect(merchandise).toContain("Fit and measurements")
    expect(merchandise).toContain("Size guide")
    expect(merchandise).toContain("Care instructions")

    const fixedBundle = renderDetails("fixed_bundle")
    expect(fixedBundle).toContain("Included-content presentation")

    const mysteryBundle = renderDetails("mystery_bundle")
    expect(mysteryBundle).toContain("Customer promise")
    expect(mysteryBundle).toContain("Mystery box disclaimer")

    ;[music, merchandise, fixedBundle, mysteryBundle].forEach((markup) => {
      expect(markup).toContain("Product images")
    })
  })

  it("renders merchandise accelerators and fixed-bundle mappings", () => {
    const merchandise = createCatalogCreationDefaults("merch")
    const merchandiseMarkup = renderToStaticMarkup(
      <CatalogCreationOfferingsStep
        {...offeringsHandlers}
        availabilityByOfferingId={availabilityMap(merchandise)}
        choicesData={undefined}
        choicesError={null}
        choicesFetching={false}
        choicesIsError={false}
        choicesPending={false}
        formatDetailOptions={[]}
        formatOptions={[]}
        values={merchandise}
      />
    )
    expect(merchandiseMarkup).toContain("Start from a merchandise template")
    expect(merchandiseMarkup).toContain("Size or style")
    expect(merchandiseMarkup).not.toContain("Accept preorders")

    const choices: CatalogCreationProductChoiceWithStock[] = [
      {
        id: "product_1",
        title: "Existing release",
        variants: [
          {
            id: "variant_1",
            inventoryQuantity: 4,
            managesInventory: true,
            sku: "CD-1",
            title: "CD",
          },
        ],
      },
    ]
    const bundle = createCatalogCreationDefaults("fixed_bundle")
    bundle.bundleComponents = [
      {
        id: "component_1",
        offeringIds: [bundle.offerings[0]!.id],
        productId: "product_1",
        quantity: "1",
        variantId: "variant_1",
      },
    ]
    const bundleMarkup = renderToStaticMarkup(
      <CatalogCreationOfferingsStep
        {...offeringsHandlers}
        availabilityByOfferingId={availabilityMap(bundle, choices)}
        choicesData={choices}
        choicesError={null}
        choicesFetching={false}
        choicesIsError={false}
        choicesPending={false}
        formatDetailOptions={[]}
        formatOptions={[]}
        values={bundle}
      />
    )
    expect(bundleMarkup).toContain("Component-derived stock")
    expect(bundleMarkup).toContain("Included product 1")
    expect(bundleMarkup).toContain("Existing release")
    expect(bundleMarkup).toContain("CD · CD-1")
    expect(bundleMarkup).toContain("Used by bundle formats")
  })

  it("renders catalog-derived release accelerators and controlled choices", () => {
    const release = createCatalogCreationDefaults("music_release")
    const markup = renderToStaticMarkup(
      <CatalogCreationOfferingsStep
        {...offeringsHandlers}
        availabilityByOfferingId={availabilityMap(release)}
        choicesData={undefined}
        choicesError={null}
        choicesFetching={false}
        choicesIsError={false}
        choicesPending={false}
        formatDetailOptions={[{ id: "detail_black", label: "Black Shell" }]}
        formatOptions={[{ id: "format_cd", label: "CD" }]}
        values={release}
      />
    )

    expect(markup).toContain("Start from a catalog format set")
    expect(markup).toContain("Cassette + CD + Vinyl")
    expect(markup).toContain("Fill missing SKUs")
    expect(markup).toContain('value="CD"')
    expect(markup).toContain('value="Black Shell"')
    expect(markup).toContain("Zero-dollar products are blocked")
    expect(markup).toContain('role="group"')
    expect(markup).toContain("Customer availability after publish")
  })

  it("keeps review navigation, progress, and final actions explicit", () => {
    const values = createCatalogCreationDefaults("music_release")
    values.title = "Review me"
    values.artistName = "Artist"
    const review = renderToStaticMarkup(
      <CatalogCreationReviewStep
        availabilityByOfferingId={availabilityMap(values)}
        onChangeStep={jest.fn()}
        values={values}
      />
    )
    expect(review).toContain("Review draft")
    expect(review).toContain("Change basics")
    expect(review).toContain("Change offerings")
    expect(review).toContain("Customer preview")

    const progress = renderToStaticMarkup(
      <CatalogCreationProgress current={4} />
    )
    expect(progress).toContain('aria-current="step"')
    expect(progress).toContain("5. Review")

    const actions = renderToStaticMarkup(
      <CatalogCreationActions
        busy={false}
        currentStep={4}
        onBack={jest.fn()}
        onCancel={jest.fn()}
        onNext={jest.fn()}
        onSave={jest.fn()}
        saveState="saved"
      />
    )
    expect(actions).toContain("Cancel")
    expect(actions).toContain("Back")
    expect(actions).toContain("Create draft")
    expect(actions).toContain("Draft saved in this browser")
    expect(actions).not.toContain("Continue")
  })
})
