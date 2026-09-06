import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, rmdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("retention is a preview by default, preserves newest two and ignores unrelated files", () => {
  const dir = mkdtempSync(join(tmpdir(), "axis-retention-test-"));
  const archives = [];
  const script = resolve(import.meta.dirname, "database-backup.mjs");
  const run = (...args) => spawnSync(process.execPath, [script, "prune", ...args], {
    encoding: "utf8", windowsHide: true,
    env: { ...process.env, BACKUP_DIR: dir, BACKUP_RETENTION_DAYS: "1" },
  });
  try {
    for (let i = 0; i < 4; i++) {
      const path = join(dir, `axis-20260901T000000000Z-${randomUUID()}.enc`);
      archives.push(path);
      writeFileSync(path, "synthetic retention fixture");
      writeFileSync(path + ".json", "{}");
      const age = new Date(Date.now() - (10 - i) * 86400000);
      utimesSync(path, age, age);
    }
    writeFileSync(join(dir, "unrelated.txt"), "keep");
    const preview = run();
    assert.equal(preview.status, 0);
    assert.deepEqual(JSON.parse(preview.stdout), { event: "retention_preview", count: 2 });
    assert.equal(readdirSync(dir).length, 9);
    const applied = run("--apply");
    assert.equal(applied.status, 0);
    assert.deepEqual(JSON.parse(applied.stdout), { event: "backups_pruned", count: 2 });
    assert.deepEqual(readdirSync(dir).sort(), [
      ...archives.slice(2).flatMap(path => [path.split(/[\\/]/).at(-1), path.split(/[\\/]/).at(-1) + ".json"]),
      "unrelated.txt",
    ].sort());
    writeFileSync(join(dir, ".axis-backup.lock"), "");
    assert.notEqual(run("--apply").status, 0);
    assert.equal(readdirSync(dir).length, 6);
  } finally {
    for (const name of readdirSync(dir)) rmSync(join(dir, name));
    rmdirSync(dir);
  }
});
