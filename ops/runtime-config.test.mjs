import { test } from "node:test";
import assert from "node:assert/strict";
import { validateHostedConfig } from "./runtime-config.mjs";
const base = {
  DATABASE_URL: "postgresql://axis:synthetic@db/axis_staging",
  AUTH_SECRET: "a".repeat(64), AUTH_URL: "https://axis.example.com",
  PUBLIC_APP_URL: "https://axis.example.com", MEDIA_PROVIDER: "cloudinary",
  CLOUDINARY_URL: "cloudinary://synthetic:synthetic@fixture",
};
test("valid hosted configuration is independent of provider activation", () => {
  assert.deepEqual(validateHostedConfig(base), []);
});
test("all unreviewed delivery activation paths are refused", () => {
  for (const key of ["PRODUCTION_DELIVERY_ENABLED", "PROVIDER_PILOT_ENABLED", "QA_EMAIL_ENABLED"])
    assert.ok(validateHostedConfig({ ...base, [key]: "true" }).some(e => e.includes(key)));
});
test("a coherent operator release is accepted while partial release remains refused", () => {
  const release = { ...base, AXIS_DELIVERY_RELEASE_APPROVED: "true", PRODUCTION_DELIVERY_ENABLED: "true", SEND_MODE: "PRODUCTION",
    PRODUCTION_DOMAIN_REVIEW_CONFIRMED: "true", PRODUCTION_EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_synthetic_configuration",
    RESEND_WEBHOOK_SECRET: "whsec_synthetic_configuration", SCHEDULER_ENABLED: "true", SCHEDULER_TRIGGER_SECRET: "s".repeat(40) };
  assert.deepEqual(validateHostedConfig(release), []);
  for (const key of ["PRODUCTION_DELIVERY_ENABLED", "PRODUCTION_DOMAIN_REVIEW_CONFIRMED", "SCHEDULER_ENABLED"])
    assert.ok(validateHostedConfig({ ...release, [key]: "false" }).length);
});
test("HTTP escape requires a test database and no live adapters", () => {
  const smoke = { ...base, DATABASE_URL: "postgresql://axis:synthetic@db/axis_smoke_test",
    CLOUDINARY_URL: "", MEDIA_PROVIDER: "local", AXIS_ALLOW_INSECURE_TEST_HTTP: "true",
    AUTH_URL: "http://127.0.0.1:3199", PUBLIC_APP_URL: "http://127.0.0.1:3199" };
  assert.deepEqual(validateHostedConfig(smoke), []);
  for (const name of ["MONDAY_API_TOKEN", "RESEND_API_KEY", "GMAIL_APP_PASSWORD", "CLOUDINARY_URL"])
    assert.ok(validateHostedConfig({ ...smoke, [name]: "synthetic" }).length);
  assert.ok(validateHostedConfig({ ...smoke, DATABASE_URL: base.DATABASE_URL }).length);
});
test("invalid origin, pool values, local media and weak secrets fail clearly", () => {
  for (const patch of [{AUTH_URL:"https://user:secret@axis.example.com"}, {DB_POOL_MAX:"0"},
    {DB_POOL_MAX:"2.5"}, {AUTH_SECRET:"short"}, {MEDIA_PROVIDER:"local"},
    {NEXTAUTH_URL:"https://other.example.com"}, {PUBLIC_APP_URL:"https://axis.example.com/path"}])
    assert.ok(validateHostedConfig({...base,...patch}).length);
});
