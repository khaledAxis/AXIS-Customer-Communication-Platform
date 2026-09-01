const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const standaloneRoot = path.join(projectRoot, ".next", "standalone");
const staticSource = path.join(projectRoot, ".next", "static");
const publicSource = path.join(projectRoot, "public");

if (!fs.existsSync(path.join(standaloneRoot, "server.js"))) {
  throw new Error("Next.js standalone output is missing. Run `next build` first.");
}

fs.mkdirSync(path.join(standaloneRoot, ".next"), { recursive: true });
fs.cpSync(staticSource, path.join(standaloneRoot, ".next", "static"), {
  recursive: true,
  force: true,
});
fs.cpSync(publicSource, path.join(standaloneRoot, "public"), {
  recursive: true,
  force: true,
});

console.log("Prepared the traced Next.js runtime for Electron packaging.");
