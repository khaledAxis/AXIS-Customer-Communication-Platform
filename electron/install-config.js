const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dotenv = require("dotenv");

const { REQUIRED_DESKTOP_VARIABLES } = require("./runtime-config");

const PRODUCT_DIRECTORY = "AXIS Customer Communication Platform";
const source = path.resolve(process.argv[2] || ".env.local");
const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
const destinationDirectory = path.join(appData, PRODUCT_DIRECTORY);
const destination = path.join(destinationDirectory, ".env.local");

if (!fs.existsSync(source)) {
  throw new Error("Desktop configuration source not found. Expected .env.local.");
}

const contents = fs.readFileSync(source);
const parsed = dotenv.parse(contents);
const missing = REQUIRED_DESKTOP_VARIABLES.filter(
  (name) => typeof parsed[name] !== "string" || parsed[name].trim().length === 0,
);

if (missing.length > 0) {
  throw new Error(`Desktop configuration source is missing: ${missing.join(", ")}.`);
}

fs.mkdirSync(destinationDirectory, { recursive: true });
fs.writeFileSync(destination, contents, { mode: 0o600 });
console.log(`Desktop configuration installed at ${destination}. No secret values were printed.`);
