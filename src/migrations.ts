import type { DbPool } from "./db.js";
import { hashPassword } from "./passwords.js";
import type { AppConfig } from "./config.js";
import type { SecureConfig } from "./secure-config.js";
import { endpointProfile } from "./secure-config.js";

export async function runMigrations(pool: DbPool): Promise<void> {
  await pool.query(`
    create table if not exists schema_migrations (
      id integer primary key,
      applied_at timestamptz not null default now()
    );
  `);

  await pool.query(`
    create table if not exists accounts (
      id bigserial primary key,
      login text not null unique,
      display_name text not null,
      password_hash text not null,
      role text not null check (role in ('admin', 'user')),
      enabled boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists vpn_clients (
      id bigserial primary key,
      account_id bigint not null unique references accounts(id) on delete cascade,
      xray_uuid uuid not null unique,
      enabled boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists subscription_tokens (
      id bigserial primary key,
      client_id bigint not null references vpn_clients(id) on delete cascade,
      token text not null unique,
      enabled boolean not null default true,
      created_at timestamptz not null default now(),
      last_used_at timestamptz
    );

    create table if not exists servers (
      id text primary key,
      label text not null,
      roles text[] not null default '{}',
      enabled boolean not null default true,
      config jsonb not null default '{}',
      updated_at timestamptz not null default now()
    );

    create table if not exists endpoints (
      id text primary key,
      label text not null,
      kind text not null,
      server_id text references servers(id) on delete set null,
      address text not null,
      port integer not null,
      profile_id text not null,
      enabled boolean not null default true,
      sort_order integer not null default 100,
      config jsonb not null default '{}',
      updated_at timestamptz not null default now()
    );

    create table if not exists client_profiles (
      client_id bigint not null references vpn_clients(id) on delete cascade,
      endpoint_id text not null references endpoints(id) on delete cascade,
      primary key (client_id, endpoint_id)
    );

    create table if not exists sessions (
      id text primary key,
      account_id bigint not null references accounts(id) on delete cascade,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    );

    create table if not exists smart_dns_clients (
      account_id bigint primary key references accounts(id) on delete cascade,
      client_id text not null unique,
      enabled boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists usage_events (
      id bigserial primary key,
      account_id bigint references accounts(id) on delete set null,
      client_id bigint references vpn_clients(id) on delete set null,
      event_type text not null,
      metadata jsonb not null default '{}',
      created_at timestamptz not null default now()
    );

    create table if not exists endpoint_health (
      endpoint_id text primary key references endpoints(id) on delete cascade,
      latency_ms integer,
      speed_mbps numeric(6,1),
      exit_ip text,
      pass_count integer not null default 0,
      fail_count integer not null default 0,
      sites jsonb not null default '[]',
      checked_at timestamptz not null default now()
    );

    create table if not exists vpn_test_events (
      event_id text primary key,
      run_id text not null,
      sequence integer not null,
      event_timestamp timestamptz not null,
      event_type text not null,
      profile text not null,
      target_id text not null,
      client text not null default 'xray',
      access_method text not null default 'socks-proxy',
      wire_method text not null default 'wire-internal',
      host_role text not null default 'worker-main',
      network_class text not null,
      endpoint_id text,
      stage text,
      payload jsonb not null default '{}',
      received_at timestamptz not null default now(),
      unique(run_id, sequence)
    );

    create table if not exists vpn_test_runs (
      run_id text primary key,
      profile text not null,
      target_id text not null,
      client text not null default 'xray',
      access_method text not null default 'socks-proxy',
      wire_method text not null default 'wire-internal',
      host_role text not null default 'worker-main',
      network_class text not null,
      engine text,
      status text not null default 'running',
      summary jsonb not null default '{}',
      artifact_url text,
      started_at timestamptz not null,
      finished_at timestamptz,
      last_event_at timestamptz not null,
      received_at timestamptz not null default now()
    );

    create table if not exists happ_installs (
      account_id bigint primary key references accounts(id) on delete cascade,
      install_code text not null unique,
      install_id integer,
      install_limit integer not null default 10,
      status integer not null default 10,
      note text,
      happ_settings jsonb not null default '{}',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists happ_hwids (
      id bigserial primary key,
      account_id bigint references accounts(id) on delete cascade,
      install_code text not null,
      hwid text not null,
      device_name text,
      device_model text,
      os_version text,
      app_version text,
      recorded_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      unique(install_code, hwid)
    );

    create index if not exists smart_dns_clients_client_id_idx on smart_dns_clients(client_id);
    create index if not exists subscription_tokens_token_idx on subscription_tokens(token);
    create index if not exists sessions_expires_at_idx on sessions(expires_at);
    create index if not exists usage_events_account_created_idx on usage_events(account_id, created_at desc);
    create index if not exists happ_hwids_account_idx on happ_hwids(account_id);
    create index if not exists vpn_test_events_run_sequence_idx on vpn_test_events(run_id, sequence);
    create index if not exists vpn_test_events_received_idx on vpn_test_events(received_at desc);
    create index if not exists vpn_test_runs_started_idx on vpn_test_runs(started_at desc);
    create index if not exists vpn_test_runs_filter_idx on vpn_test_runs(network_class, target_id, profile, status, started_at desc);
  `);

  // Migrations for existing databases — add tables/columns if missing
  await pool.query(`
    create table if not exists smart_dns_clients (
      account_id bigint primary key references accounts(id) on delete cascade,
      client_id text not null unique,
      enabled boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query(`create index if not exists smart_dns_clients_client_id_idx on smart_dns_clients(client_id)`);
  await pool.query(`alter table happ_hwids add column if not exists last_seen_at timestamptz not null default now()`);
  await pool.query(`alter table happ_hwids add column if not exists device_model text`);
  await pool.query(`alter table happ_hwids add column if not exists os_version text`);
  await pool.query(`alter table vpn_test_events add column if not exists client text not null default 'xray'`);
  await pool.query(`alter table vpn_test_events add column if not exists access_method text not null default 'socks-proxy'`);
  await pool.query(`alter table vpn_test_events add column if not exists wire_method text not null default 'wire-internal'`);
  await pool.query(`alter table vpn_test_events add column if not exists host_role text not null default 'worker-main'`);
  await pool.query(`alter table vpn_test_runs add column if not exists client text not null default 'xray'`);
  await pool.query(`alter table vpn_test_runs add column if not exists access_method text not null default 'socks-proxy'`);
  await pool.query(`alter table vpn_test_runs add column if not exists wire_method text not null default 'wire-internal'`);
  await pool.query(`alter table vpn_test_runs add column if not exists host_role text not null default 'worker-main'`);
  await pool.query(`create index if not exists vpn_test_events_matrix_idx on vpn_test_events(client, access_method, wire_method, endpoint_id, event_timestamp desc)`);
  await pool.query(`create index if not exists vpn_test_runs_matrix_idx on vpn_test_runs(client, access_method, wire_method, host_role, started_at desc)`);
  await pool.query(`alter table happ_hwids add column if not exists app_version text`);
  await pool.query(`create index if not exists happ_hwids_account_idx on happ_hwids(account_id)`);
}

export async function bootstrapAdmin(pool: DbPool, config: AppConfig): Promise<void> {
  if (!config.adminPassword) {
    return;
  }

  const existing = await pool.query("select id from accounts where role = 'admin' limit 1");
  if (existing.rowCount && existing.rowCount > 0) {
    return;
  }

  await pool.query(
    `insert into accounts (login, display_name, password_hash, role)
     values ($1, $2, $3, 'admin')`,
    [config.adminLogin, "Admin", await hashPassword(config.adminPassword)],
  );
}

function serverIdForEndpoint(endpointId: string): string | null {
  if (endpointId.endsWith("-relay")) return "regional-relays";
  if (endpointId.startsWith("de-")) return "de";
  if (endpointId.startsWith("ru-")) return "ru";
  if (endpointId.includes("-de-")) return "de";
  if (endpointId.includes("-us-")) return "us";
  if (endpointId.startsWith("nl-")) return "nl";
  return null;
}

export async function syncCatalogFromSecureConfig(pool: DbPool, secure: SecureConfig): Promise<void> {
  for (const [serverId, serverConfig] of Object.entries(secure.server_configs)) {
    await pool.query(
      `insert into servers (id, label, roles, enabled, config, updated_at)
       values ($1, $2, $3, true, $4, now())
       on conflict (id) do update set
         label = excluded.label,
         roles = excluded.roles,
         config = excluded.config,
         updated_at = now()`,
      [
        serverId,
        serverId.toUpperCase(),
        serverId === "regional-relays"
          ? ["entry", "relay"]
          : serverId === "de"
            ? ["exit", "direct"]
            : serverId === "ru"
              ? ["entry", "relay"]
              : ["exit"],
        JSON.stringify(serverConfig),
      ],
    );
  }

  for (const [index, node] of secure.nodes.entries()) {
    const config = {
      public_key: node.public_key,
      short_id: node.short_id,
      flow: node.flow,
      sni: node.sni,
      fingerprint: node.fingerprint,
      query: node.query,
    };
    await pool.query(
      `insert into endpoints
        (id, label, kind, server_id, address, port, profile_id, enabled, sort_order, config, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       on conflict (id) do update set
         label = excluded.label,
         kind = excluded.kind,
         server_id = excluded.server_id,
         address = excluded.address,
         port = excluded.port,
         profile_id = excluded.profile_id,
         enabled = excluded.enabled,
         sort_order = excluded.sort_order,
         config = excluded.config,
         updated_at = now()`,
      [
        node.id,
        node.label || node.id,
        node.kind,
        serverIdForEndpoint(node.id),
        node.address,
        node.port,
        endpointProfile(node),
        node.enabled,
        index,
        JSON.stringify(config),
      ],
    );
  }
}
