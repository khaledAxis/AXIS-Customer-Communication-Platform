import { describe, it, expect } from "vitest";
import { databasePoolSettings } from "./poolSettings";
import { migrationsReady } from "./migrationReadiness";

describe("operation bounds", () => {
  it("rejects connection settings that would remove bounds", () => {
    expect(databasePoolSettings({}).max).toBe(10);
    for (const value of ["0", "-1", "10000", "NaN", "1.5"])
      expect(() => databasePoolSettings({ DB_POOL_MAX: value })).toThrow();
  });
  it("requires all migration checksums and refuses unfinished work", () => {
    const expected = [{ name: "init", checksum: "a", windowsChecksum: "b" }];
    const row = { migration_name: "init", checksum: "a", finished_at: new Date(), rolled_back_at: null };
    expect(migrationsReady(expected, [row])).toBe(true);
    expect(migrationsReady(expected, [{ ...row, checksum: "b" }])).toBe(true);
    expect(migrationsReady(expected, [])).toBe(false);
    expect(migrationsReady(expected, [{ ...row, checksum: "changed" }])).toBe(false);
    expect(migrationsReady(expected, [{ ...row, finished_at: null }])).toBe(false);
    expect(migrationsReady(expected, [{ ...row, rolled_back_at: new Date() }])).toBe(false);
    expect(migrationsReady(expected, [row, { ...row, migration_name: "pending", finished_at: null }])).toBe(false);
  });
});

