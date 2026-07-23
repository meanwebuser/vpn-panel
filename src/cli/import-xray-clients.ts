import { readFile } from "node:fs/promises";
import { loadAppConfig } from "../config.js";
import { createPool } from "../db.js";
import { listEndpoints } from "../repository.js";
import { hashPassword } from "../passwords.js";
import { randomPassword, randomToken } from "../tokens.js";

type XrayClient = {
  id?: string;
  email?: string;
  flow?: string;
};

function clientsFromConfig(data: Record<string, unknown>): XrayClient[] {
  const inbounds = Array.isArray(data.inbounds) ? data.inbounds : [];
  const clients: XrayClient[] = [];
  for (const inbound of inbounds) {
    if (!inbound || typeof inbound !== "object") continue;
    const settings = (inbound as Record<string, unknown>).settings;
    if (!settings || typeof settings !== "object") continue;
    const inboundClients = (settings as Record<string, unknown>).clients;
    if (Array.isArray(inboundClients)) {
      clients.push(...(inboundClients as XrayClient[]));
    }
  }
  return clients.filter((client) => typeof client.id === "string" && client.id.length > 0);
}

function loginFor(client: XrayClient, index: number): string {
  if (client.email) {
    return client.email
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
  }
  return `vpn2-${String(index + 1).padStart(2, "0")}`;
}

const xrayConfigPath = process.argv[2];
if (!xrayConfigPath) {
  throw new Error("usage: npm run import:xray -- /path/to/xray-config.json");
}

const config = loadAppConfig();
const pool = createPool(config);

try {
  const raw = await readFile(xrayConfigPath, "utf8");
  const clients = clientsFromConfig(JSON.parse(raw));
  const endpoints = await listEndpoints(pool);
  const endpointIds = endpoints.map((endpoint) => endpoint.id);
  const imported: Array<{ login: string; password: string; uuid: string; created: boolean }> = [];

  for (const [index, client] of clients.entries()) {
    const uuid = client.id as string;
    const existing = await pool.query("select id from vpn_clients where xray_uuid = $1", [uuid]);
    if (existing.rowCount && existing.rowCount > 0) {
      imported.push({ login: loginFor(client, index), password: "(existing)", uuid, created: false });
      continue;
    }

    const password = randomPassword();
    await pool.connect().then(async (db) => {
      try {
        await db.query("begin");
        let login = loginFor(client, index);
        const loginTaken = await db.query("select id from accounts where login = $1", [login]);
        if (loginTaken.rowCount && loginTaken.rowCount > 0) {
          login = `${login}-${String(index + 1).padStart(2, "0")}`;
        }
        const account = await db.query<{ id: string }>(
          `insert into accounts (login, display_name, password_hash, role)
           values ($1, $2, $3, 'user') returning id::text`,
          [login, login, await hashPassword(password)],
        );
        const vpnClient = await db.query<{ id: string }>(
          `insert into vpn_clients (account_id, xray_uuid) values ($1, $2) returning id::text`,
          [account.rows[0].id, uuid],
        );
        await db.query("insert into subscription_tokens (client_id, token) values ($1, $2)", [
          vpnClient.rows[0].id,
          randomToken(),
        ]);
        for (const endpointId of endpointIds) {
          await db.query("insert into client_profiles (client_id, endpoint_id) values ($1, $2)", [
            vpnClient.rows[0].id,
            endpointId,
          ]);
        }
        await db.query("commit");
        imported.push({ login, password, uuid, created: true });
      } catch (error) {
        await db.query("rollback");
        throw error;
      } finally {
        db.release();
      }
    });
  }

  console.log(JSON.stringify({ count: imported.length, users: imported }, null, 2));
} finally {
  await pool.end();
}
