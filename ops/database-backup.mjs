import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { assertRestoreTarget, backupKey, databaseTarget, decryptArchive, encryptArchive, hashFile } from "./backup-lib.mjs";

const NAME = /^axis-\d{8}T\d{9}Z-[0-9a-f-]{36}\.enc$/;
const temp = mkdtempSync(join(tmpdir(), "axis-backup-"));
chmodSync(temp, 0o700);
const ownedFiles = [];
let lock;
function removeOwned(file) { if (existsSync(file)) rmSync(file); }

function connection(file) {
  if (!file) throw new Error("Provide the explicit database URL file.");
  const target = databaseTarget(readFileSync(file, "utf8").trim());
  const escape = text => text.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
  const passwordFile = join(temp, "pgpass-" + ownedFiles.length);
  writeFileSync(passwordFile, [target.host, target.port, target.database, target.user, target.password].map(escape).join(":") + "\n", { mode: 0o600 });
  ownedFiles.push(passwordFile);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG")));
  Object.assign(env, { PGHOST: target.host, PGPORT: target.port, PGUSER: target.user,
    PGDATABASE: target.database, PGPASSFILE: passwordFile, PGCONNECT_TIMEOUT: "10", PGSSLMODE: target.sslmode });
  if (process.env.BACKUP_SSL_ROOT_CERT) env.PGSSLROOTCERT = process.env.BACKUP_SSL_ROOT_CERT;
  return { target, env };
}

function tool(name, args, env) {
  const child = spawn(process.env.PG_BIN ? join(process.env.PG_BIN, name) : name, args,
    { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  // Errors from database tools can contain data or connection details; never echo them.
  child.stderr.resume();
  const timeout = setTimeout(() => child.kill("SIGTERM"), 30 * 60 * 1000);
  const done = new Promise((resolveDone, reject) => {
    child.once("error", () => reject(new Error(name + " could not start.")));
    child.once("close", code => code === 0 ? resolveDone() : reject(new Error(name + " failed.")));
  }).finally(() => clearTimeout(timeout));
  // Mark rejection handled immediately while a stream consumer is being attached.
  void done.catch(() => undefined);
  return { child, done };
}

async function query(sql, env) {
  const run = tool("psql", ["--no-psqlrc", "--no-password", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], env);
  let result = "";
  for await (const chunk of run.child.stdout) {
    result += chunk.toString();
    if (result.length > 1024) { run.child.kill(); throw new Error("Unexpected database response."); }
  }
  await run.done;
  return result.trim();
}

function backupDirectory() {
  if (!process.env.BACKUP_DIR) throw new Error("BACKUP_DIR is required.");
  const dir = resolve(process.env.BACKUP_DIR);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (lstatSync(dir).isSymbolicLink()) throw new Error("Backup directory may not be a symbolic link.");
  return realpathSync(dir);
}

try {
  const command = process.argv[2];
  if (command === "create") {
    const dir = backupDirectory();
    const lockPath = join(dir, ".axis-backup.lock");
    writeFileSync(lockPath, "", { flag: "wx", mode: 0o600 });
    lock = lockPath;
    const key = backupKey(process.env.BACKUP_ENCRYPTION_KEY_FILE);
    const { target, env } = connection(process.env.BACKUP_DATABASE_URL_FILE);
    const id = "axis-" + new Date().toISOString().replace(/[-:.]/g, "") + "-" + randomUUID() + ".enc";
    const file = join(dir, id);
    const dump = tool("pg_dump", ["--no-password", "--format=custom", "--no-owner", "--no-acl"], env);
    try {
      await encryptArchive(dump.child.stdout, file, key);
      await dump.done;
      const manifest = { version: 1, createdAt: new Date().toISOString(), database: target.database,
        bytes: statSync(file).size, sha256: await hashFile(file) };
      writeFileSync(file + ".json", JSON.stringify(manifest) + "\n", { flag: "wx", mode: 0o600 });
      console.log(JSON.stringify({ event: "backup_completed", archive: id, bytes: manifest.bytes }));
    } catch (error) {
      dump.child.kill();
      removeOwned(file);
      removeOwned(file + ".json");
      throw error;
    }
  } else if (command === "restore") {
    const file = resolve(process.argv[3] || "");
    if (!NAME.test(basename(file))) throw new Error("Select an AXIS encrypted archive.");
    const key = backupKey(process.env.BACKUP_ENCRYPTION_KEY_FILE);
    const manifest = JSON.parse(readFileSync(file + ".json", "utf8"));
    if (manifest.version !== 1 || manifest.sha256 !== await hashFile(file)) throw new Error("Archive checksum failed.");
    const { target, env } = connection(process.env.RESTORE_DATABASE_URL_FILE);
    assertRestoreTarget(target, manifest.database, process.env.RESTORE_CONFIRM_DATABASE);
    // Refuse every pre-existing user relation, including migration history.
    const count = await query("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f')", env);
    if (count !== "0") throw new Error("Restore target is not empty. Nothing was overwritten.");
    const plain = join(temp, "restore.dump");
    ownedFiles.push(plain);
    await decryptArchive(file, plain, key);
    const restore = tool("pg_restore", ["--no-password", "--no-owner", "--no-acl", "--single-transaction",
      "--exit-on-error", "--dbname", target.database, plain], env);
    restore.child.stdout.resume();
    await restore.done;
    console.log(JSON.stringify({ event: "restore_completed" }));
  } else if (command === "prune") {
    const dir = backupDirectory();
    const days = process.env.BACKUP_RETENTION_DAYS || "14";
    if (!/^\d+$/.test(days) || Number(days) < 1 || Number(days) > 3650) throw new Error("Invalid retention days.");
    const lockPath = join(dir, ".axis-backup.lock");
    writeFileSync(lockPath, "", { flag: "wx", mode: 0o600 });
    lock = lockPath;
    const files = readdirSync(dir).filter(name => NAME.test(name)).map(name => join(dir, name))
      .filter(file => lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink() && existsSync(file + ".json"))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    const cutoff = Date.now() - Number(days) * 86400000;
    const candidates = files.slice(2).filter(file => statSync(file).mtimeMs < cutoff);
    const apply = process.argv.includes("--apply");
    for (const file of candidates) {
      if (apply) { removeOwned(file); removeOwned(file + ".json"); }
    }
    console.log(JSON.stringify({ event: apply ? "backups_pruned" : "retention_preview", count: candidates.length }));
  } else throw new Error("Usage: create | restore <archive> | prune [--apply]");
} catch (error) {
  // Only our fixed messages are public. JSON/FS errors could reveal file contents or paths.
  const safe = /^(BACKUP_|Backup key|A PostgreSQL|Invalid |Unsupported |Backups cover|Restore requires|Provide |pg_dump |pg_restore |psql |Unexpected |Backup directory|Select an AXIS|Archive checksum|Restore target|Unknown backup|Usage:)/;
  console.error(JSON.stringify({ event: "backup_operation_failed", message: safe.test(error.message) ? error.message : "Operation refused. Check configuration, permissions, archive integrity and tool availability." }));
  process.exitCode = 1;
} finally {
  for (const file of ownedFiles) removeOwned(file);
  if (lock) removeOwned(lock);
  rmdirSync(temp);
}

