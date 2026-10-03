import { expect, test } from "@playwright/test"

test("UI runtime contact validation focuses errors and announces delivery feedback", async ({
  page,
}, testInfo) => {
  let requests = 0
  await page.route("**/api/contact", async (route) => {
    requests += 1
    await route.fulfill({
      status: requests === 1 ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        requests === 1
          ? { detail: "private-provider-diagnostic" }
          : { ok: true }
      ),
    })
  })
  await page.goto("/contact")
  const main = page.getByRole("main")
  const send = page.getByRole("button", { name: "Send message", exact: true })
  const name = page.getByRole("textbox", { name: "Name", exact: true })
  const email = page.getByRole("textbox", { name: "Email", exact: true })
  const message = page.getByRole("textbox", { name: "Message", exact: true })

  await send.click()
  await expect(name).toBeFocused()
  await expect(name).toHaveAttribute("aria-invalid", "true")
  expect(requests).toBe(0)
  await name.fill("Audit Contact")
  await send.click()
  await expect(email).toBeFocused()
  await email.fill("audit@example.test")
  await send.click()
  await expect(message).toBeFocused()
  expect(requests).toBe(0)
  await page.screenshot({ path: testInfo.outputPath("contact-validation.png") })
  await message.fill("Controlled contact feedback regression.")

  await send.click()
  await expect(main.getByRole("alert")).toContainText("Something went wrong")
  await expect(page.getByText("private-provider-diagnostic")).toHaveCount(0)
  await expect(message).toHaveValue("Controlled contact feedback regression.")
  await send.click()
  await expect(main.getByRole("status")).toContainText("Message sent")
  await expect(name).toHaveValue("")
  await expect(email).toHaveValue("")
  await expect(message).toHaveValue("")
  expect(requests).toBe(2)
  await page.screenshot({ path: testInfo.outputPath("contact-success.png") })
})
