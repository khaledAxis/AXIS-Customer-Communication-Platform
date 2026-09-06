import { expect, test } from "@playwright/test";
import { loginAsAdmin, PageErrors } from "../support";

test("mixed article formats survive paste, file import, save and the canonical email preview", async ({ page }, testInfo) => {
  const errors = new PageErrors(page);
  // A synthetic picture served locally by the test; no publisher is contacted.
  await page.route("https://formats.example.com/**", route => route.fulfill({
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WsAAAAASUVORK5CYII=", "base64"),
  }));
  const creds = await loginAsAdmin(page);
  const title = "e2e מאמר משולב — GPS ונתוני שטח";
  await page.goto("/content/new");
  await page.locator('input[name="title"]').fill(title);
  await page.locator('textarea[name="summary"]').fill("טקסט, עיצוב ותמונות במאמר אחד.");
  await page.locator('input[name="externalUrl"]').fill("https://formats.example.com/news/update");
  const editor = page.getByRole("textbox", { name: "Article text", exact: true });
  await editor.fill("## מבט מהשטח\n\nPlain text with **Markdown emphasis**.\n\n<p>HTML paragraph with <b>GPS mapping</b>.</p>\n\n");
  // Exercise the actual formatted clipboard handler, including selection insertion.
  await editor.evaluate(element => {
    const textarea = element as HTMLTextAreaElement;
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    const data = new DataTransfer();
    data.setData("text/html", '<h2>ملاحظات المسح</h2><ul><li>מדידה ראשונה</li><li>מדידה נוספת</li></ul><blockquote>תובנה מהשטח</blockquote>');
    textarea.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(page.getByText("Formatting adapted.", { exact: false })).toBeVisible();
  await page.getByLabel("Import article file").setInputFiles({
    name: "field-notes.html", mimeType: "text/html",
    buffer: Buffer.from('<p>Imported field notes.</p><img src="/photo.png" alt="Synthetic field picture"><table><tr><td>GPS</td><td>40 m</td></tr></table>'),
  });
  await expect(page.getByText("File added.", { exact: false })).toBeVisible();
  await expect(page.locator(".axis-richtext h2").first()).toHaveText("מבט מהשטח");
  await expect(page.locator(".axis-richtext blockquote")).toContainText("תובנה מהשטח");
  await page.getByRole("button", { name: "Save article", exact: true }).click();
  await expect(page).toHaveURL(/\/content\/[^/]+\/edit\?saved=1/);
  const articleUrl = page.url();
  await page.reload();
  await expect(editor).toHaveValue(/## מבט מהשטח/);
  const saved = await editor.inputValue();
  expect(saved).not.toMatch(/<(?:p|img|table|h2|blockquote)\b/);
  expect(saved).toContain("![Synthetic field picture](https://formats.example.com/photo.png)");
  expect(saved).toContain("GPS | 40 m");
  await editor.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("mixed-format-editor.png"), fullPage: true });
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);

  await page.goto(`/newsletters/${creds.fixtures.campaignId}`);
  await page.locator("li").filter({ has: page.getByText(title, { exact: true }) })
    .getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator("ol li").filter({ hasText: title })).toBeVisible();
  await page.reload();
  await expect(page.locator("ol li").filter({ hasText: title })).toBeVisible();
  await page.getByRole("link", { name: "Preview email", exact: true }).click();
  const email = page.frameLocator("iframe").first();
  await expect(email.getByRole("heading", { name: "ملاحظات المسح", exact: true })).toBeVisible();
  await expect(email.locator("blockquote")).toHaveText("תובנה מהשטח");
  await expect(email.getByAltText("Synthetic field picture")).toHaveAttribute("src", "https://formats.example.com/photo.png");
  const emailText = await email.locator("body").innerText();
  expect(emailText).toContain("Imported field notes.");
  expect(emailText).toContain("GPS | 40 m");
  expect(emailText).not.toMatch(/<(?:p|img|h2|div|table)\b/);
  await page.getByRole("button", { name: "Phone", exact: true }).click();
  await expect(email.getByRole("heading", { name: "מבט מהשטח", exact: true })).toBeVisible();
  errors.assertClean("mixed-format article workflow");

  // Remove only the article this test created, through the same staff UI.
  await page.goto(`/newsletters/${creds.fixtures.campaignId}`);
  await page.locator("ol li").filter({ hasText: title }).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.locator("ol li").filter({ hasText: title })).toHaveCount(0);
  await page.goto(articleUrl);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/\/content$/);
});
