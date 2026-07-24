import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import {
  getCarouselNavigation,
  normalizeCarouselSlideRoles,
} from "@/components/ui/carousel"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { MediaPlaceholder } from "@/components/ui/media-placeholder"
import { PageHeader, PageShell } from "@/components/ui/page-shell"
import { SectionHeading } from "@/components/ui/section-heading"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
  )
})

afterEach(() => {
  cleanup()
})

describe("reusable UI primitives", () => {
  it("composes semantic cards without adding wrapper elements", () => {
    render(
      <Card as="section" variant="panel" aria-label="Release details">
        Details
      </Card>
    )

    const section = screen.getByRole("region", { name: "Release details" })
    expect(section.tagName).toBe("SECTION")
    expect(section).toHaveClass("bg-surface/90")
  })

  it("uses the requested heading level for accordion triggers", () => {
    render(
      <Accordion type="single">
        <AccordionItem value="shipping">
          <AccordionTrigger headingLevel="h2">
            Shipping question
          </AccordionTrigger>
        </AccordionItem>
      </Accordion>
    )

    expect(
      screen.getByRole("heading", { level: 2, name: "Shipping question" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Shipping question" })
    ).toBeInTheDocument()
  })

  it("normalizes third-party carousel semantics through one adapter", () => {
    const root = document.createElement("section")
    root.innerHTML =
      '<ul class="splide__list" role="presentation"><li class="splide__slide" role="group">Release</li></ul>'
    const go = vi.fn()
    const instance = { root, go }

    normalizeCarouselSlideRoles(instance)
    const navigation = getCarouselNavigation(instance)
    navigation?.go("+1")

    expect(root.querySelector(".splide__list")).toHaveAttribute("role", "list")
    expect(root.querySelector(".splide__slide")).toHaveAttribute(
      "role",
      "listitem"
    )
    expect(go).toHaveBeenCalledWith("+1")
    expect(getCarouselNavigation(null)).toBeNull()
  })

  it("connects reusable field labels, descriptions, and errors", () => {
    render(
      <Field>
        <FieldLabel htmlFor="message">Message</FieldLabel>
        <FieldDescription id="message-help">
          Include the relevant order number.
        </FieldDescription>
        <Textarea
          id="message"
          aria-describedby="message-help message-error"
          aria-invalid
        />
        <FieldError id="message-error">Message is required.</FieldError>
      </Field>
    )

    const textarea = screen.getByRole("textbox", { name: "Message" })
    expect(textarea).toHaveAttribute(
      "aria-describedby",
      "message-help message-error"
    )
    expect(textarea).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByRole("alert")).toHaveTextContent("Message is required.")
  })

  it("does not render an empty field error", () => {
    const { container } = render(<FieldError>{null}</FieldError>)
    expect(container).toBeEmptyDOMElement()
  })

  it("builds accessible input groups from shared controls", () => {
    const handleClear = vi.fn()
    render(
      <InputGroup>
        <InputGroupAddon aria-hidden>$</InputGroupAddon>
        <InputGroupInput aria-label="Minimum price" defaultValue="10" />
        <InputGroupButton
          type="button"
          aria-label="Clear minimum price"
          onClick={handleClear}
        >
          ×
        </InputGroupButton>
      </InputGroup>
    )

    const input = screen.getByRole("textbox", { name: "Minimum price" })
    fireEvent.focus(input)
    expect(input).toHaveValue("10")

    fireEvent.click(screen.getByRole("button", { name: "Clear minimum price" }))
    expect(handleClear).toHaveBeenCalledOnce()
  })

  it("labels each thumb in a reusable range slider", () => {
    render(
      <Slider
        value={[10, 50]}
        min={0}
        max={100}
        thumbLabels={["Minimum price", "Maximum price"]}
        getValueText={(value) => `$${value}`}
      />
    )

    expect(
      screen.getByRole("slider", { name: "Minimum price" })
    ).toHaveAttribute("aria-valuetext", "$10")
    expect(
      screen.getByRole("slider", { name: "Maximum price" })
    ).toHaveAttribute("aria-valuetext", "$50")
  })

  it("shares status, badge, empty, and media presentation", () => {
    render(
      <>
        <Alert variant="warning">
          <AlertTitle>Limited stock</AlertTitle>
          <AlertDescription>Only a few copies remain.</AlertDescription>
        </Alert>
        <Badge variant="danger">Sold out</Badge>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No releases</EmptyTitle>
            <EmptyDescription>Try clearing the filters.</EmptyDescription>
          </EmptyHeader>
        </Empty>
        <MediaPlaceholder label="Cover unavailable" showIcon />
      </>
    )

    expect(screen.getByRole("alert")).toHaveClass("border-amber-400/50")
    expect(screen.getByText("Sold out")).toHaveClass("bg-destructive/20")
    expect(
      screen.getByRole("heading", { name: "No releases" })
    ).toBeInTheDocument()
    expect(screen.getByText("Cover unavailable")).toBeInTheDocument()
  })

  it("reuses page and section headings with one document-level heading", () => {
    render(
      <PageShell>
        <PageHeader
          eyebrow="Store"
          title="Catalog"
          description="Browse every release."
        />
        <SectionHeading
          leading="Featured"
          highlight="releases"
          description="Recent arrivals."
        />
      </PageShell>
    )

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Catalog"
    )
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Featured releases"
    )
  })
})
