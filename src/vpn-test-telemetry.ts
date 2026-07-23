import { z } from "zod";
import type { DbPool } from "./db.js";
import {
  assertVpnTestTargetDimensions,
  vpnTestAccessMethodSchema,
  vpnTestClientSchema,
  vpnTestHostRoleSchema,
  vpnTestWireMethodSchema,
} from "./vpn-test-contract.js";

const networkClassSchema = z.enum(["lan", "external-wired", "external-wireless", "external-mobile", "external-unknown"]);

const telemetryEventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().min(1).max(100),
  runId: z.string().min(1).max(100),
  sequence: z.number().int().positive(),
  timestamp: z.string().datetime(),
  type: z.enum(["run_started", "endpoint_started", "stage_started", "stage_finished", "endpoint_finished", "run_finished"]),
  profile: z.enum(["quick", "health", "benchmark"]),
  target: z.object({
    id: z.string().min(1).max(100),
    networkClass: networkClassSchema,
    client: vpnTestClientSchema,
    accessMethod: vpnTestAccessMethodSchema,
    wireMethod: vpnTestWireMethodSchema,
    hostRole: vpnTestHostRoleSchema,
  }).superRefine((target, context) => {
    try {
      assertVpnTestTargetDimensions(target);
    } catch (error) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: String(error) });
    }
  }).passthrough(),
  endpoint: z.string().min(1).max(200).optional(),
  stage: z.string().min(1).max(100).optional(),
  payload: z.record(z.string(), z.unknown()),
});

export type VpnTestEvent = z.infer<typeof telemetryEventSchema>;

