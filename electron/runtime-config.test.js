const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  DesktopConfigurationError,
  desktopConfigCandidates,
  resolveDesktopEnvironment,
} = require("./runtime-config");

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "axis-desktop-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("uses the explicit configuration file and normalizes the Auth.js origin", (t) => {
  const directory = temporaryDirectory(t);
  const configPath = path.join(directory, "desktop.env");
  fs.writeFileSync(
    configPath,
    'DATABASE_URL="postgresql://user:password@127.0.0.1:5432/axis_ccp_dev"\n' +
      'AUTH_SECRET="test-only-secret"\n' +
      'AUTH_URL="http://localhost:3000"\n' +
      'PRODUCTION_DELIVERY_ENABLED="true"\n',
  );

  const result = resolveDesktopEnvironment({
    baseEnvironment: {},
    explicitPath: configPath,
    userDataPath: directory,
    portableDirectory: directory,
    appRoot: directory,
    origin: "http://127.0.0.1:3210",
    port: 3210,
  });

  assert.equal(result.configPath, configPath);
  assert.equal(result.environment.AUTH_URL, "http://127.0.0.1:3210");
  assert.equal(result.environment.NEXTAUTH_URL, "http://127.0.0.1:3210");
  assert.equal(result.environment.PRODUCTION_DELIVERY_ENABLED, "false");
});

test("process environment takes precedence without exposing its values", () => {
  const result = resolveDesktopEnvironment({
    baseEnvironment: {
      DATABASE_URL: "postgresql://process:secret@127.0.0.1:5432/axis_ccp_dev",
      AUTH_SECRET: "process-secret",
    },
    explicitPath: undefined,
    userDataPath: "missing-user-data",
    portableDirectory: "missing-portable",
    appRoot: "missing-root",
    origin: "http://127.0.0.1:3210",
    port: 3210,
  });

  assert.equal(result.environment.AUTH_SECRET, "process-secret");
  assert.equal(result.environment.PORT, "3210");
});

test("fails closed when required configuration is missing", () => {
  assert.throws(
    () =>
      resolveDesktopEnvironment({
        baseEnvironment: {},
        explicitPath: undefined,
        userDataPath: "missing-user-data",
        portableDirectory: "missing-portable",
        appRoot: "missing-root",
        origin: "http://127.0.0.1:3210",
        port: 3210,
      }),
    (error) =>
      error instanceof DesktopConfigurationError &&
      error.message.includes("DATABASE_URL") &&
      error.message.includes("AUTH_SECRET"),
  );
});

test("an explicit missing file is an error instead of falling back", () => {
  const candidates = desktopConfigCandidates({
    explicitPath: "does-not-exist.env",
    userDataPath: "ignored",
    portableDirectory: "ignored",
    appRoot: "ignored",
  });
  assert.equal(candidates.length, 1);

  assert.throws(
    () =>
      resolveDesktopEnvironment({
        baseEnvironment: {},
        explicitPath: candidates[0],
        userDataPath: "ignored",
        portableDirectory: "ignored",
        appRoot: "ignored",
        origin: "http://127.0.0.1:3210",
        port: 3210,
      }),
    /does not exist/,
  );
});
