const fs = require("node:fs");
const path = require("node:path");

const dotenv = require("dotenv");

const REQUIRED_DESKTOP_VARIABLES = ["DATABASE_URL", "AUTH_SECRET"];
const DESKTOP_CONFIG_FILENAME = ".env.local";

class DesktopConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "DesktopConfigurationError";
  }
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean).map((candidate) => path.resolve(candidate)))];
}

function desktopConfigCandidates({ explicitPath, userDataPath, portableDirectory, appRoot }) {
  if (hasValue(explicitPath)) return [path.resolve(explicitPath)];

  return uniquePaths([
    userDataPath && path.join(userDataPath, DESKTOP_CONFIG_FILENAME),
    portableDirectory && path.join(portableDirectory, DESKTOP_CONFIG_FILENAME),
    appRoot && path.join(appRoot, DESKTOP_CONFIG_FILENAME),
  ]);
}

function findDesktopConfig(candidates, explicitPath) {
  const configPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (configPath) return configPath;

  if (hasValue(explicitPath)) {
    throw new DesktopConfigurationError(
      "AXIS_DESKTOP_ENV_FILE points to a file that does not exist.",
    );
  }
  return null;
}

function readDesktopConfig(configPath) {
  if (!configPath) return {};
  try {
    return dotenv.parse(fs.readFileSync(configPath));
  } catch {
    throw new DesktopConfigurationError(
      "The desktop configuration file could not be read. Ask an administrator to reprovision it.",
    );
  }
}

function resolveDesktopEnvironment({
  baseEnvironment,
  explicitPath,
  userDataPath,
  portableDirectory,
  appRoot,
  origin,
  port,
}) {
  const candidates = desktopConfigCandidates({
    explicitPath,
    userDataPath,
    portableDirectory,
    appRoot,
  });
  const configPath = findDesktopConfig(candidates, explicitPath);
  const fileEnvironment = readDesktopConfig(configPath);
  const environment = { ...fileEnvironment, ...baseEnvironment };

  const missing = REQUIRED_DESKTOP_VARIABLES.filter(
    (name) => !hasValue(environment[name]),
  );
  if (missing.length > 0) {
    throw new DesktopConfigurationError(
      `Desktop configuration is missing: ${missing.join(", ")}.`,
    );
  }

  // The desktop origin is private to this process. An AUTH_URL copied from the web
  // deployment (or from localhost) must not issue cookies for a different host.
  environment.AUTH_URL = origin;
  environment.NEXTAUTH_URL = origin;
  environment.AUTH_TRUST_HOST = "true";
  environment.HOSTNAME = "127.0.0.1";
  environment.PORT = String(port);
  environment.NODE_ENV = "production";
  environment.NEXT_TELEMETRY_DISABLED = "1";

  // Production customer delivery is unfinished and locked in the web product. A
  // local wrapper must never become a second activation path.
  environment.PRODUCTION_DELIVERY_ENABLED = "false";

  return { environment, configPath, candidates };
}

module.exports = {
  DESKTOP_CONFIG_FILENAME,
  DesktopConfigurationError,
  REQUIRED_DESKTOP_VARIABLES,
  desktopConfigCandidates,
  resolveDesktopEnvironment,
};
