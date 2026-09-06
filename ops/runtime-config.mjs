import { readFileSync } from "node:fs";

const SECRET_NAMES = ["DATABASE_URL", "AUTH_SECRET", "CLOUDINARY_URL", "MONDAY_API_TOKEN",
  "GMAIL_APP_PASSWORD", "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET", "SCHEDULER_TRIGGER_SECRET", "MONDAY_SIGNING_SECRET"];

/** File-mounted secrets take precedence only when no competing env value is present. */
export function loadSecretFiles(env) {
  for (const name of SECRET_NAMES) {
    if (!env[name + "_FILE"]) continue;
    if (env[name]) throw new Error(name + " has both a value and a secret file.");
    try {
      const value = readFileSync(env[name + "_FILE"], "utf8").trim();
      if (!value || value.length > 16384) throw new Error();
      env[name] = value;
    } catch { throw new Error("Cannot read " + name + " secret file."); }
  }
  return env;
}

export function validateHostedConfig(env) {
  const errors = [];
  let database;
  let auth;
  let publicUrl;
  try {
    database = new URL(env.DATABASE_URL);
    if (!["postgres:", "postgresql:"].includes(database.protocol) || !database.hostname ||
        !/^\/[a-zA-Z0-9_]+$/.test(database.pathname) || database.hash) throw new Error();
  } catch { errors.push("DATABASE_URL must identify one PostgreSQL database."); }
  try { auth = new URL(env.AUTH_URL); } catch { errors.push("AUTH_URL is required."); }
  try { publicUrl = new URL(env.PUBLIC_APP_URL); } catch { errors.push("PUBLIC_APP_URL is required."); }
  const smoke = env.AXIS_ALLOW_INSECURE_TEST_HTTP === "true" &&
    database?.pathname.endsWith("_test") &&
    [env.GMAIL_APP_PASSWORD, env.RESEND_API_KEY, env.MONDAY_API_TOKEN, env.CLOUDINARY_URL].every(v => !v);
  if (env.AXIS_ALLOW_INSECURE_TEST_HTTP === "true" && !smoke)
    errors.push("Insecure HTTP is restricted to isolated test databases with all live adapters unconfigured.");
  for (const [name, url] of [["AUTH_URL", auth], ["PUBLIC_APP_URL", publicUrl]]) {
    if (!url) continue;
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
      errors.push(name + " must be a credential-free origin.");
    if (url.protocol !== "https:" && !(smoke && url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
      errors.push(name + " must use HTTPS.");
  }
  if (auth && publicUrl && auth.origin !== publicUrl.origin)
    errors.push("AUTH_URL and PUBLIC_APP_URL must use the same origin for this deployment.");
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32 || /change.?me|placeholder/i.test(env.AUTH_SECRET))
    errors.push("AUTH_SECRET must be a strong secret of at least 32 characters.");
  if (env.NEXTAUTH_URL && env.NEXTAUTH_URL !== env.AUTH_URL)
    errors.push("NEXTAUTH_URL must match AUTH_URL.");
  const release = env.AXIS_DELIVERY_RELEASE_APPROVED === "true";
  for (const name of ["PROVIDER_PILOT_ENABLED", "QA_EMAIL_ENABLED"]) {
    if (env[name] && env[name] !== "false") errors.push(name + " must remain false in the hosted baseline.");
  }
  if (!release && env.PRODUCTION_DELIVERY_ENABLED && env.PRODUCTION_DELIVERY_ENABLED !== "false")
    errors.push("PRODUCTION_DELIVERY_ENABLED requires an explicit operator release.");
  if (!release && env.SEND_MODE && env.SEND_MODE !== "TEST") errors.push("SEND_MODE must remain TEST without an operator release.");
  if (release && (smoke || env.PRODUCTION_DELIVERY_ENABLED !== "true" || env.SEND_MODE !== "PRODUCTION" ||
      env.PRODUCTION_DOMAIN_REVIEW_CONFIRMED !== "true" || env.PRODUCTION_EMAIL_PROVIDER !== "resend" ||
      !env.RESEND_API_KEY?.startsWith("re_") || !env.RESEND_WEBHOOK_SECRET?.startsWith("whsec_") || env.SCHEDULER_ENABLED !== "true"))
    errors.push("Customer release requires production mode, reviewed domain, Resend, signed webhooks and scheduler configuration on HTTPS.");
  if (env.SCHEDULER_ENABLED === "true" && (env.SCHEDULER_TRIGGER_SECRET?.length ?? 0) < 32)
    errors.push("SCHEDULER_TRIGGER_SECRET must contain at least 32 characters.");
  if (env.MONDAY_WEBHOOK_ENABLED === "true" && ((env.MONDAY_SIGNING_SECRET?.length ?? 0) < 32 || !/^\d+$/.test(env.MONDAY_ACCOUNT_ID ?? "")))
    errors.push("Monday signed webhooks require the app signing secret and account id.");
  if (!smoke && (env.MEDIA_PROVIDER !== "cloudinary" || !env.CLOUDINARY_URL))
    errors.push("Hosted replicas require MEDIA_PROVIDER=cloudinary and CLOUDINARY_URL.");
  for (const [name, fallback, max] of [["DB_POOL_MAX", 10, 100], ["DB_CONNECT_TIMEOUT_MS", 5000, 30000],
    ["DB_STATEMENT_TIMEOUT_MS", 30000, 120000]]) {
    const value = env[name] ?? String(fallback);
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max)
      errors.push(name + " is outside its supported range.");
  }
  return errors;
}
