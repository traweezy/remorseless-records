import { getConfirmActionState } from "./confirm-action"

describe("getConfirmActionState", () => {
  it("keeps a guarded action disabled until the caller is ready", () => {
    expect(
      getConfirmActionState({
        confirmDisabled: true,
        confirmLabel: "Publish post",
        pending: false,
        pendingAnnouncement: undefined,
        pendingLabel: undefined,
      })
    ).toEqual({
      announcement: "",
      disabled: true,
      label: "Publish post",
    })
  })

  it("locks the action and exposes explicit pending copy", () => {
    expect(
      getConfirmActionState({
        confirmDisabled: false,
        confirmLabel: "Switch provider",
        pending: true,
        pendingAnnouncement: "Switching tax provider",
        pendingLabel: "Switching…",
      })
    ).toEqual({
      announcement: "Switching tax provider",
      disabled: true,
      label: "Switching…",
    })
  })

  it("enables a valid idle action", () => {
    expect(
      getConfirmActionState({
        confirmDisabled: false,
        confirmLabel: "Save shelf",
        pending: false,
        pendingAnnouncement: undefined,
        pendingLabel: undefined,
      })
    ).toEqual({
      announcement: "",
      disabled: false,
      label: "Save shelf",
    })
  })
})
