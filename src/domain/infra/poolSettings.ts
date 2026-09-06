/** Per-replica bounds. Total DB demand is replica count × pool size, plus operators. */
export function databasePoolSettings(env: Record<string, string | undefined>) {
  function integer(name: string, fallback: number, max: number) {
    const value = env[name];
    if (value === undefined || value === "") return fallback;
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) {
      throw new Error(`${name} must be an integer between 1 and ${max}.`);
    }
    return Number(value);
  }
  return {
    max: integer("DB_POOL_MAX", 10, 100),
    connectionTimeoutMillis: integer("DB_CONNECT_TIMEOUT_MS", 5000, 30000),
    idleTimeoutMillis: 30000,
    statement_timeout: integer("DB_STATEMENT_TIMEOUT_MS", 30000, 120000),
  };
}