export const vpnTestRunFiltersSchema = z.object({
  networkClass: networkClassSchema.optional(),
  client: vpnTestClientSchema.optional(),
  accessMethod: vpnTestAccessMethodSchema.optional(),
  wireMethod: vpnTestWireMethodSchema.optional(),
  hostRole: vpnTestHostRoleSchema.optional(),
  target: z.string().min(1).max(100).optional(),
  profile: z.enum(["quick", "health", "benchmark"]).optional(),
  endpoint: z.string().min(1).max(200).optional(),
  status: z.enum(["running", "passed", "degraded", "failed", "error"]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type VpnTestRunFilters = z.infer<typeof vpnTestRunFiltersSchema>;

export type VpnTestRun = {
  run_id: string;
  profile: string;
  target_id: string;
  network_class: string;
  client: string;
  access_method: string;
  wire_method: string;
  host_role: string;
  engine: string | null;
  status: string;
  summary: Record<string, unknown>;
  artifact_url: string | null;
  started_at: string;
  finished_at: string | null;
  last_event_at: string;
};

export type VpnTestEndpointScore = {
  endpointId: string;
  score: number;
  passed: number;
  effectiveObservations: number;
  endpointFailures: number;
  runnerErrors: number;
  telegramMedianMs: number | null;
  telegramP95Ms: number | null;
};

export type VpnTestStageAggregate = {
  stageId: string;
  total: number;
  passed: number;
  reachable: number;
  meanMs: number | null;
  medianMs: number | null;
  p95Ms: number | null;
  meanMbps: number | null;
  medianMbps: number | null;
  p95Mbps: number | null;
};

export type VpnTestEndpointAggregate = {
  endpointId: string;
  score: number | null;
  totalObservations: number;
  passed: number;
  effectiveObservations: number;
  endpointFailures: number;
  runnerErrors: number;
  stages: VpnTestStageAggregate[];
};

export type VpnTestEndpointMatrixRow = VpnTestEndpointAggregate & {
  targetId: string;
  networkClass: string;
  client: string;
  accessMethod: string;
  wireMethod: string;
  hostRole: string;
};

export type VpnTestEndpointDetail = {
  endpointId: string;
  windowDays: number;
  summary: VpnTestEndpointAggregate;
  matrix: VpnTestEndpointMatrixRow[];
};

type VpnTestEndpointScoreRow = {
  endpoint_id: string;
  score: number | string;
  passed: number;
  effective_observations: number;
  endpoint_failures: number;
  runner_errors: number;
  telegram_median_ms: number | null;
  telegram_p95_ms: number | null;
};

type VpnTestEndpointAggregateRow = {
  endpoint_id: string;
  score: number | string | null;
  total_observations: number;
  passed: number;
  effective_observations: number;
  endpoint_failures: number;
  runner_errors: number;
  stage_stats: unknown;
};

type VpnTestEndpointMatrixRowDb = VpnTestEndpointAggregateRow & {
  target_id: string;
  network_class: string;
  client: string;
  access_method: string;
  wire_method: string;
  host_role: string;
};

/** Parse one incremental VPN test event or throw a detailed validation error. */
export function parseVpnTestEvent(input: unknown): VpnTestEvent {
  return telemetryEventSchema.parse(input);
}

/** Persist an event idempotently; retries cannot duplicate a completed stage. */
export async function recordVpnTestEvent(pool: DbPool, event: VpnTestEvent): Promise<void> {
  await pool.query(
    `insert into vpn_test_events
       (event_id, run_id, sequence, event_timestamp, event_type, profile, target_id, client, access_method, wire_method, host_role, network_class, endpoint_id, stage, payload)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     on conflict do nothing`,
    [
      event.eventId,
      event.runId,
      event.sequence,
      event.timestamp,
      event.type,
      event.profile,
      event.target.id,
      event.target.client,
      event.target.accessMethod,
      event.target.wireMethod,
      event.target.hostRole,
      event.target.networkClass,
      event.endpoint ?? null,
      event.stage ?? null,
      JSON.stringify({ target: event.target, ...event.payload }),
    ],
  );
  let summary: Record<string, unknown> = {};
  if (event.type === "run_finished") {
    if (typeof event.payload.summary === "object" && event.payload.summary !== null) {
      summary = event.payload.summary as Record<string, unknown>;
    } else {
      // Android emits endpoint results incrementally so the server remains the
      // source of truth even if a final client-side summary cannot be uploaded.
      const aggregate = await pool.query<{ total: number; eligible: number; errors: number }>(
        `select count(*)::int as total,
                count(*) filter (where coalesce((payload->>'eligible')::boolean, false))::int as eligible,
                count(*) filter (where payload ? 'error')::int as errors
           from vpn_test_events
          where run_id = $1 and event_type='endpoint_finished'`,
        [event.runId],
      );
      summary = aggregate.rows[0] ?? { total: 0, eligible: 0, errors: 0 };
    }
  }
  const total = Number(summary.total ?? 0);
  const eligible = Number(summary.eligible ?? 0);
  const errors = Number(summary.errors ?? 0);
  const finishedStatus = errors > 0 ? "error" : (total > 0 && eligible === total ? "passed" : (eligible > 0 ? "degraded" : "failed"));
  const engine = typeof event.payload.engine === "string" ? event.payload.engine : null;
  const artifactUrl = typeof event.payload.artifactUrl === "string"
    ? event.payload.artifactUrl
    : (typeof event.payload.artifactPath === "string" ? `/api/admin/vpn-tests/runs/${encodeURIComponent(event.runId)}/artifact` : null);
  await pool.query(
    `insert into vpn_test_runs
       (run_id, profile, target_id, client, access_method, wire_method, host_role, network_class, engine, status, summary, artifact_url, started_at, finished_at, last_event_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $13)
     on conflict (run_id) do update set
       client = excluded.client,
       access_method = excluded.access_method,
       wire_method = excluded.wire_method,
       host_role = excluded.host_role,
       engine = coalesce(excluded.engine, vpn_test_runs.engine),
       status = case when $15 then excluded.status else vpn_test_runs.status end,
       summary = case when $15 then excluded.summary else vpn_test_runs.summary end,
       artifact_url = coalesce(excluded.artifact_url, vpn_test_runs.artifact_url),
       finished_at = case when $15 then excluded.finished_at else vpn_test_runs.finished_at end,
       last_event_at = greatest(vpn_test_runs.last_event_at, excluded.last_event_at)`,
    [
      event.runId,
      event.profile,
      event.target.id,
      event.target.client,
      event.target.accessMethod,
      event.target.wireMethod,
      event.target.hostRole,
      event.target.networkClass,
      engine,
      event.type === "run_finished" ? finishedStatus : "running",
      JSON.stringify(summary),
      artifactUrl,
      event.timestamp,
      event.type === "run_finished" ? event.timestamp : null,
      event.type === "run_finished",
    ],
  );
}

/** List indexed runs for the admin history screen. */
export async function listVpnTestRuns(pool: DbPool, filters: VpnTestRunFilters): Promise<{ runs: VpnTestRun[]; total: number }> {
  const clauses: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, value: unknown): void => {
    values.push(value);
    clauses.push(sql.replace("?", `$${values.length}`));
  };
  if (filters.networkClass) add("r.network_class = ?", filters.networkClass);
  if (filters.client) add("r.client = ?", filters.client);
  if (filters.accessMethod) add("r.access_method = ?", filters.accessMethod);
  if (filters.wireMethod) add("r.wire_method = ?", filters.wireMethod);
  if (filters.hostRole) add("r.host_role = ?", filters.hostRole);
  if (filters.target) add("r.target_id = ?", filters.target);
  if (filters.profile) add("r.profile = ?", filters.profile);
  if (filters.status) add("r.status = ?", filters.status);
  if (filters.from) add("r.started_at >= ?", filters.from);
  if (filters.to) add("r.started_at <= ?", filters.to);
  if (filters.endpoint) add("exists (select 1 from vpn_test_events e where e.run_id=r.run_id and e.endpoint_id = ?)", filters.endpoint);
  const where = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
  const limitIndex = values.push(filters.limit);
  const offsetIndex = values.push(filters.offset);
  const result = await pool.query<VpnTestRun & { total_count: number }>(
    `select r.*, count(*) over()::int as total_count from vpn_test_runs r ${where}
     order by r.started_at desc limit $${limitIndex} offset $${offsetIndex}`,
    values,
  );
  return { runs: result.rows.map(({ total_count: _totalCount, ...run }) => run), total: result.rows[0]?.total_count ?? 0 };
}

/** Read all ordered events for one run. */
export async function getVpnTestRunEvents(pool: DbPool, runId: string): Promise<Record<string, unknown>[]> {
  const result = await pool.query<Record<string, unknown>>(
    `select event_id, run_id, sequence, event_timestamp, event_type, profile, target_id, client, access_method,
            wire_method, host_role, network_class,
            endpoint_id, stage, payload, received_at
     from vpn_test_events where run_id=$1 order by sequence`,
    [runId],
  );
  return result.rows;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mapStageAggregates(value: unknown): VpnTestStageAggregate[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("vpn test stage_stats must be an array");
  return value.map((item) => {
    if (!item || typeof item !== "object" || typeof (item as Record<string, unknown>).stageId !== "string") {
      throw new Error("vpn test stage_stats contains an invalid stage");
    }
    const stage = item as Record<string, unknown>;
    return {
      stageId: String(stage.stageId),
      total: Number(stage.total),
      passed: Number(stage.passed),
      reachable: Number(stage.reachable),
      meanMs: nullableNumber(stage.meanMs),
      medianMs: nullableNumber(stage.medianMs),
      p95Ms: nullableNumber(stage.p95Ms),
      meanMbps: nullableNumber(stage.meanMbps),
      medianMbps: nullableNumber(stage.medianMbps),
      p95Mbps: nullableNumber(stage.p95Mbps),
    };
  });
}

function mapEndpointAggregate(row: VpnTestEndpointAggregateRow | undefined, endpointId: string): VpnTestEndpointAggregate {
  if (!row) {
    return {
      endpointId,
      score: null,
      totalObservations: 0,
      passed: 0,
      effectiveObservations: 0,
      endpointFailures: 0,
      runnerErrors: 0,
      stages: [],
    };
  }
  return {
    endpointId: row.endpoint_id,
    score: nullableNumber(row.score),
    totalObservations: Number(row.total_observations),
    passed: Number(row.passed),
    effectiveObservations: Number(row.effective_observations),
    endpointFailures: Number(row.endpoint_failures),
    runnerErrors: Number(row.runner_errors),
    stages: mapStageAggregates(row.stage_stats),
  };
}

/** Aggregate one endpoint by test matrix dimensions and stage metrics. */
export async function getVpnTestEndpointDetail(pool: DbPool, endpointId: string, windowDays = 3): Promise<VpnTestEndpointDetail> {
  const summaryResult = await pool.query<VpnTestEndpointAggregateRow>(
    `with endpoint_results as (
       select count(*)::int as total_observations,
              count(*) filter (where coalesce((payload->>'eligible')::boolean, false))::int as passed,
              count(*) filter (where nullif(payload->>'error', '') is not null)::int as runner_errors
         from vpn_test_events
        where event_type = 'endpoint_finished'
          and endpoint_id = $1
          and event_timestamp >= now() - ($2::int * interval '1 day')
     ), stage_aggregates as (
       select stage,
              count(*)::int as total,
              count(*) filter (where coalesce((payload->>'contentOk')::boolean, (payload->>'content_ok')::boolean, (payload->>'ok')::boolean, false))::int as passed,
              count(*) filter (where coalesce((payload->>'reachable')::boolean, (payload->>'ok')::boolean, false))::int as reachable,
              round(avg(coalesce(nullif(payload->>'latencyMs', '')::numeric, nullif(payload->>'latency_ms', '')::numeric)))::int as mean_ms,
              round((percentile_cont(0.5) within group (order by coalesce(nullif(payload->>'latencyMs', '')::numeric, nullif(payload->>'latency_ms', '')::numeric)) filter (where coalesce(nullif(payload->>'latencyMs', '')::numeric, nullif(payload->>'latency_ms', '')::numeric) is not null))::numeric)::int as median_ms,
              round((percentile_cont(0.95) within group (order by coalesce(nullif(payload->>'latencyMs', '')::numeric, nullif(payload->>'latency_ms', '')::numeric)) filter (where coalesce(nullif(payload->>'latencyMs', '')::numeric, nullif(payload->>'latency_ms', '')::numeric) is not null))::numeric)::int as p95_ms,
              round(avg(nullif(payload->>'mbps', '')::numeric), 2)::float8 as mean_mbps,
              round((percentile_cont(0.5) within group (order by nullif(payload->>'mbps', '')::numeric) filter (where nullif(payload->>'mbps', '')::numeric is not null))::numeric, 2)::float8 as median_mbps,
              round((percentile_cont(0.95) within group (order by nullif(payload->>'mbps', '')::numeric) filter (where nullif(payload->>'mbps', '')::numeric is not null))::numeric, 2)::float8 as p95_mbps
         from vpn_test_events
        where event_type = 'stage_finished'
          and endpoint_id = $1
          and event_timestamp >= now() - ($2::int * interval '1 day')
        group by stage
     )
     select $1::text as endpoint_id,
            round((100.0 * e.passed / nullif(e.total_observations - e.runner_errors, 0))::numeric, 1)::float8 as score,
            e.total_observations,
            e.passed,
            (e.total_observations - e.runner_errors)::int as effective_observations,
            (e.total_observations - e.runner_errors - e.passed)::int as endpoint_failures,
            e.runner_errors,
            coalesce(jsonb_agg(jsonb_build_object(
              'stageId', s.stage,
              'total', s.total,
              'passed', s.passed,
              'reachable', s.reachable,
              'meanMs', s.mean_ms,
              'medianMs', s.median_ms,
              'p95Ms', s.p95_ms,
              'meanMbps', s.mean_mbps,
              'medianMbps', s.median_mbps,
              'p95Mbps', s.p95_mbps
            ) order by s.stage) filter (where s.stage is not null), '[]'::jsonb) as stage_stats
       from endpoint_results e
       left join stage_aggregates s on true
      group by e.total_observations, e.passed, e.runner_errors`,
    [endpointId, windowDays],
  );

  const matrixResult = await pool.query<VpnTestEndpointMatrixRowDb>(
    `with endpoint_results as (
       select target_id, network_class, client, access_method, wire_method, host_role,
              count(*)::int as total_observations,
              count(*) filter (where coalesce((payload->>'eligible')::boolean, false))::int as passed,
              count(*) filter (where nullif(payload->>'error', '') is not null)::int as runner_errors
         from vpn_test_events
        where event_type = 'endpoint_finished'
          and endpoint_id = $1
          and event_timestamp >= now() - ($2::int * interval '1 day')
        group by target_id, network_class, client, access_method, wire_method, host_role
     ), stage_aggregates as (
       select target_id, network_class, client, access_method, wire_method, host_role, stage,
              count(*)::int as total,
              count(*) filter (where coalesce((payload->>'contentOk')::boolean, (payload->>'content_ok')::boolean, (payload->>'ok')::boolean, false))::int as passed,
              count(*) filter (where coalesce((payload->>'reachable')::boolean, (payload->>'ok')::boolean, false))::int as reachable,
              round(avg(coalesce(nullif(payload->>'latencyMs', '')::numeric, nullif(payload->>'latency_ms', '')::numeric)))::int as mean_ms,
              round((percentile_cont(0.5) within group (order by coalesce(nullif(payload->>'latencyMs', '')::numeric, nullif(payload->>'latency_ms', '')::numeric)) filter (where coalesce(nullif(payload->>'latencyMs', '')::numeric, nullif(payload->>'latency_ms', '')::numeric) is not null))::numeric)::int as median_ms,
              round((percentile_cont(0.95) within group (order by coalesce(nullif(payload->>'latencyMs', '')::numeric, nullif(payload->>'latency_ms', '')::numeric)) filter (where coalesce(nullif(payload->>'latencyMs', '')::numeric, nullif(payload->>'latency_ms', '')::numeric) is not null))::numeric)::int as p95_ms,
              round(avg(nullif(payload->>'mbps', '')::numeric), 2)::float8 as mean_mbps,
              round((percentile_cont(0.5) within group (order by nullif(payload->>'mbps', '')::numeric) filter (where nullif(payload->>'mbps', '')::numeric is not null))::numeric, 2)::float8 as median_mbps,
              round((percentile_cont(0.95) within group (order by nullif(payload->>'mbps', '')::numeric) filter (where nullif(payload->>'mbps', '')::numeric is not null))::numeric, 2)::float8 as p95_mbps
         from vpn_test_events
        where event_type = 'stage_finished'
          and endpoint_id = $1
          and event_timestamp >= now() - ($2::int * interval '1 day')
        group by target_id, network_class, client, access_method, wire_method, host_role, stage
     )
     select $1::text as endpoint_id,
            e.target_id, e.network_class, e.client, e.access_method, e.wire_method, e.host_role,
            round((100.0 * e.passed / nullif(e.total_observations - e.runner_errors, 0))::numeric, 1)::float8 as score,
            e.total_observations,
            e.passed,
            (e.total_observations - e.runner_errors)::int as effective_observations,
            (e.total_observations - e.runner_errors - e.passed)::int as endpoint_failures,
            e.runner_errors,
            coalesce(jsonb_agg(jsonb_build_object(
              'stageId', s.stage,
              'total', s.total,
              'passed', s.passed,
              'reachable', s.reachable,
              'meanMs', s.mean_ms,
              'medianMs', s.median_ms,
              'p95Ms', s.p95_ms,
              'meanMbps', s.mean_mbps,
              'medianMbps', s.median_mbps,
              'p95Mbps', s.p95_mbps
            ) order by s.stage) filter (where s.stage is not null), '[]'::jsonb) as stage_stats
       from endpoint_results e
       left join stage_aggregates s using (target_id, network_class, client, access_method, wire_method, host_role)
      group by e.target_id, e.network_class, e.client, e.access_method, e.wire_method, e.host_role,
               e.total_observations, e.passed, e.runner_errors
      order by score desc nulls last, e.target_id, e.client, e.access_method, e.wire_method`,
    [endpointId, windowDays],
  );

  const matrix = matrixResult.rows.map((row) => ({
    ...mapEndpointAggregate(row, endpointId),
    targetId: row.target_id,
    networkClass: row.network_class,
    client: row.client,
    accessMethod: row.access_method,
    wireMethod: row.wire_method,
    hostRole: row.host_role,
  }));
  return {
    endpointId,
    windowDays,
    summary: mapEndpointAggregate(summaryResult.rows[0], endpointId),
    matrix,
  };
}

/** Aggregate endpoint reliability over the rolling telemetry window. */
export async function getVpnTestEndpointScores(pool: DbPool, windowDays = 3): Promise<VpnTestEndpointScore[]> {
  const result = await pool.query<VpnTestEndpointScoreRow>(
    `with endpoint_results as (
       select endpoint_id,
              count(*)::int as total_observations,
              count(*) filter (where coalesce((payload->>'eligible')::boolean, false))::int as passed,
              count(*) filter (where nullif(payload->>'error', '') is not null)::int as runner_errors
         from vpn_test_events
        where event_type = 'endpoint_finished'
          and endpoint_id is not null
          and event_timestamp >= now() - ($1::int * interval '1 day')
        group by endpoint_id
     ), stage_results as (
       select endpoint_id,
              stage,
              coalesce(
                nullif(payload->>'latencyMs', '')::numeric,
                nullif(payload->>'latency_ms', '')::numeric
              ) as latency_ms,
              coalesce((payload->>'reachable')::boolean, (payload->>'ok')::boolean, false) as ok
         from vpn_test_events
        where event_type = 'stage_finished'
          and endpoint_id is not null
          and event_timestamp >= now() - ($1::int * interval '1 day')
     ), stage_aggregates as (
       select endpoint_id,
              round((percentile_cont(0.5) within group (order by latency_ms)
                filter (where stage = 'telegram' and latency_ms is not null))::numeric)::int as telegram_median_ms,
              round((percentile_cont(0.95) within group (order by latency_ms)
                filter (where stage = 'telegram' and latency_ms is not null))::numeric)::int as telegram_p95_ms
         from stage_results
        group by endpoint_id
     )
     select e.endpoint_id,
            round((100.0 * e.passed / nullif(e.total_observations - e.runner_errors, 0))::numeric, 1)::float8 as score,
            e.passed,
            (e.total_observations - e.runner_errors)::int as effective_observations,
            (e.total_observations - e.runner_errors - e.passed)::int as endpoint_failures,
            e.runner_errors,
            s.telegram_median_ms,
            s.telegram_p95_ms
       from endpoint_results e
       left join stage_aggregates s using (endpoint_id)
      order by score desc nulls last, endpoint_id`,
    [windowDays],
  );
  return result.rows.map((row) => ({
    endpointId: row.endpoint_id,
    score: Number(row.score),
    passed: Number(row.passed),
    effectiveObservations: Number(row.effective_observations),
    endpointFailures: Number(row.endpoint_failures),
    runnerErrors: Number(row.runner_errors),
    telegramMedianMs: row.telegram_median_ms == null ? null : Number(row.telegram_median_ms),
    telegramP95Ms: row.telegram_p95_ms == null ? null : Number(row.telegram_p95_ms),
  }));
}

/** Return the local immutable JSON path recorded by the legacy importer. */
export async function getVpnTestArtifactPath(pool: DbPool, runId: string): Promise<string | null> {
  const result = await pool.query<{ artifact_path: string | null }>(
    `select payload->>'artifactPath' as artifact_path
     from vpn_test_events where run_id=$1 and payload ? 'artifactPath'
     order by sequence desc limit 1`,
    [runId],
  );
  return result.rows[0]?.artifact_path ?? null;
}
