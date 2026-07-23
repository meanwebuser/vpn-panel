import { loadAppConfig } from "../config.js";
import { createPool } from "../db.js";
import { loadSecureConfig } from "../secure-config.js";
import { bootstrapAdmin, runMigrations, syncCatalogFromSecureConfig } from "../migrations.js";

const config = loadAppConfig();
const pool = createPool(config);

try {
  const secure = await loadSecureConfig(config.secureConfigPath);
  await runMigrations(pool);
  await bootstrapAdmin(pool, config);
  await syncCatalogFromSecureConfig(pool, secure);
  console.log("migrations complete");
} finally {
  await pool.end();
}
