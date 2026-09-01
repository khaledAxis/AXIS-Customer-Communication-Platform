const { spawn, spawnSync } = require("node:child_process");
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

const executable = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(
      "dist",
      "win-unpacked",
      "AXIS Customer Communication Platform.exe",
    );

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
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await serverReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The packaged desktop server did not become ready.");
}

async function main() {
  const profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "axis-desktop-profile-"));
  const environment = {
    ...process.env,
    DATABASE_URL: testDatabaseUrl,
    PRODUCTION_DELIVERY_ENABLED: "false",
    PROVIDER_PILOT_ENABLED: "false",
    QA_EMAIL_ENABLED: "false",
    GMAIL_SMTP_USER: "",
    GMAIL_APP_PASSWORD: "",
    RESEND_API_KEY: "",
    RESEND_WEBHOOK_SECRET: "",
    MONDAY_API_TOKEN: "",
    AXIS_DESKTOP_DIAGNOSTICS: "1",
  };

  const desktop = spawn(executable, [`--user-data-dir=${profileDirectory}`], {
    env: environment,
    stdio: "ignore",
    windowsHide: true,
  });
  let failure;

  try {
    await waitForServer();
    const result = spawnSync(process.execPath, [path.resolve(__dirname, "packaged-login-smoke.js")], {
      env: environment,
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.status !== 0) throw new Error("Packaged desktop login smoke failed.");
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const startupLog = path.join(profileDirectory, "axis-desktop-startup.log");
    if (failure && fs.existsSync(startupLog)) {
      console.error(fs.readFileSync(startupLog, "utf8"));
    }
    if (process.platform === "win32" && desktop.pid) {
      spawnSync("taskkill", ["/PID", String(desktop.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      desktop.kill();
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
        // Windows can briefly retain Chromium handles after taskkill. The directory
        // contains only this smoke's disposable profile and no AXIS data or secrets.
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Packaged desktop smoke failed.");
  process.exitCode = 1;
});
