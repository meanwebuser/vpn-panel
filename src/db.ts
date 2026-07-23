import pg from "pg";
import type { AppConfig } from "./config.js";

const { Pool } = pg;

export type DbPool = pg.Pool;

export function createPool(config: Pick<AppConfig, "databaseUrl">): DbPool {
  return new Pool({
    connectionString: config.databaseUrl,
    max: 10,
  });
}
