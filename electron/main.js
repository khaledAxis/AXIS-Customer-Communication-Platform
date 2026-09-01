const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const { app, BrowserWindow, dialog, utilityProcess } = require("electron");

const {
  DesktopConfigurationError,
  resolveDesktopEnvironment,
} = require("./runtime-config");

const PRODUCT_DIRECTORY = "AXIS Customer Communication Platform";
const DEVELOPMENT_PORT = 3000;
const PACKAGED_PORT = 3210;
const STARTUP_TIMEOUT_MS = 45_000;

let mainWindow;
let nextProcess;
let serverStopped = false;

function safeDiagnostic(value) {
  return String(value)
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted database URL]")
    .replace(/(secret|password|token|api[_-]?key)\s*[:=]\s*[^\s]+/gi, "$1=[redacted]")
    .trim();
}

function writeStartupLog(message) {
  if (process.env.AXIS_DESKTOP_DIAGNOSTICS !== "1") return;
  const logPath = path.join(app.getPath("userData"), "axis-desktop-startup.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${safeDiagnostic(message)}\n`);
}

function originFor(port) {
  return `http://127.0.0.1:${port}`;
}

function requestServer(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(Boolean(response.statusCode && response.statusCode < 500));
    });
    request.setTimeout(1_000, () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

async function waitForNextServer(url) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (serverStopped) {
      throw new Error("The local application server stopped during startup.");
    }
    if (await requestServer(`${url}/login`)) {
      writeStartupLog("Next.js login route is ready.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("The local application server did not become ready in time.");
}

function assertPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => {
      reject(
        new Error(
          `The desktop port ${port} is already in use. Close the other AXIS window or local server and try again.`,
        ),
      );
    });
    probe.listen(port, "127.0.0.1", () => {
      probe.close((error) => (error ? reject(error) : resolve()));
    });
  });
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    backgroundColor: "#0f172a",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    mainWindow = null;
  });
  return window;
}

function showStartupError(error, configPath) {
  const detail =
    error instanceof DesktopConfigurationError
      ? `${error.message}\n\nAsk an administrator to provision ${configPath} and restart the app.`
      : `${error instanceof Error ? error.message : "Unknown startup failure."}\n\nNo email was sent. Close the app and ask an administrator to check PostgreSQL and the desktop configuration.`;

  dialog.showErrorBox("AXIS desktop could not start", detail);
}

async function startPackagedServer() {
  const port = PACKAGED_PORT;
  const origin = originFor(port);
  const userDataPath = path.join(app.getPath("appData"), PRODUCT_DIRECTORY);
  const portableDirectory = process.env.PORTABLE_EXECUTABLE_DIR;
  const expectedConfigPath = path.join(userDataPath, ".env.local");
  const serverRoot = path.join(process.resourcesPath, "next");
  const serverEntry = path.join(serverRoot, "server.js");

  writeStartupLog("Checking the packaged desktop port.");
  await assertPortAvailable(port);

  const { environment } = resolveDesktopEnvironment({
    baseEnvironment: process.env,
    explicitPath: process.env.AXIS_DESKTOP_ENV_FILE,
    userDataPath,
    portableDirectory,
    appRoot: app.getAppPath(),
    origin,
    port,
  });
  // The standalone server and its traced dependencies are ordinary resources. ASAR
  // module resolution is unavailable inside the isolated utility process.
  environment.NODE_PATH = path.join(serverRoot, "node_modules");

  writeStartupLog("Starting the packaged Next.js utility process.");
  nextProcess = utilityProcess.fork(serverEntry, [], {
    cwd: serverRoot,
    env: environment,
    stdio: process.env.AXIS_DESKTOP_DIAGNOSTICS === "1" ? "pipe" : "ignore",
    serviceName: "AXIS local application server",
  });
  nextProcess.stderr?.on("data", (chunk) => writeStartupLog(`server stderr: ${chunk}`));
  nextProcess.on("exit", (code) => {
    serverStopped = true;
    writeStartupLog(`Next.js utility process exited with code ${code}.`);
    if (code !== 0 && mainWindow && !mainWindow.isDestroyed()) {
      showStartupError(
        new Error("The local application server stopped unexpectedly."),
        expectedConfigPath,
      );
    }
  });

  return { origin, expectedConfigPath };
}

async function openApplication() {
  mainWindow = createMainWindow();

  const expectedConfigPath = path.join(
    app.getPath("appData"),
    PRODUCT_DIRECTORY,
    ".env.local",
  );

  try {
    const desktop = app.isPackaged
      ? await startPackagedServer()
      : { origin: originFor(DEVELOPMENT_PORT), expectedConfigPath };

    await waitForNextServer(desktop.origin);
    await mainWindow.loadURL(desktop.origin);
  } catch (error) {
    writeStartupLog(
      `Desktop startup failed: ${error instanceof Error ? `${error.name}: ${error.message}` : "unknown error"}`,
    );
    showStartupError(error, expectedConfigPath);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    openApplication().catch((error) => {
      showStartupError(error, "the per-user desktop configuration file");
      app.exit(1);
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        openApplication().catch((error) => {
          showStartupError(error, "the per-user desktop configuration file");
          app.exit(1);
        });
      }
    });
  });
}

app.on("before-quit", () => {
  if (nextProcess) nextProcess.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
