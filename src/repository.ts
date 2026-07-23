import { randomBytes } from "node:crypto";
import type { DbPool } from "./db.js";
import type { Account, ClientRecord, Endpoint } from "./types.js";
import { hashPassword } from "./passwords.js";
import { randomToken } from "./tokens.js";


export type SmartDnsClient = {
  account_id: string;
  client_id: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type UserSummary = {
  account_id: string;
  login: string;
  display_name: string;
  enabled: boolean;
  client_id: string;
  xray_uuid: string;
  client_enabled: boolean;
  token: string | null;
  profiles: string[];
  device_count: number;
  happ_status: number | null;
  smart_dns_client_id: string | null;
  smart_dns_enabled: boolean | null;
};

export async function listUsers(pool: DbPool): Promise<UserSummary[]> {
  const result = await pool.query<UserSummary>(
    `select
       a.id::text as account_id,
       a.login,
       a.display_name,
       a.enabled,
       vc.id::text as client_id,
       vc.xray_uuid::text as xray_uuid,
       vc.enabled as client_enabled,
       (
         select st.token from subscription_tokens st
         where st.client_id = vc.id and st.enabled = true
         order by st.created_at desc limit 1
       ) as token,
       coalesce(array_agg(cp.endpoint_id order by e.sort_order) filter (where cp.endpoint_id is not null), '{}') as profiles,
       (
         select count(*)::int from happ_hwids hw where hw.account_id = a.id
       ) as device_count,
       (
         select hi.status from happ_installs hi where hi.account_id = a.id
       ) as happ_status,
       sdc.client_id as smart_dns_client_id,
       sdc.enabled as smart_dns_enabled
     from accounts a
     join vpn_clients vc on vc.account_id = a.id
     left join client_profiles cp on cp.client_id = vc.id
     left join endpoints e on e.id = cp.endpoint_id
     left join smart_dns_clients sdc on sdc.account_id = a.id
     where a.role = 'user'
     group by a.id, vc.id, sdc.client_id, sdc.enabled
     order by a.created_at desc`,
  );
  return result.rows;
}

export async function getUser(pool: DbPool, accountId: string): Promise<UserSummary | null> {
  const result = await pool.query<UserSummary>(
    `select
       a.id::text as account_id,
       a.login,
       a.display_name,
       a.enabled,
       vc.id::text as client_id,
       vc.xray_uuid::text as xray_uuid,
       vc.enabled as client_enabled,
       (
         select st.token from subscription_tokens st
         where st.client_id = vc.id and st.enabled = true
         order by st.created_at desc limit 1
       ) as token,
       coalesce(array_agg(cp.endpoint_id order by e.sort_order) filter (where cp.endpoint_id is not null), '{}') as profiles,
       (
         select count(*)::int from happ_hwids hw where hw.account_id = a.id
       ) as device_count,
       (
         select hi.status from happ_installs hi where hi.account_id = a.id
       ) as happ_status,
       sdc.client_id as smart_dns_client_id,
       sdc.enabled as smart_dns_enabled
     from accounts a
     join vpn_clients vc on vc.account_id = a.id
     left join client_profiles cp on cp.client_id = vc.id
     left join endpoints e on e.id = cp.endpoint_id
     left join smart_dns_clients sdc on sdc.account_id = a.id
     where a.id = $1 and a.role = 'user'
     group by a.id, vc.id, sdc.client_id, sdc.enabled`,
    [accountId],
  );
  return result.rows[0] || null;
}

export async function listEndpoints(pool: DbPool): Promise<Endpoint[]> {
  const result = await pool.query<Endpoint>(
    `select id, label, kind, address, port, profile_id, enabled, sort_order, config
     from endpoints order by sort_order, id`,
  );
  return result.rows;
}

export async function createUser(
  pool: DbPool,
  input: {
    login: string;
    displayName: string;
    password: string;
    xrayUuid: string;
    endpointIds: string[];
  },
): Promise<string> {
  return pool.connect().then(async (client) => {
    try {
      await client.query("begin");
      const account = await client.query<{ id: string }>(
        `insert into accounts (login, display_name, password_hash, role)
         values ($1, $2, $3, 'user') returning id::text`,
        [input.login, input.displayName, await hashPassword(input.password)],
      );
      const accountId = account.rows[0].id;
      const vpnClient = await client.query<{ id: string }>(
        `insert into vpn_clients (account_id, xray_uuid) values ($1, $2) returning id::text`,
        [accountId, input.xrayUuid],
      );
      const clientId = vpnClient.rows[0].id;
      await client.query("insert into subscription_tokens (client_id, token) values ($1, $2)", [
        clientId,
        randomToken(),
      ]);
      for (const endpointId of input.endpointIds) {
        await client.query(
          `insert into client_profiles (client_id, endpoint_id)
           values ($1, $2) on conflict do nothing`,
          [clientId, endpointId],
        );
      }
      await client.query("commit");
      return accountId;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  });
}

export async function updateUser(
  pool: DbPool,
  accountId: string,
  input: {
    login?: string;
    displayName?: string;
    password?: string;
    enabled?: boolean;
    endpointIds?: string[];
  },
): Promise<void> {
  await pool.connect().then(async (client) => {
    try {
      await client.query("begin");
      if (input.login || input.displayName || input.password || input.enabled !== undefined) {
        const passwordHash = input.password ? await hashPassword(input.password) : null;
        await client.query(
          `update accounts set
             login = coalesce($2, login),
             display_name = coalesce($3, display_name),
             password_hash = coalesce($4, password_hash),
             enabled = coalesce($5, enabled),
             updated_at = now()
           where id = $1 and role = 'user'`,
          [accountId, input.login || null, input.displayName || null, passwordHash, input.enabled ?? null],
        );
      }
      if (input.enabled !== undefined) {
        await client.query("update vpn_clients set enabled = $2, updated_at = now() where account_id = $1", [
          accountId,
          input.enabled,
        ]);
      }
      if (input.endpointIds) {
        const vpnClient = await client.query<{ id: string }>(
          "select id::text from vpn_clients where account_id = $1",
          [accountId],
        );
        const clientId = vpnClient.rows[0]?.id;
        if (clientId) {
          await client.query("delete from client_profiles where client_id = $1", [clientId]);
          for (const endpointId of input.endpointIds) {
            await client.query(
              `insert into client_profiles (client_id, endpoint_id)
               values ($1, $2) on conflict do nothing`,
              [clientId, endpointId],
            );
          }
        }
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  });
}

export async function deleteUser(pool: DbPool, accountId: string): Promise<void> {
  await pool.query("delete from accounts where id = $1 and role = 'user'", [accountId]);
}

export async function rotateToken(pool: DbPool, accountId: string): Promise<string> {
  const result = await pool.query<{ id: string }>("select id::text from vpn_clients where account_id = $1", [
    accountId,
  ]);
  const clientId = result.rows[0]?.id;
  if (!clientId) {
    throw new Error("client not found");
  }
  await pool.query("update subscription_tokens set enabled = false where client_id = $1", [clientId]);
  const token = randomToken();
  await pool.query("insert into subscription_tokens (client_id, token) values ($1, $2)", [clientId, token]);
  return token;
}

export async function setUserEndpointScope(pool: DbPool, accountId: string, scope: "all" | "working"): Promise<void> {
  const endpointResult = await pool.query<{ id: string }>(
    `select e.id
     from endpoints e
     left join endpoint_health h on h.endpoint_id = e.id
     where e.enabled = true
       and (
         $1 = 'all'
         or (coalesce(h.pass_count, 0) > 0 and coalesce(h.pass_count, 0) >= coalesce(h.fail_count, 0))
       )
     order by e.sort_order, e.id`,
    [scope],
  );
  const assignedIds = endpointResult.rows.map((row) => row.id);

  const clientResult = await pool.query<{ id: string }>(
    "select id::text from vpn_clients where account_id = $1",
    [accountId],
  );
  const clientId = clientResult.rows[0]?.id;
  if (!clientId) return;

  await pool.query("delete from client_profiles where client_id = $1", [clientId]);
  if (assignedIds.length > 0) {
    const values = assignedIds.map((_, i) => `($1, $${i + 2})`).join(", ");
    await pool.query(
      `insert into client_profiles (client_id, endpoint_id) values ${values} on conflict do nothing`,
      [clientId, ...assignedIds],
    );
  }
}

export type BulkGrantResult = {
  granted: number;
  users: number;
  endpoints: number;
};

export async function grantAllEndpointsToAllUsers(pool: DbPool): Promise<BulkGrantResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("delete from client_profiles");
    const result = await client.query<{ granted: number; users: number; endpoints: number }>(`
      with inserted as (
        insert into client_profiles (client_id, endpoint_id)
        select vc.id, e.id
        from vpn_clients vc
        join accounts a on a.id = vc.account_id
        cross join endpoints e
        where a.role = 'user'
        on conflict (client_id, endpoint_id) do nothing
        returning 1
      ),
      user_count as (
        select count(distinct vc.id)::int as users
        from vpn_clients vc
        join accounts a on a.id = vc.account_id
        where a.role = 'user'
      ),
      endpoint_count as (
        select count(*)::int as endpoints from endpoints
      )
      select
        (select count(*)::int from inserted) as granted,
        (select users from user_count) as users,
        (select endpoints from endpoint_count) as endpoints;
    `);
    await client.query("commit");
    const row = result.rows[0] ?? { granted: 0, users: 0, endpoints: 0 };
    return { granted: row.granted, users: row.users, endpoints: row.endpoints };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function grantWorkingEndpointsToAllUsers(pool: DbPool): Promise<BulkGrantResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("delete from client_profiles");

    await client.query(`
      insert into client_profiles (client_id, endpoint_id)
      select vc.id, e.id
      from vpn_clients vc
      join accounts a on a.id = vc.account_id
      cross join endpoints e
      where a.role = 'user' and a.login in ('geier25', 'Nikita')
      on conflict (client_id, endpoint_id) do nothing;
    `);

    await client.query(`
      insert into client_profiles (client_id, endpoint_id)
      select vc.id, eh.endpoint_id
      from vpn_clients vc
      join accounts a on a.id = vc.account_id
      join endpoint_health eh on eh.endpoint_id = eh.endpoint_id
      where a.role = 'user'
        and a.login not in ('geier25', 'Nikita')
        and coalesce(eh.pass_count, 0) > 0
        and coalesce(eh.pass_count, 0) >= coalesce(eh.fail_count, 0)
      on conflict (client_id, endpoint_id) do nothing;
    `);

    const result = await client.query<{ granted: number; users: number; working_endpoints: number }>(`
      with inserted as (
        select 1 from client_profiles
      ),
      user_count as (
        select count(distinct vc.id)::int as users
        from vpn_clients vc
        join accounts a on a.id = vc.account_id
        where a.role = 'user'
      ),
      working_count as (
        select count(distinct endpoint_id)::int as working_endpoints
        from endpoint_health
        where coalesce(pass_count, 0) > 0
          and coalesce(pass_count, 0) >= coalesce(fail_count, 0)
      )
      select
        (select count(*)::int from client_profiles) as granted,
        (select users from user_count) as users,
        (select working_endpoints from working_count) as working_endpoints;
    `);
    await client.query("commit");
    const row = result.rows[0] ?? { granted: 0, users: 0, working_endpoints: 0 };
    return { granted: row.granted, users: row.users, endpoints: row.working_endpoints };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export type EndpointHealth = {
  endpoint_id: string;
  latency_ms: number | null;
  speed_mbps: number | null;
  exit_ip: string | null;
  pass_count: number;
  fail_count: number;
  sites: { label: string; code: string; ms: number; ok: boolean }[];
  checked_at: string;
  tested_from?: {
    node: string;    // e.g., "worker-main", "mac"
    network_ip: string; // the public IP of the test node
  };
};

export async function getEndpointHealth(pool: DbPool): Promise<EndpointHealth[]> {
  const result = await pool.query<EndpointHealth>(
    `select endpoint_id, latency_ms, speed_mbps, exit_ip, pass_count, fail_count, sites, checked_at
     from endpoint_health order by endpoint_id`,
  );
  return result.rows;
}

export async function upsertEndpointHealth(
  pool: DbPool,
  data: {
    endpointId: string;
    latencyMs: number | null;
    speedMbps: number | null;
    exitIp: string | null;
    passCount: number;
    failCount: number;
    sites: { label: string; code: string; ms: number; ok: boolean }[];
  },
): Promise<void> {
  await pool.query(
    `insert into endpoint_health (endpoint_id, latency_ms, speed_mbps, exit_ip, pass_count, fail_count, sites, checked_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (endpoint_id) do update set
       latency_ms = excluded.latency_ms,
       speed_mbps = excluded.speed_mbps,
       exit_ip = excluded.exit_ip,
       pass_count = excluded.pass_count,
       fail_count = excluded.fail_count,
       sites = excluded.sites,
       checked_at = now()`,
    [data.endpointId, data.latencyMs, data.speedMbps, data.exitIp, data.passCount, data.failCount, JSON.stringify(data.sites)],
  );
}

export async function getAccountWithClient(pool: DbPool, accountId: string): Promise<{
  account: Account;
  client: ClientRecord;
  token: string | null;
} | null> {
  const result = await pool.query<
    Account & {
      client_id: string;
      account_id: string;
      xray_uuid: string;
      client_enabled: boolean;
      token: string | null;
    }
  >(
    `select
       a.id::text,
       a.login,
       a.display_name,
       a.password_hash,
       a.role,
       a.enabled,
       vc.id::text as client_id,
       vc.account_id::text,
       vc.xray_uuid::text,
       vc.enabled as client_enabled,
       (
         select st.token from subscription_tokens st
         where st.client_id = vc.id and st.enabled = true
         order by st.created_at desc limit 1
       ) as token
     from accounts a
     join vpn_clients vc on vc.account_id = a.id
     where a.id = $1`,
    [accountId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    account: row,
    client: {
      id: row.client_id,
      account_id: row.account_id,
      xray_uuid: row.xray_uuid,
      enabled: row.client_enabled,
    },
    token: row.token,
  };
}

// ─── Happ install management ────────────────────────────────────────

export type HappInstallRecord = {
  account_id: string;
  install_code: string;
  install_id: number | null;
  install_limit: number;
  status: number;
  note: string | null;
  happ_settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export async function getHappInstall(pool: DbPool, accountId: string): Promise<HappInstallRecord | null> {
  const result = await pool.query<HappInstallRecord>(
    `select account_id::text, install_code, install_id, install_limit, status, note, happ_settings, created_at, updated_at
     from happ_installs where account_id = $1`,
    [accountId],
  );
  return result.rows[0] || null;
}

export async function getAllHappInstalls(pool: DbPool): Promise<HappInstallRecord[]> {
  const result = await pool.query<HappInstallRecord>(
    `select account_id::text, install_code, install_id, install_limit, status, note, happ_settings, created_at, updated_at
     from happ_installs order by created_at`,
  );
  return result.rows;
}

export async function upsertHappInstall(
  pool: DbPool,
  data: {
    accountId: string;
    installCode: string;
    installId?: number;
    installLimit?: number;
    note?: string;
  },
): Promise<void> {
  await pool.query(
    `insert into happ_installs (account_id, install_code, install_id, install_limit, note, updated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (account_id) do update set
       install_code = excluded.install_code,
       install_id = coalesce(excluded.install_id, happ_installs.install_id),
       install_limit = coalesce(excluded.install_limit, happ_installs.install_limit),
       note = coalesce(excluded.note, happ_installs.note),
       updated_at = now()`,
    [data.accountId, data.installCode, data.installId ?? null, data.installLimit ?? 10, data.note ?? null],
  );
}

export async function updateHappSettings(
  pool: DbPool,
  accountId: string,
  settings: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `update happ_installs set happ_settings = $2, updated_at = now() where account_id = $1`,
    [accountId, JSON.stringify(settings)],
  );
}

export async function updateHappInstallStatus(pool: DbPool, accountId: string, status: number): Promise<void> {
  await pool.query(
    `update happ_installs set status = $2, updated_at = now() where account_id = $1`,
    [accountId, status],
  );
}

export async function deleteHappInstall(pool: DbPool, accountId: string): Promise<void> {
  await pool.query("delete from happ_installs where account_id = $1", [accountId]);
}

// ─── Happ HWID management ───────────────────────────────────────────

export type HappHwidRecord = {
  id: string;
  account_id: string;
  install_code: string;
  hwid: string;
  device_name: string | null;
  device_model: string | null;
  os_version: string | null;
  app_version: string | null;
  recorded_at: string;
  last_seen_at: string;
};

export async function getHwidsForAccount(pool: DbPool, accountId: string): Promise<HappHwidRecord[]> {
  const result = await pool.query<HappHwidRecord>(
    `select id::text, account_id::text, install_code, hwid, device_name, device_model, os_version, app_version, recorded_at, last_seen_at
     from happ_hwids where account_id = $1 order by last_seen_at desc`,
    [accountId],
  );
  return result.rows;
}

export async function upsertHwid(
  pool: DbPool,
  data: {
    accountId: string;
    installCode: string;
    hwid: string;
    deviceName?: string;
    deviceModel?: string;
    osVersion?: string;
    appVersion?: string;
  },
): Promise<void> {
  await pool.query(
    `insert into happ_hwids (account_id, install_code, hwid, device_name, device_model, os_version, app_version, last_seen_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (install_code, hwid) do update set
       device_name = coalesce(excluded.device_name, happ_hwids.device_name),
       device_model = coalesce(excluded.device_model, happ_hwids.device_model),
       os_version = coalesce(excluded.os_version, happ_hwids.os_version),
       app_version = coalesce(excluded.app_version, happ_hwids.app_version),
       last_seen_at = now()`,
    [data.accountId, data.installCode, data.hwid, data.deviceName ?? null, data.deviceModel ?? null, data.osVersion ?? null, data.appVersion ?? null],
  );
}

export async function deleteHwid(pool: DbPool, hwidId: string): Promise<void> {
  await pool.query("delete from happ_hwids where id = $1", [hwidId]);
}

export async function syncHwidsFromHapp(
  pool: DbPool,
  accountId: string,
  installCode: string,
  hwids: { hwid: string; device_name: string }[],
): Promise<void> {
  for (const hwid of hwids) {
    await upsertHwid(pool, {
      accountId,
      installCode,
      hwid: hwid.hwid,
      deviceName: hwid.device_name,
    });
  }
}

// ─── Auto-capture HWID from subscription request headers ────────────

export async function captureHwidFromSubscription(
  pool: DbPool,
  accountId: string,
  headers: { hwid?: string; 'device-name'?: string; 'device-model'?: string; 'os-version'?: string; 'app-version'?: string },
): Promise<void> {
  const hwidValue = headers.hwid;
  if (!hwidValue) return;

  // Find the happ install for this account
  const install = await getHappInstall(pool, accountId);
  if (!install) return;

  await upsertHwid(pool, {
    accountId,
    installCode: install.install_code,
    hwid: hwidValue,
    deviceName: headers['device-name'],
    deviceModel: headers['device-model'],
    osVersion: headers['os-version'],
    appVersion: headers['app-version'],
  });
}

export async function countAllDevices(pool: DbPool): Promise<number> {
  const result = await pool.query<{ count: string }>('select count(*)::text as count from happ_hwids');
  return parseInt(result.rows[0]?.count || '0');
}

export function generateSmartDnsClientId(): string {
  return randomBytes(24).toString("hex");
}

export async function getSmartDnsClient(pool: DbPool, accountId: string): Promise<SmartDnsClient | null> {
  const result = await pool.query<SmartDnsClient>(
    `select account_id::text, client_id, enabled, created_at::text, updated_at::text
     from smart_dns_clients where account_id = $1`,
    [accountId],
  );
  return result.rows[0] || null;
}

export async function listSmartDnsClients(pool: DbPool): Promise<SmartDnsClient[]> {
  const result = await pool.query<SmartDnsClient>(
    `select account_id::text, client_id, enabled, created_at::text, updated_at::text
     from smart_dns_clients order by updated_at desc`,
  );
  return result.rows;
}

export async function ensureSmartDnsClient(pool: DbPool, accountId: string): Promise<SmartDnsClient> {
  const clientId = generateSmartDnsClientId();
  const result = await pool.query<SmartDnsClient>(
    `insert into smart_dns_clients (account_id, client_id, enabled, updated_at)
     values ($1, $2, true, now())
     on conflict (account_id) do update set
       client_id = excluded.client_id,
       enabled = true,
       updated_at = now()
     returning account_id::text, client_id, enabled, created_at::text, updated_at::text`,
    [accountId, clientId],
  );
  return result.rows[0];
}

export async function setSmartDnsClientEnabled(
  pool: DbPool,
  accountId: string,
  enabled: boolean,
): Promise<SmartDnsClient | null> {
  const result = await pool.query<SmartDnsClient>(
    `update smart_dns_clients set enabled = $2, updated_at = now()
     where account_id = $1
     returning account_id::text, client_id, enabled, created_at::text, updated_at::text`,
    [accountId, enabled],
  );
  return result.rows[0] || null;
}

export type SmartDnsRuntimeClient = {
  account_id: string;
  login: string;
  display_name: string;
  client_id: string;
  enabled: boolean;
};

export async function listEnabledSmartDnsRuntimeClients(pool: DbPool): Promise<SmartDnsRuntimeClient[]> {
  const result = await pool.query<SmartDnsRuntimeClient>(
    `select
       sdc.account_id::text,
       a.login,
       a.display_name,
       sdc.client_id,
       (sdc.enabled and a.enabled and vc.enabled) as enabled
     from smart_dns_clients sdc
     join accounts a on a.id = sdc.account_id
     join vpn_clients vc on vc.account_id = a.id
     where a.role = 'user' and sdc.enabled = true and a.enabled = true and vc.enabled = true
     order by a.created_at desc`,
  );
  return result.rows;
}
