import { test } from "node:test";
import assert from "node:assert/strict";
import { workerConfiguration, tick } from "./worker.mjs";
test("worker sends a dedicated bearer secret only to the configured endpoint and refuses redirects", async () => {
  const config = workerConfiguration({ SCHEDULER_URL: "http://app:3000/api/internal/jobs/tick", SCHEDULER_TRIGGER_SECRET: "a".repeat(40) });
  assert.equal(await tick(config, async (url, options) => {
    assert.equal(url, config.url); assert.equal(options.redirect, "error"); assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer " + config.secret);
    return Response.json({ status: "processed" });
  }), "processed");
  await assert.rejects(tick(config, async () => new Response(null, { status: 401 })));
});
test("worker refuses weak secrets, credential URLs, arbitrary paths and remote cleartext", () => {
  for (const SCHEDULER_URL of ["http://outside.example/api/internal/jobs/tick", "https://secret@example.com/api/internal/jobs/tick",
    "https://example.com/api/internal/jobs/tick?secret=x", "https://example.com/other"])
    assert.throws(() => workerConfiguration({ SCHEDULER_URL, SCHEDULER_TRIGGER_SECRET: "a".repeat(40) }));
  assert.throws(() => workerConfiguration({ SCHEDULER_TRIGGER_SECRET: "short" }));
});
