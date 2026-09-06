export interface AppliedMigration {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

/** Extra completed migrations permit an older, schema-compatible image during rollback. */
export function migrationsReady(
  expected: readonly { name: string; checksum: string; windowsChecksum?: string }[],
  applied: readonly AppliedMigration[],
): boolean {
  const active = applied.filter(row => !row.rolled_back_at);
  if (!expected.length || active.some(row => !row.finished_at)) return false;
  return expected.every(migration => active.some(row =>
    row.migration_name === migration.name &&
    (row.checksum === migration.checksum || row.checksum === migration.windowsChecksum) && row.finished_at,
  ));
}
