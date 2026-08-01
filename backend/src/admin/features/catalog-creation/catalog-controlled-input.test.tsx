import { renderToStaticMarkup } from "react-dom/server"

import { CatalogControlledInput } from "./catalog-controlled-input"

describe("CatalogControlledInput", () => {
  it("connects choices and selection status to the named input", () => {
    const markup = renderToStaticMarkup(
      <CatalogControlledInput
        control={{
          "aria-describedby": "artist-hint",
          "aria-invalid": undefined,
          id: "artist",
        }}
        entityLabel="artist"
        loading={false}
        name="artistName"
        onChange={jest.fn()}
        options={[{ id: "artist_1", label: "Existing Artist" }]}
        unavailable={false}
        value="Existing Artist"
      />,
    )

    expect(markup).toContain('id="artist"')
    expect(markup).toContain('list="artist-choices"')
    expect(markup).toContain(
      'aria-describedby="artist-hint artist-selection"',
    )
    expect(markup).toContain('<option value="Existing Artist"></option>')
    expect(markup).toContain(
      "Using existing artist: Existing Artist.",
    )
  })

  it("explains the safe fallback when controlled choices are unavailable", () => {
    const markup = renderToStaticMarkup(
      <CatalogControlledInput
        control={{
          "aria-describedby": undefined,
          "aria-invalid": undefined,
          id: "genre",
        }}
        entityLabel="genre"
        loading={false}
        name="genre"
        onChange={jest.fn()}
        options={[]}
        unavailable
        value="Death metal"
      />,
    )

    expect(markup).toContain('aria-describedby="genre-selection"')
    expect(markup).toContain(
      "Name matching will still be checked safely when the draft is created.",
    )
  })
})
