const { spawn, spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(".env.local"), quiet: true });

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required for the desktop smoke.");

const databaseName = new URL(testDatabaseUrl).pathname.slice(1).split("/")[0];
if (databaseName !== "axis_ccp_test" && !databaseName.endsWith("_test")) {
  throw new Error("Desktop smoke refuses to run against a non-test database.");
}

if (!process.env.AUTH_SECRET) throw new Error("AUTH_SECRET is required for the desktop smoke.");

const packageVersion = require("../package.json").version;
const executable = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve("dist", `axis-ccp-${packageVersion}.exe`);

if (!fs.existsSync(executable)) {
  throw new Error("The packaged desktop EXE is missing. Run desktop:build first.");
}

function serverReady() {
  return new Promise((resolve) => {
    const request = http.get("http://127.0.0.1:3210/login", (response) => {
      response.resume();
      resolve(Boolean(response.statusCode && response.statusCode < 500));
    });
    request.setTimeout(1_000, () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

async function waitForServer() {
  const deadline = Date.now() + 50_000;
  while (Date.now() < deadline) {
    if (await serverReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The packaged desktop server did not become ready.");
}

async function waitForStartupEvidence(logPath) {
  const deadline = Date.now() + 50_000;
  while (Date.now() < deadline) {
    const text = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
    if (
      /Starting packaged Next\.js with Electron's bundled Node runtime\./.test(text) &&
      /Next\.js login route is ready\./.test(text) &&
      /AXIS BrowserWindow loaded the application origin\./.test(text)
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The packaged desktop log did not confirm the bundled server and window load.");
}

function forceStopProcessTree(pid, child) {
  if (process.platform === "win32" && pid) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 10_000,
    });
    return;
  }
  if (child.pid === pid) child.kill();
}

async function waitForServerToStop() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!(await serverReady())) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("The packaged desktop server did not stop after the app quit.");
}

function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }

  return Promise.race([
    new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    }),
    new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

async function main() {
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "axis-desktop-profile-"));
  const shutdownMarker = path.join(profileDirectory, "request-clean-shutdown");
  const pidFile = path.join(profileDirectory, "desktop-main.pid");
  const environment = {
    ...process.env,
    DATABASE_URL: testDatabaseUrl,
    PRODUCTION_DELIVERY_ENABLED: "false",
    PROVIDER_PILOT_ENABLED: "false",
    QA_EMAIL_ENABLED: "false",
    EMAIL_PROVIDER: "",
    PRODUCTION_EMAIL_PROVIDER: "",
    GMAIL_SMTP_USER: "",
    GMAIL_APP_PASSWORD: "",
    RESEND_API_KEY: "",
    RESEND_WEBHOOK_SECRET: "",
    MONDAY_API_TOKEN: "",
    MEDIA_PROVIDER: "local",
    CLOUDINARY_URL: "",
    AXIS_DESKTOP_DIAGNOSTICS: "1",
    AXIS_DESKTOP_SMOKE: "1",
    AXIS_DESKTOP_SMOKE_SHUTDOWN_FILE: shutdownMarker,
    AXIS_DESKTOP_SMOKE_PID_FILE: pidFile,
  };

  const desktop = spawn(executable, [`--user-data-dir=${profileDirectory}`], {
    env: environment,
    stdio: "ignore",
    windowsHide: true,
  });
  let failure;
  let cleanShutdown = false;

  try {
    await waitForServer();
    const startupLog = path.join(profileDirectory, "axis-desktop-startup.log");
    await waitForStartupEvidence(startupLog);

    const result = spawnSync(process.execPath, [path.resolve(__dirname, "packaged-login-smoke.js")], {
      env: environment,
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.status !== 0) throw new Error("Packaged desktop login smoke failed.");

    fs.writeFileSync(shutdownMarker, "quit\n", { flag: "wx" });
    const exit = await waitForProcessExit(desktop, 15_000);
    if (!exit) throw new Error("The packaged desktop app did not shut down cleanly.");
    assert.equal(exit.code, 0, `The packaged desktop app exited with code ${exit.code}.`);
    assert.equal(exit.signal, null);
    await waitForServerToStop();
    cleanShutdown = true;
    console.log("Packaged desktop started its bundled server and shut down cleanly.");
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const startupLog = path.join(profileDirectory, "axis-desktop-startup.log");
    if (failure && fs.existsSync(startupLog)) {
      console.error(fs.readFileSync(startupLog, "utf8"));
    }
    if (!cleanShutdown) {
      const packagedPid = fs.existsSync(pidFile)
        ? Number.parseInt(fs.readFileSync(pidFile, "utf8"), 10)
        : undefined;
      if (Number.isInteger(packagedPid)) forceStopProcessTree(packagedPid, desktop);
      forceStopProcessTree(desktop.pid, desktop);
      desktop.unref();
    }
    if (
      path.dirname(profileDirectory) === path.resolve(os.tmpdir()) &&
      path.basename(profileDirectory).startsWith("axis-desktop-profile-")
    ) {
      try {
        fs.rmSync(profileDirectory, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 200,
        });
      } catch {
        // Windows can briefly retain Chromium handles after process shutdown. The directory
        // contains only this smoke's disposable profile and no AXIS data or secrets.
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Packaged desktop smoke failed.");
  process.exitCode = 1;
});
