import assert from "node:assert/strict"

// Actual compiled native controls and browser keys only. No armed mutation,
// replacement DOM, application event dispatch or programmatic focus repair.
export const runNativeSettingsInvokerCommands = async ({
  page,
  checkpoint,
  clickText,
  readNativeDialogTitle,
  waitRoute,
  receipts,
  fixture,
  assertInteractiveControl,
}) => {
  await waitRoute(page, "/app/settings/store")
  const invoker = await page.$('main a[aria-label="Edit metadata"]')
  assert.ok(invoker, "The native Store metadata invoker must exist")
  const originalMetadata = await fixture.request(
    "GET",
    `/admin/stores/${fixture.store.id}`
  )
  assert.equal(originalMetadata.status, 200)
  const metadataBefore = originalMetadata.data.store.metadata
  const invokerControl = await assertInteractiveControl(invoker)
  const before = receipts.length
  const keyboardLoop = async () => {
    const first = (
      await page.evaluateHandle(() => document.activeElement)
    ).asElement()
    assert.ok(first)
    const counts = []
    try {
      for (const key of ["Tab", "Shift+Tab"]) {
        const deadline = Date.now() + 5000
        let returned = false
        for (let step = 1; step <= 64 && Date.now() < deadline; step++) {
          if (key === "Shift+Tab") {
            await page.keyboard.down("Shift")
            try {
              await page.keyboard.press("Tab")
            } finally {
              await page.keyboard.up("Shift")
            }
          } else await page.keyboard.press(key)
          const state = await first.evaluate((original) => {
            const current = document.activeElement
            const dialog = document.querySelector('[role="dialog"]')
            const rect = current?.getBoundingClientRect()
            const style = current ? getComputedStyle(current) : null
            return {
              returned: current === original,
              inside: !!dialog?.contains(current),
              visible:
                !!rect?.width &&
                !!rect?.height &&
                style?.visibility === "visible" &&
                style?.display !== "none" &&
                !current?.closest('[aria-hidden="true"], [inert]'),
            }
          })
          assert(
            state.inside && state.visible,
            "Native Tab focus left the drawer"
          )
          if (state.returned) {
            assert(step >= 4, "Native drawer controls were skipped")
            counts.push(step)
            returned = true
            break
          }
        }
        assert(returned, "Native drawer Tab loop exceeded 64 keys or 5 seconds")
      }
      assert.equal(counts[0], counts[1])
      return { forwardSteps: counts[0], reverseSteps: counts[1] }
    } finally {
      await first.dispose()
    }
  }
  const restored = async () => {
    await waitRoute(page, "/app/settings/store")
    try {
      await page.waitForFunction(
        (original) =>
          original.isConnected &&
          document.activeElement === original &&
          !document.querySelector('[role="dialog"], [role="alertdialog"]'),
        { polling: "raf", timeout: 2000 },
        invoker
      )
    } catch (error) {
      error.nativeInvokerProof = await invoker.evaluate((original) => ({
        originalConnected: original.isConnected,
        originalHref: original.getAttribute("href"),
        originalFocused: document.activeElement === original,
        actualFocusTag: document.activeElement?.tagName,
        dialogCount: document.querySelectorAll(
          '[role="dialog"], [role="alertdialog"]'
        ).length,
      }))
      throw error
    }
  }
  try {
    for (const [activation, close] of [
      ["pointer", "Cancel"],
      ["keyboard", "Escape"],
      ["keyboard", "Close dialog"],
    ]) {
      if (activation === "pointer") await invoker.click()
      else {
        assert(
          await invoker.evaluate(
            (original) => document.activeElement === original
          )
        )
        await page.keyboard.press("Enter")
      }
      await page.waitForSelector('input[name="metadata.0.key"]', {
        visible: true,
      })
      await checkpoint(
        `metadata-${activation}-${close.toLowerCase().replaceAll(" ", "-")}-open`,
        {
          nativeDialogTitle: await readNativeDialogTitle({
            expectedName: "Edit Metadata",
          }),
          keyboardLoop: await keyboardLoop(),
          invokerControl,
        }
      )
      if (close === "Escape") await page.keyboard.press("Escape")
      else if (close === "Close dialog") {
        const button = await page.$('button[aria-label="Close dialog"]')
        assert.ok(button)
        try {
          await button.click()
        } finally {
          await button.dispose()
        }
      } else await clickText(page, close)
      await restored()
      await checkpoint(
        `metadata-${activation}-${close.toLowerCase().replaceAll(" ", "-")}-original-invoker`,
        {
          originalConnectedInvokerFocused: true,
          programmaticFocusRepair: false,
        }
      )
    }
    assert.equal(
      receipts
        .slice(before)
        .filter(
          (entry) =>
            entry.kind === "native" &&
            ["POST", "PUT", "PATCH", "DELETE"].includes(entry.method)
        ).length,
      0,
      "Read-only invoker checks must not submit native writes"
    )
    const unchanged = await fixture.request(
      "GET",
      `/admin/stores/${fixture.store.id}`
    )
    assert.equal(unchanged.status, 200)
    assert.equal(unchanged.data.store.id, fixture.store.id)
    assert.deepEqual(unchanged.data.store.metadata, metadataBefore)
  } finally {
    await invoker.dispose()
  }
}
