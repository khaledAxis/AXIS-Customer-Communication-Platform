/** Full rehearsal against an owned, disposable PostgreSQL container; never reads .env. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve, join, relative, isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const suffix = randomUUID().slice(0, 8);
const network = `axis-ops-${suffix}`;
const database = `${network}-db`;
const apps = [`${network}-a`, `${network}-b`];
const worker = `${network}-worker`;
const schedulerSecret = randomBytes(32).toString("hex");
const appImage = process.env.OPS_APP_IMAGE || "axis-ccp:ops-foundation-local";
const migratorImage = process.env.OPS_MIGRATOR_IMAGE || "axis-ccp:ops-migrator-local";
const backupImage = process.env.OPS_BACKUP_IMAGE || "axis-ccp:ops-backup-local";
const password = randomBytes(24).toString("hex");
const sourceUrl = `postgresql://axis:${password}@${database}:5432/axis_ops_test?sslmode=disable`;
const authSecret = randomBytes(48).toString("hex");
const loginPassword = `Ops-${randomUUID()}-Aa!9`;
const workspace = realpathSync(process.cwd());
const fixtures = join(workspace, "var", `ops-smoke-${suffix}`);
const backups = join(fixtures, "backups");
mkdirSync(backups, { recursive: true, mode: 0o700 });
const owned = [];
let networkCreated = false;

async function docker(args, allowFailure = false) {
  const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stdout = "";
  let diagnostics = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  // Docker errors can echo command arguments; this tool reports only the operation.
  child.stderr.on("data", chunk => { if (args[0] === "logs") diagnostics += chunk; });
  const timer = setTimeout(() => child.kill(), 180000);
  try {
    const code = await new Promise((resolveCode, reject) => {
      child.once("error", reject);
      child.once("close", resolveCode);
    });
    if (code !== 0 && !allowFailure) throw new Error(`Docker ${args[0]} failed (${code}).`);
    return { code, stdout: stdout.trim(), diagnostics };
  } finally { clearTimeout(timer); }
}
function envArgs(env) { return Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]); }
async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}
async function until(check, label, timeout = 45000) {
  const deadline = Date.now() + timeout;
  do {
    try { if (await check()) return; } catch { /* startup/outage is expected */ }
    await delay(300);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}.`);
}
async function probe(origin, endpoint, status) {
  const response = await fetch(origin + endpoint, { redirect: "manual", signal: AbortSignal.timeout(4000) });
  assert.equal(response.status, status);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.deepEqual(await response.json(), { status: status === 200 ? "ok" : "unavailable" });
  return true;
}
function log(check) { console.log(JSON.stringify({ event: "operations_smoke_pass", check })); }

try {
  // A bridge is required for loopback-published ports on Docker Desktop. No live
  // adapter credentials are supplied; all provider and customer-send gates are off.
  await docker(["network", "create", network]); networkCreated = true;
  owned.push(database);
  await docker(["run", "-d", "--name", database, "--network", network,
    ...envArgs({ POSTGRES_USER: "axis", POSTGRES_PASSWORD: password, POSTGRES_DB: "axis_ops_test" }), "postgres:16-alpine"]);
  await until(async () => (await docker(["exec", database, "pg_isready", "-U", "axis", "-d", "axis_ops_test"], true)).code === 0, "PostgreSQL startup");

  const ports = [await freePort(), await freePort()];
  const origins = ports.map(port => `http://127.0.0.1:${port}`);
  const runtime = {
    DATABASE_URL: sourceUrl, AUTH_SECRET: authSecret, AUTH_URL: origins[0], PUBLIC_APP_URL: origins[0],
    AXIS_ALLOW_INSECURE_TEST_HTTP: "true", MEDIA_PROVIDER: "local", DB_POOL_MAX: "3",
    PRODUCTION_DELIVERY_ENABLED: "false", PROVIDER_PILOT_ENABLED: "false", QA_EMAIL_ENABLED: "false",
    SCHEDULER_ENABLED: "true", SCHEDULER_TRIGGER_SECRET: schedulerSecret,
    GMAIL_APP_PASSWORD: "", RESEND_API_KEY: "", RESEND_WEBHOOK_SECRET: "", MONDAY_API_TOKEN: "", CLOUDINARY_URL: "",
  };
  async function startApp(index) {
    owned.push(apps[index]);
    await docker(["run", "-d", "--name", apps[index], "--network", network, ...(index === 0 ? ["--network-alias", "app"] : []), "--init", "--read-only",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--pids-limit", "200",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m,uid=1000,gid=1000",
      "--tmpfs", "/app/.next/cache:rw,noexec,nosuid,size=64m,uid=1000,gid=1000",
      "-p", `127.0.0.1:${ports[index]}:3000`, ...envArgs(runtime), appImage]);
  }
  await startApp(0);
  await until(() => probe(origins[0], "/api/health/live", 200), "app startup");
  await probe(origins[0], "/api/health/ready", 503);
  log("unmigrated database refuses readiness; liveness remains available");

  await docker(["run", "--rm", "--network", network, ...envArgs({ DATABASE_URL: sourceUrl }), migratorImage]);
  const seed = `
    const {PrismaClient}=require('@prisma/client');
    const {PrismaPg}=require('@prisma/adapter-pg');
    const {hash}=require('@node-rs/argon2');
    const prisma=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
    (async()=>{
      const user=await prisma.user.create({data:{email:'operations@axis-test.invalid',name:'Operations fixture',role:'ADMIN',
        passwordHash:await hash(process.env.FIXTURE_PASSWORD,{algorithm:2,memoryCost:19456,timeCost:2,parallelism:1})}});
      await prisma.communicationAddress.create({data:{normalizedEmail:'denied@axis-test.invalid',language:'HE',consentStatus:'DENIED'}});
      await prisma.contentItem.create({data:{title:'Synthetic reviewed automation article',language:'HE',origin:'INGESTED',reviewState:'APPROVED'}});
      await prisma.newsletterAutomation.create({data:{name:'Synthetic worker rehearsal',cadence:'WEEKLY',dayOfWeek:0,language:'HE',createdById:user.id,nextScheduledAt:new Date()}});
      console.log(user.id);
    })().finally(()=>prisma.$disconnect());`;
  const userId = (await docker(["run", "--rm", "--network", network, "--entrypoint", "node",
    ...envArgs({ DATABASE_URL: sourceUrl, FIXTURE_PASSWORD: loginPassword }), migratorImage, "-e", seed])).stdout;
  await startApp(1);
  for (const origin of origins) await until(() => probe(origin, "/api/health/ready", 200), "migrated readiness");
  assert.equal((await docker(["exec", apps[0], "id", "-u"])).stdout, "1000");
  log("two non-root replicas serve the migrated database on read-only filesystems");
  assert.equal((await fetch(origins[0]+"/api/internal/jobs/tick",{method:"POST"})).status,401);
  owned.push(worker);
  await docker(["run","-d","--name",worker,"--network",network,"--read-only","--cap-drop","ALL","--security-opt","no-new-privileges:true",
    ...envArgs({SCHEDULER_URL:"http://app:3000/api/internal/jobs/tick",SCHEDULER_TRIGGER_SECRET:schedulerSecret}),
    process.env.OPS_WORKER_IMAGE || "axis-ccp:ops-worker-local"]);
  await until(async()=> (await docker(["exec",database,"psql","-U","axis","-d","axis_ops_test","-At","-c",
    `SELECT count(*) FROM "NewsletterAutomationRun" WHERE status='PREPARED' AND "generatedCampaignId" IS NOT NULL`])).stdout === "1", "durable worker prepares one draft",60000);
  assert.equal((await docker(["exec",database,"psql","-U","axis","-d","axis_ops_test","-At","-c",`SELECT count(*) FROM "CampaignRecipient"`])).stdout,"0");
  log("authenticated worker prepares one draft with no recipient ledger or provider call");

  const cookies = new Map();
  function receive(response) {
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";", 1)[0]; const at = pair.indexOf("=");
      cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
  }
  function cookieHeader() { return [...cookies].map(([key, value]) => `${key}=${value}`).join("; "); }
  async function signIn(origin, enteredPassword) {
    const csrf = await fetch(origin + "/api/auth/csrf", { headers: { Cookie: cookieHeader() } });
    receive(csrf);
    const { csrfToken } = await csrf.json();
    const response = await fetch(origin + "/api/auth/callback/credentials", {
      method: "POST", redirect: "manual",
      headers: { Cookie: cookieHeader(), "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" },
      body: new URLSearchParams({ csrfToken, email: "operations@axis-test.invalid", password: enteredPassword, callbackUrl: origins[0] }),
    });
    receive(response);
    return response.json();
  }
  const login = await signIn(origins[0], loginPassword);
  assert.ok(!login.url.includes("error="));
  assert.ok([...cookies.keys()].some(key => key.includes("session-token")));
  const session = await fetch(origins[1] + "/api/auth/session", { headers: { Cookie: cookieHeader() } });
  assert.equal((await session.json()).user.id, userId);
  const protectedPage = await fetch(origins[1] + "/", { headers: { Cookie: cookieHeader() }, redirect: "manual" });
  assert.equal(protectedPage.status, 200);
  if (process.env.OPS_BENCHMARK === "true") {
    const { benchmark } = await import("./capacity-benchmark.mjs");
    await benchmark({docker,envArgs,database,network,sourceUrl,migratorImage,appImage,apps,origins,cookie:cookieHeader(),workspace});
  }
  // The ninth attempt is blocked even when earlier attempts alternate between replicas.
  for (let i = 0; i < 8; i++) await signIn(origins[i % 2], "Wrong-Fixture-Password9!");
  assert.ok((await signIn(origins[1], loginPassword)).url.includes("rate_limited"));
  log("JWT session and eight-attempt login limit are shared across replicas");

  await docker(["stop", "-t", "5", database]);
  await until(() => probe(origins[0], "/api/health/ready", 503), "database outage reflected in readiness", 15000);
  await probe(origins[0], "/api/health/live", 200);
  await docker(["start", database]);
  for (const origin of origins) await until(() => probe(origin, "/api/health/ready", 200), "readiness recovery");
  log("database outage and recovery produce correct readiness without restarting the apps");

  writeFileSync(join(fixtures, "source.url"), sourceUrl, { mode: 0o600 });
  writeFileSync(join(fixtures, "restore.url"), sourceUrl.replace("axis_ops_test", "axis_ops_restore"), { mode: 0o600 });
  writeFileSync(join(fixtures, "key"), randomBytes(32).toString("base64"), { mode: 0o600 });
  await docker(["exec", database, "createdb", "-U", "axis", "axis_ops_restore"]);
  const backupArgs = ["run", "--rm", "--network", network, "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true", "--user", `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m,mode=1777",
    "--mount", `type=bind,source=${fixtures},target=/fixtures,readonly`,
    "--mount", `type=bind,source=${backups},target=/backups`,
    ...envArgs({ BACKUP_DIR: "/backups", BACKUP_ENCRYPTION_KEY_FILE: "/fixtures/key",
      BACKUP_DATABASE_URL_FILE: "/fixtures/source.url", RESTORE_DATABASE_URL_FILE: "/fixtures/restore.url",
      RESTORE_CONFIRM_DATABASE: "axis_ops_restore" })];
  await docker([...backupArgs, backupImage, "create"]);
  const archives = readdirSync(backups).filter(name => name.endsWith(".enc"));
  assert.equal(archives.length, 1);
  await docker([...backupArgs, backupImage, "restore", "/backups/" + archives[0]]);
  const restored = await docker(["exec", database, "psql", "-U", "axis", "-d", "axis_ops_restore", "-At", "-c",
    `SELECT "consentStatus" || ':' || "language" FROM "CommunicationAddress" WHERE "normalizedEmail"='denied@axis-test.invalid'`]);
  assert.equal(restored.stdout, "DENIED:HE");
  const restoredUser = await docker(["exec", database, "psql", "-U", "axis", "-d", "axis_ops_restore", "-At", "-c",
    `SELECT id FROM "User" WHERE email='operations@axis-test.invalid'`]);
  assert.equal(restoredUser.stdout, userId);
  assert.notEqual((await docker([...backupArgs, backupImage, "restore", "/backups/" + archives[0]], true)).code, 0);
  await docker([...backupArgs, backupImage, "prune"]);
  assert.equal(readdirSync(backups).filter(name => name.endsWith(".enc")).length, 1);
  log("encrypted backup restores identity and denied consent; occupied target is refused");
  console.log(JSON.stringify({ event: "operations_smoke_completed" }));
} catch (error) {
  // These are isolated synthetic instances, never operational app logs.
  for (const name of apps.filter(name => owned.includes(name))) {
    const logs = await docker(["logs", "--tail", "25", name], true);
    console.error(logs.stdout + logs.diagnostics);
  }
  throw error;
} finally {
  // Only exact, random names owned by this run. No prune, operational container or volume.
  for (const name of owned.reverse()) await docker(["rm", "-f", "-v", name], true);
  if (networkCreated) await docker(["network", "rm", network], true);
  const target = realpathSync(fixtures);
  const within = relative(workspace, target);
  if (isAbsolute(within) || within.startsWith("..") || target !== resolve(workspace, "var", `ops-smoke-${suffix}`))
    throw new Error("Refusing cleanup outside the owned fixture directory.");
  rmSync(target, { recursive: true });
}
