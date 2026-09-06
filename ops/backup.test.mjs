import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { assertRestoreTarget, databaseTarget, decryptArchive, encryptArchive } from "./backup-lib.mjs";

test("encrypted archives round-trip and tampering is refused before restore", async () => {
  const dir = mkdtempSync(join(tmpdir(), "axis-encryption-test-"));
  const archive = join(dir,"fixture.enc");
  const plain = join(dir,"fixture.dump");
  const key = randomBytes(32);
  const data = Buffer.from("synthetic backup content only");
  try {
    await encryptArchive(Readable.from(data), archive, key);
    assert.equal(readFileSync(archive).includes(data),false);
    await decryptArchive(archive,plain,key);
    assert.deepEqual(readFileSync(plain),data);
    rmSync(plain);
    await assert.rejects(decryptArchive(archive,plain,randomBytes(32)));
    rmSync(plain);
    const modified = readFileSync(archive);
    modified[25] ^= 1;
    writeFileSync(archive,modified);
    await assert.rejects(decryptArchive(archive,plain,key));
  } finally {
    for (const file of [archive,plain]) rmSync(file,{force:true});
    rmdirSync(dir);
  }
});
test("restore cannot target the source, operational database or an unconfirmed name", () => {
  const target = databaseTarget("postgresql://axis:synthetic@localhost/axis_drill_restore?sslmode=disable");
  assert.doesNotThrow(() => assertRestoreTarget(target,"axis_drill_test","axis_drill_restore"));
  assert.throws(() => assertRestoreTarget(target,"axis_drill_restore","axis_drill_restore"));
  assert.throws(() => assertRestoreTarget(target,"axis_drill_test",""));
  assert.throws(() => assertRestoreTarget({...target,database:"axis_ccp_dev"},"axis_drill_test","axis_ccp_dev"));
});
test("database URLs refuse non-postgres, schema changes and hidden connection overrides", () => {
  for (const value of ["https://db/axis","postgresql://axis:pw@db/axis?host=elsewhere",
    "postgresql://axis:pw@db/axis?schema=other","postgresql://axis:pw%0A@db/axis"])
    assert.throws(() => databaseTarget(value));
});

