const fs = require("node:fs");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const {
  app,
  BrowserWindow,
  dialog,
  shell,
} = require("electron");

const {
  DesktopConfigurationError,
  resolveDesktopEnvironment,
} = require("./runtime-config");
const { ACTION, decideNavigation } = require("./navigation-policy");

const PRODUCT_DIRECTORY = "AXIS Customer Communication Platform";
const DEVELOPMENT_PORT = 3000;
const PACKAGED_PORT = 3210;
const STARTUP_TIMEOUT_MS = 45_000;

let mainWindow;
let nextProcess;
let serverStopped = false;
let isQuitting = false;
let smokeShutdownTimer;

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
  const target = new URL(url);
  return new Promise((resolve) => {
    const socket = net.createConnection({
      host: target.hostname,
      port: Number(target.port),
    });
    let settled = false;

    const finish = (ready) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ready);
    };

    socket.setTimeout(1_000, () => finish(false));
    socket.on("error", () => finish(false));
    socket.on("connect", () => {
      socket.write(
        `GET ${target.pathname}${target.search} HTTP/1.1\r\nHost: ${target.host}\r\nConnection: close\r\n\r\n`,
      );
    });
    socket.on("data", (chunk) => {
      const status = /^HTTP\/1\.[01] (\d{3})/.exec(chunk.toString("ascii"));
      if (status) finish(Number(status[1]) < 500);
    });
    socket.on("end", () => finish(false));
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

function openExternalLink(url) {
  shell.openExternal(url).catch(() => {
    writeStartupLog("The system browser could not open an external link.");
  });
}

function secureWindowNavigation(window, expectedOrigin) {
  const guardNavigation = (event) => {
    const decision = decideNavigation(event.url, expectedOrigin);
    if (decision.action === ACTION.ALLOW_APPLICATION) return;

    event.preventDefault();
    if (decision.action === ACTION.OPEN_EXTERNAL) openExternalLink(decision.url);
  };

  window.webContents.on("will-navigate", guardNavigation);
  window.webContents.on("will-redirect", guardNavigation);
  window.webContents.setWindowOpenHandler(({ url }) => {
    const decision = decideNavigation(url, expectedOrigin);
    if (decision.action === ACTION.OPEN_EXTERNAL) openExternalLink(decision.url);
    // AXIS never creates another BrowserWindow, including for same-origin links.
    return { action: "deny" };
  });
}

function createMainWindow(expectedOrigin) {
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

  secureWindowNavigation(window, expectedOrigin);
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    mainWindow = null;
  });
  return window;
}

function startSmokeShutdownWatcher() {
  if (process.env.AXIS_DESKTOP_SMOKE !== "1") return;

  const marker = process.env.AXIS_DESKTOP_SMOKE_SHUTDOWN_FILE;
  const pidFile = process.env.AXIS_DESKTOP_SMOKE_PID_FILE;
  if (!marker || !path.isAbsolute(marker) || !pidFile || !path.isAbsolute(pidFile)) {
    throw new Error("The desktop smoke control paths must be absolute.");
  }

  fs.writeFileSync(pidFile, `${process.pid}\n`, { flag: "wx" });

  smokeShutdownTimer = setInterval(() => {
    if (!fs.existsSync(marker)) return;
    clearInterval(smokeShutdownTimer);
    smokeShutdownTimer = undefined;
    writeStartupLog("Desktop smoke requested a clean shutdown.");
    app.quit();
  }, 100);
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
  // The standalone server and its traced dependencies are ordinary resources. The
  // packaged Electron executable supplies its bundled Node runtime to this child.
  const serverEnvironment = {
    ...environment,
    NODE_PATH: path.join(serverRoot, "node_modules"),
    ELECTRON_RUN_AS_NODE: "1",
  };
  // The portable launcher variables describe the outer self-extracting wrapper.
  // They must not be inherited by the extracted Electron executable when it is
  // reused as the packaged server's Node runtime.
  delete serverEnvironment.PORTABLE_EXECUTABLE_FILE;
  delete serverEnvironment.PORTABLE_EXECUTABLE_DIR;

  writeStartupLog("Starting packaged Next.js with Electron's bundled Node runtime.");
  nextProcess = spawn(process.execPath, [serverEntry], {
    cwd: serverRoot,
    env: serverEnvironment,
    stdio: "ignore",
    windowsHide: true,
  });
  nextProcess.on("error", () => {
    serverStopped = true;
    writeStartupLog("Next.js server process could not start.");
  });
  nextProcess.on("exit", (code) => {
    serverStopped = true;
    writeStartupLog(`Next.js server process exited with code ${code}.`);
    if (!isQuitting && code !== 0 && mainWindow && !mainWindow.isDestroyed()) {
      showStartupError(
        new Error("The local application server stopped unexpectedly."),
        expectedConfigPath,
      );
    }
  });

  return { origin, expectedConfigPath };
}

async function openApplication() {
  const applicationOrigin = originFor(app.isPackaged ? PACKAGED_PORT : DEVELOPMENT_PORT);
  mainWindow = createMainWindow(applicationOrigin);

  const expectedConfigPath = path.join(
    app.getPath("appData"),
    PRODUCT_DIRECTORY,
    ".env.local",
  );

  try {
    const desktop = app.isPackaged
      ? await startPackagedServer()
      : { origin: applicationOrigin, expectedConfigPath };

    await waitForNextServer(desktop.origin);
    await mainWindow.loadURL(desktop.origin);
    writeStartupLog("AXIS BrowserWindow loaded the application origin.");
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
    startSmokeShutdownWatcher();
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
  isQuitting = true;
  if (smokeShutdownTimer) clearInterval(smokeShutdownTimer);
  if (nextProcess) nextProcess.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
