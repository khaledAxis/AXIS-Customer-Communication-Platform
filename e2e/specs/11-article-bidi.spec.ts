import { expect, test, type Locator } from "@playwright/test";
import { loginAsAdmin, PageErrors } from "../support";

const title = "e2e מדידות עם NavVis CLX בשטח";
const summary = "משלבים RTK, SLAM ו־BIM למדידות מדויקות.";
const caption = "צילום NavVis VLX, בשטח עם RTK.";
const body = [
  "## מדידות עם NavVis CLX",
  "בדיקה NavVis CLX, בשטח.",
  "### תיעוד עם NavVis VLX",
  "המערכת **NavVis CLX** משתמשת ב־SLAM, ומשלבת RTK לתהליך BIM.",
  "> הצוות בחר ב־NavVis VLX לתיעוד המבנה.",
  "- בדיקת RTK לפני תחילת המדידה.\n- עיבוד SLAM ויצירת BIM.",
  "1. מכינים את NavVis CLX.\n2. בודקים את NavVis VLX.",
  "פרטים (https://example.com/scan?mode=RTK&format=BIM), להמשך העבודה.",
  "[מדריך NavVis CLX](https://example.com/guide?mode=RTK&format=BIM)",
].join("\n\n");

async function assertIsolation(preview: Locator) {
  await expect(preview).toHaveAttribute("dir", "rtl");
  await expect(preview).toHaveCSS("overflow-wrap", "anywhere");
  expect(await preview.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  for (const phrase of ["NavVis CLX", "NavVis VLX", "RTK", "SLAM", "BIM"]) {
    await expect(preview.locator('bdi[dir="ltr"]').filter({ hasText: new RegExp(`^${phrase}$`) }).first()).toBeVisible();
  }
  await expect(preview.locator("h2 bdi").first()).toHaveText("NavVis CLX");
  await expect(preview.locator("h3 bdi").first()).toHaveText("NavVis VLX");
  await expect(preview.locator("blockquote bdi").first()).toHaveText("NavVis VLX");
  await expect(preview.locator("ul li bdi").first()).toHaveText("RTK");
  await expect(preview.locator("ol li bdi").first()).toHaveText("NavVis CLX");
  await expect(preview.locator("ul")).toHaveCSS("list-style-type", "disc");
  await expect(preview.locator("ol")).toHaveCSS("list-style-type", "decimal");
  await expect(preview.locator("a")).toHaveAttribute("href", "https://example.com/guide?mode=RTK&format=BIM");
  const probe = preview.locator("p").filter({ hasText: /^בדיקה NavVis CLX, בשטח\.$/ });
  const geometry = await probe.evaluate(element => {
    const bdi = element.querySelector("bdi")!;
    const range = document.createRange();
    const text = bdi.firstChild!;
    range.setStart(text, 0); range.setEnd(text, 1); const first = range.getBoundingClientRect();
    range.setStart(text, text.textContent!.length - 1); range.setEnd(text, text.textContent!.length); const last = range.getBoundingClientRect();
    const before = document.createRange(); before.selectNodeContents(element.firstChild!);
    const after = document.createRange(); after.selectNodeContents(element.lastChild!);
    return { firstX: first.x, lastX: last.x, firstY: first.y, lastY: last.y,
      beforeX: before.getBoundingClientRect().x, afterX: after.getBoundingClientRect().x,
      punctuation: bdi.nextSibling?.textContent, direction: getComputedStyle(bdi).direction,
      isolation: getComputedStyle(bdi).unicodeBidi };
  });
  expect(geometry.direction).toBe("ltr"); expect(geometry.isolation).toBe("isolate");
  expect(geometry.firstY).toBe(geometry.lastY); expect(geometry.firstX).toBeLessThan(geometry.lastX);
  expect(geometry.beforeX).toBeGreaterThan(geometry.lastX); expect(geometry.afterX).toBeLessThan(geometry.firstX);
  expect(geometry.punctuation).toBe(", בשטח.");
}

async function capturePreview(preview: Locator, path: string) {
  await preview.scrollIntoViewIfNeeded();
  // Leave room for the fixed app header; it must not obscure the rendering proof.
  await preview.page().evaluate(() => window.scrollBy(0, -100));
  await preview.screenshot({ path });
}

test("Hebrew editor and article previews isolate Latin fragments without rewriting saved text", async ({ page }, testInfo) => {
  const errors = new PageErrors(page);
  await loginAsAdmin(page);
  // Only this test's image request/upload is mocked. No live media provider is used.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64");
  await page.route("**/api/media/upload", route => route.fulfill({ json: { ok: true, url: "/api/media/bidi-fixture.png" } }));
  await page.route("**/api/media/bidi-fixture.png", route => route.fulfill({ contentType: "image/png", body: png }));
  await page.goto("/content/new");
  await page.locator('input[name="title"]').fill(title);
  await page.locator('textarea[name="summary"]').fill(summary);
  await page.locator("label").filter({ has: page.locator('input[name="origin"][value="INGESTED"]') }).click();
  await page.locator('input[name="sourceName"]').fill("e2e Synthetic BiDi source");
  await page.getByRole("textbox", { name: "Article text", exact: true }).fill(body);
  await page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp,image/gif"]').setInputFiles({ name: "bidi.png", mimeType: "image/png", buffer: png });
  await page.getByLabel("Describe the image (shown if the picture cannot load)").fill(caption);
  const preview = page.getByRole("region", { name: "Article preview", exact: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await assertIsolation(preview);
  await expect(page.locator("figcaption bdi").first()).toHaveText("NavVis VLX");
  await capturePreview(preview, testInfo.outputPath("editor-rtl-desktop.png"));
  await page.getByRole("button", { name: "Save article", exact: true }).click();
  await expect(page).toHaveURL(/\/content\/[^/]+\/edit\?saved=1/);
  const id = /\/content\/([^/]+)\/edit/.exec(page.url())![1];
  await page.reload();
  await expect(page.locator('input[name="title"]')).toHaveValue(title);
  await expect(page.locator('textarea[name="summary"]')).toHaveValue(summary);
  await expect(page.getByRole("textbox", { name: "Article text", exact: true })).toHaveValue(body);
  await expect(page.getByLabel("Describe the image (shown if the picture cannot load)")).toHaveValue(caption);
  await page.setViewportSize({ width: 390, height: 844 });
  await assertIsolation(preview);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await capturePreview(preview, testInfo.outputPath("editor-rtl-phone.png"));
  await page.goto(`/content/inbox/${id}`);
  await assertIsolation(preview);
  await expect(page.locator("figcaption")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("figcaption bdi").first()).toHaveText("NavVis VLX");
  await capturePreview(preview, testInfo.outputPath("article-rtl-phone.png"));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await assertIsolation(preview);
  await capturePreview(preview, testInfo.outputPath("article-rtl-desktop.png"));
  await page.locator("figure").screenshot({ path: testInfo.outputPath("caption-rtl.png") });
  await page.goto("/content?filter=HE");
  const heading = page.getByRole("heading", { name: title, exact: true });
  await expect(heading).toHaveAttribute("dir", "rtl");
  await expect(heading.locator("bdi").filter({ hasText: /^NavVis CLX$/ })).toBeVisible();
  errors.assertClean("Hebrew BiDi browser rendering");
});
