import {
  isAdminFocusTargetVisible,
  revealAdminFocusTarget,
} from "./admin-focus-visibility"

const targetFixture = () => {
  const target = {
    contains: jest.fn(),
    getBoundingClientRect: jest.fn(() => ({
      bottom: 140,
      height: 40,
      left: 20,
      right: 220,
      top: 100,
      width: 200,
      x: 20,
      y: 100,
      toJSON: () => ({}),
    })),
    parentElement: null as HTMLElement | null,
    scrollIntoView: jest.fn(),
  }
  return target
}

describe("Admin focus visibility", () => {
  it("leaves a visible focused target in place", () => {
    const topmost = {} as Element
    const target = targetFixture()
    target.contains.mockReturnValue(true)
    const ownerDocument = { elementFromPoint: jest.fn(() => topmost) }

    expect(isAdminFocusTargetVisible(target, ownerDocument)).toBe(true)
    expect(revealAdminFocusTarget(target, ownerDocument)).toBe(false)
    expect(ownerDocument.elementFromPoint).toHaveBeenCalledWith(120, 120)
    expect(target.scrollIntoView).not.toHaveBeenCalled()
  })

  it("accepts a hit-tested wrapper around the focused target", () => {
    const target = targetFixture()
    target.contains.mockReturnValue(false)
    const topmost = {
      contains: jest.fn(() => true),
    } as unknown as HTMLElement
    target.parentElement = topmost
    const ownerDocument = { elementFromPoint: jest.fn(() => topmost) }

    expect(isAdminFocusTargetVisible(target, ownerDocument)).toBe(true)
  })

  it("centers a target covered by authored UI", () => {
    const target = targetFixture()
    target.contains.mockReturnValue(false)
    const topmost = {
      contains: jest.fn(() => false),
    } as unknown as HTMLElement
    const ownerDocument = { elementFromPoint: jest.fn(() => topmost) }

    expect(revealAdminFocusTarget(target, ownerDocument)).toBe(true)
    expect(target.scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "center",
      inline: "nearest",
    })
  })
})
