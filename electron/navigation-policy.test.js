const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  ACTION,
  decideNavigation,
  parseExpectedOrigin,
} = require("./navigation-policy");

const APP_ORIGIN = "http://127.0.0.1:3210";

test("allows navigation only within the exact AXIS loopback origin", () => {
  for (const url of [
    `${APP_ORIGIN}/`,
    `${APP_ORIGIN}/login?callbackUrl=%2Fhelp`,
    `${APP_ORIGIN}/help#activation`,
  ]) {
    assert.deepEqual(decideNavigation(url, APP_ORIGIN), {
      action: ACTION.ALLOW_APPLICATION,
    });
  }
});

test("opens credential-free external HTTP and HTTPS links in the system browser", () => {
  assert.deepEqual(decideNavigation("https://www.axis-gps.com/support", APP_ORIGIN), {
    action: ACTION.OPEN_EXTERNAL,
    url: "https://www.axis-gps.com/support",
  });
  assert.deepEqual(decideNavigation("http://docs.example.com/guide", APP_ORIGIN), {
    action: ACTION.OPEN_EXTERNAL,
    url: "http://docs.example.com/guide",
  });
});

test("rejects alternate local application origins", () => {
  for (const url of [
    "http://localhost:3210/login",
    "http://127.0.0.1:3000/login",
    "https://127.0.0.1:3210/login",
    "http://127.0.0.2:3210/login",
    "http://[::1]:3210/login",
    "http://0.0.0.0:3210/login",
  ]) {
    assert.deepEqual(decideNavigation(url, APP_ORIGIN), { action: ACTION.REJECT });
  }
});

test("rejects credentials, unsafe schemes, and malformed URLs", () => {
  for (const url of [
    "https://user:password@example.com/private",
    "http://user@example.com/private",
    "file:///C:/Windows/System32/calc.exe",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "mailto:info@axis-gps.com",
    "axis-ccp://open/help",
    "//example.com/path",
    "not a URL",
  ]) {
    assert.deepEqual(decideNavigation(url, APP_ORIGIN), { action: ACTION.REJECT });
  }
});

test("refuses a misconfigured application origin", () => {
  for (const origin of [
    "https://127.0.0.1:3210",
    "http://localhost:3210",
    "http://127.0.0.1:3210/",
    "http://user@127.0.0.1:3210",
  ]) {
    assert.throws(() => parseExpectedOrigin(origin), /exact 127\.0\.0\.1 HTTP origin/);
  }
});

test("the BrowserWindow keeps Electron isolation and wires the navigation policy", () => {
  const source = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");

  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /sandbox:\s*true/);
  assert.match(source, /webContents\.on\("will-navigate", guardNavigation\)/);
  assert.match(source, /webContents\.on\("will-redirect", guardNavigation\)/);
  assert.match(source, /webContents\.setWindowOpenHandler/);
  assert.match(source, /return \{ action: "deny" \}/);
  assert.match(source, /shell\.openExternal\(url\)/);
  assert.match(source, /stdio: "ignore"/);
  assert.match(source, /ELECTRON_RUN_AS_NODE:\s*"1"/);
  assert.match(source, /delete serverEnvironment\.PORTABLE_EXECUTABLE_FILE/);
  assert.match(source, /delete serverEnvironment\.PORTABLE_EXECUTABLE_DIR/);
  assert.match(source, /spawn\(process\.execPath, \[serverEntry\]/);
  assert.match(source, /nextProcess\.on\("error"/);
  assert.match(source, /GET \$\{target\.pathname\}/);
  assert.match(source, /Number\(status\[1\]\) < 500/);
  assert.match(source, /AXIS BrowserWindow loaded the application origin\./);
});
