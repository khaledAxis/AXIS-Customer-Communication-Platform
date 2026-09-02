const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { chromium } = require("playwright");

async function main() {
  const credentialsPath = path.resolve("e2e", ".auth", "credentials.json");
  const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:3210/login", { waitUntil: "domcontentloaded" });
    assert.equal(new URL(page.url()).pathname, "/login");
    await page.getByLabel(/email/i).waitFor();
    await page.getByLabel(/password/i).waitFor();
    await page.getByRole("button", { name: /sign in/i }).waitFor();
    await page.getByLabel(/email/i).fill(credentials.admin.email);
    await page.getByLabel(/password/i).fill(credentials.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((url) => url.pathname !== "/login", { timeout: 20_000 });

    assert.equal(new URL(page.url()).origin, "http://127.0.0.1:3210");
    assert.notEqual(new URL(page.url()).pathname, "/login");
    await page.getByRole("button", { name: /sign out/i }).waitFor();
    console.log("Packaged desktop sign-in passed with the synthetic test account.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Packaged login smoke failed.");
  process.exitCode = 1;
});
