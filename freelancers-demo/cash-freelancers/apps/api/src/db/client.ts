import { Pool } from "pg";
import { databaseUrl } from "../config.js";

export const db = new Pool({
  connectionString: databaseUrl
});

/**
 * Verifies the database is reachable and is a PostgreSQL server we can talk
 * to. Called during API startup so a misconfigured DATABASE_URL fails loudly
 * and immediately instead of surfacing as a 500 on whichever route happens to
 * hit the database first.
 */
export async function assertDatabaseReachable(): Promise<void> {
  try {
    await db.query("SELECT 1");
  } catch (err) {
    throw new Error(
      `Cannot reach the database at the configured DATABASE_URL.\n${(err as Error).message}`
    );
  }
}
