import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, closeSync, openSync, readSync, readFileSync, lstatSync, appendFileSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
const MAGIC = Buffer.from("AXISBKP1");

export function backupKey(file) {
  if (!file) throw new Error("BACKUP_ENCRYPTION_KEY_FILE is required.");
  const raw = readFileSync(file, "utf8").trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(raw)) throw new Error("Backup key must contain a base64-encoded 32-byte key.");
  return Buffer.from(raw, "base64");
}

export function databaseTarget(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("A PostgreSQL connection file is required."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname ||
      !/^\/[A-Za-z0-9_]+$/.test(url.pathname) || !url.username || url.hash)
    throw new Error("Invalid PostgreSQL backup target.");
  for (const key of url.searchParams.keys())
    if (!["schema", "sslmode"].includes(key)) throw new Error("Unsupported backup connection option.");
  if (url.searchParams.has("schema") && url.searchParams.get("schema") !== "public")
    throw new Error("Backups cover the whole database; alternate schema selection is not supported.");
  const target = {
    host: url.hostname, port: url.port || "5432", database: url.pathname.slice(1),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    sslmode: url.searchParams.get("sslmode") || "verify-full",
  };
  if (!["disable", "require", "verify-ca", "verify-full"].includes(target.sslmode) ||
      Object.values(target).some(v => /[\r\n\0]/.test(v))) throw new Error("Invalid PostgreSQL connection options.");
  return target;
}

export function assertRestoreTarget(target, sourceName, confirmation) {
  if (!target.database.endsWith("_restore") || target.database === sourceName ||
      confirmation !== target.database)
    throw new Error("Restore requires a different, empty database ending in _restore and an exact RESTORE_CONFIRM_DATABASE.");
}

export async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}

/** Stream the dump directly into encryption; no plaintext backup touches disk. */
export async function encryptArchive(input, file, key) {
  const nonce = randomBytes(12);
  writeFileSync(file, Buffer.concat([MAGIC, nonce]), { flag: "wx", mode: 0o600 });
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(MAGIC);
  await pipeline(input, cipher, createWriteStream(file, { flags: "a" }));
  appendFileSync(file, cipher.getAuthTag());
}

/** Authenticate fully before the plaintext file may be submitted to pg_restore. */
export async function decryptArchive(file, output, key) {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 37) throw new Error("Invalid encrypted archive.");
  const fd = openSync(file, "r");
  const header = Buffer.alloc(20);
  const tag = Buffer.alloc(16);
  try { readSync(fd, header, 0, 20, 0); readSync(fd, tag, 0, 16, info.size - 16); }
  finally { closeSync(fd); }
  if (!header.subarray(0, 8).equals(MAGIC)) throw new Error("Unknown backup format.");
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(8));
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  await pipeline(createReadStream(file, { start: 20, end: info.size - 17 }), decipher,
    createWriteStream(output, { flags: "wx", mode: 0o600 }));
}

