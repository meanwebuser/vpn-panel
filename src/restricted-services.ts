import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";

import type { SmartDnsPolicy } from "./smart-dns-policy.js";

export type RestrictedServiceRoute = "local-proxy" | "proxy" | "vusa-proxy" | "monitor";
export type RestrictedServicesSourceRole = "evidence-only";

export interface RestrictedServicesFeed {
  id: string;
  repository: string;
  url: string;
}

export interface RestrictedServicesSource {
  id: string;
  repository: string;
  homepage: string;
  role: RestrictedServicesSourceRole;
  refreshHours: number;
  feeds: RestrictedServicesFeed[];
}

export interface RestrictedServiceDefinition {
  id: string;
  label: string;
  probeUrl: string;
  route: RestrictedServiceRoute;
  restriction: string;
  domains: string[];
}

export interface RestrictedServicesCatalog {
  schemaVersion: number;
  updatedAt: string;
  description: string;
  sources: RestrictedServicesSource[];
  lanEdgeIp: string;
  publicEdges: Array<{ id: string; label: string; ip: string }>;
  lanProxies: Array<{ id: string; label: string; url: string }>;
  services: RestrictedServiceDefinition[];
}

export type RestrictedProbeLaneKind = "direct" | "sni" | "http-proxy";
export type RestrictedProbeStability = "stable" | "flaky" | "down" | "skipped";
export type RestrictedFeedFetchState = "ok" | "error" | "skipped";

export interface RestrictedServiceProbeEvidence {
  attempt: number;
  startedAt: string;
  durationMs: number;
  curlExitCode: number | null;
  reachable: boolean;
  httpCode: number | null;
  latencyMs: number | null;
  remoteIp: string | null;
  error: string | null;
}

export interface RestrictedServiceProbeResult {
  reachable: boolean;
  stability: RestrictedProbeStability;
  attempts: number;
  successes: number;
  httpCode: number | null;
  latencyMs: number | null;
  remoteIp: string | null;
  error: string | null;
}

export interface RestrictedServiceStatusProbeResult extends RestrictedServiceProbeResult {
  evidence: RestrictedServiceProbeEvidence[];
}

export interface RestrictedServiceStatusRow {
  id: string;
  label: string;
  route: RestrictedServiceRoute;
  restriction: string;
  externalFeeds: string[];
  lanes: Record<string, RestrictedServiceStatusProbeResult>;
}

export interface RestrictedServicesStatus {
  schemaVersion: 2;
  generatedAt: string;
  durationMs: number;
  catalogUpdatedAt: string;
  observationalOnly: true;
  run: {
    probes: boolean;
    externalFeeds: boolean;
    attempts: number;
    laneConcurrency: number;
  };
  sourceSummary: {
    configured: number;
    fetched: number;
    failed: number;
    skipped: number;
    rules: number;
  };
  feeds: Array<{
    id: string;
    url: string;
    state: RestrictedFeedFetchState;
    fetchedAt: string | null;
    durationMs: number;
    ruleCount: number;
    error: string | null;
  }>;
  laneDefinitions: Array<{ id: string; label: string; kind: RestrictedProbeLaneKind }>;
  rows: RestrictedServiceStatusRow[];
  summary: Record<string, {
    reachable: number;
    stable: number;
    flaky: number;
    down: number;
    skipped: number;
    total: number;
    attempts: number;
    successes: number;
  }>;
}

export interface RestrictedServicesView {
  catalog: RestrictedServicesCatalog;
  status: RestrictedServicesStatus | null;
}

export function restrictedServicesCatalogPath(): string {
  return process.env.VPN_PANEL_RESTRICTED_SERVICES_CATALOG || path.join(process.cwd(), "vpn-testing", "restricted-services.json");
}

export function restrictedServicesStatusPath(): string {
  return process.env.VPN_PANEL_RESTRICTED_SERVICES_STATUS || path.join(process.cwd(), "data", "restricted-services-status.json");
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
}

function assertRepository(value: unknown, field: string): asserts value is string {
  assertString(value, field);
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(value)) throw new Error(`${field} must use owner/repository syntax`);
}

function assertUrl(value: unknown, field: string, protocols: string[]): asserts value is string {
  assertString(value, field);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }
  if (!protocols.includes(parsed.protocol)) throw new Error(`${field} must use ${protocols.join(" or ")}`);
}

const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

function assertDomain(value: unknown, field: string): asserts value is string {
  assertString(value, field);
  const normalized = normalizeDomain(value);
  if (value !== normalized || !DOMAIN_PATTERN.test(normalized)) throw new Error(`${field} must be a normalized domain name`);
}

function domainsRelated(left: string, right: string): boolean {
  const a = normalizeDomain(left);
  const b = normalizeDomain(right);
  return Boolean(a && b) && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));
}

/** Validate the checked-in catalog before it influences routing or monitoring. */
export function validateRestrictedServicesCatalog(value: unknown): RestrictedServicesCatalog {
  if (!value || typeof value !== "object") throw new Error("restricted services catalog must be an object");
  const catalog = value as Partial<RestrictedServicesCatalog>;
  if (catalog.schemaVersion !== 1) throw new Error("unsupported restricted services catalog schemaVersion");
  assertString(catalog.updatedAt, "updatedAt");
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/.test(catalog.updatedAt) || Number.isNaN(Date.parse(catalog.updatedAt))) {
    throw new Error("updatedAt must be an ISO date or UTC timestamp");
  }
  assertString(catalog.description, "description");
  assertString(catalog.lanEdgeIp, "lanEdgeIp");
  if (!isIP(catalog.lanEdgeIp)) throw new Error("lanEdgeIp must be an IP address");
  if (!Array.isArray(catalog.sources) || !catalog.sources.length) throw new Error("sources must be a non-empty array");
  if (!Array.isArray(catalog.publicEdges) || !catalog.publicEdges.length) throw new Error("publicEdges must be a non-empty array");
  if (!Array.isArray(catalog.lanProxies) || !catalog.lanProxies.length) throw new Error("lanProxies must be a non-empty array");
  if (!Array.isArray(catalog.services) || !catalog.services.length) throw new Error("services must be a non-empty array");

  const sourceIds = new Set<string>();
  const feedIds = new Set<string>();
  for (const source of catalog.sources) {
    assertString(source.id, "sources[].id");
    if (sourceIds.has(source.id)) throw new Error(`duplicate source id: ${source.id}`);
    sourceIds.add(source.id);
    assertRepository(source.repository, `sources.${source.id}.repository`);
    assertUrl(source.homepage, `sources.${source.id}.homepage`, ["https:"]);
    if (source.role !== "evidence-only") throw new Error(`invalid role for ${source.id}; external sources must be evidence-only`);
    if (!Number.isInteger(source.refreshHours) || source.refreshHours <= 0) throw new Error(`invalid refreshHours for ${source.id}`);
    if (!Array.isArray(source.feeds) || !source.feeds.length) throw new Error(`feeds must be non-empty for ${source.id}`);
    for (const feed of source.feeds) {
      assertString(feed.id, `sources.${source.id}.feeds[].id`);
      assertRepository(feed.repository, `sources.${source.id}.feeds.${feed.id}.repository`);
      assertUrl(feed.url, `sources.${source.id}.feeds.${feed.id}.url`, ["https:"]);
      if (feedIds.has(feed.id)) throw new Error(`duplicate feed id: ${feed.id}`);
      feedIds.add(feed.id);
    }
  }

  const edgeIds = new Set<string>();
  for (const edge of catalog.publicEdges) {
    assertString(edge.id, "publicEdges[].id");
    assertString(edge.label, `publicEdges.${edge.id}.label`);
    assertString(edge.ip, `publicEdges.${edge.id}.ip`);
    if (!isIP(edge.ip)) throw new Error(`invalid IP address for ${edge.id}`);
    if (edgeIds.has(edge.id)) throw new Error(`duplicate public edge id: ${edge.id}`);
    edgeIds.add(edge.id);
  }
  for (const proxy of catalog.lanProxies) {
    assertString(proxy.id, "lanProxies[].id");
    assertString(proxy.label, `lanProxies.${proxy.id}.label`);
    assertUrl(proxy.url, `lanProxies.${proxy.id}.url`, ["http:", "https:"]);
    if (edgeIds.has(proxy.id)) throw new Error(`duplicate lane id: ${proxy.id}`);
    edgeIds.add(proxy.id);
  }

  const ids = new Set<string>();
  const domainOwners = new Map<string, string>();
  for (const service of catalog.services) {
    assertString(service.id, "services[].id");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(service.id)) throw new Error(`invalid service id: ${service.id}`);
    assertString(service.label, `services.${service.id}.label`);
    assertUrl(service.probeUrl, `services.${service.id}.probeUrl`, ["https:"]);
    assertString(service.restriction, `services.${service.id}.restriction`);
    if (!(["local-proxy", "proxy", "vusa-proxy", "monitor"] as string[]).includes(service.route)) throw new Error(`invalid route for ${service.id}`);
    if (ids.has(service.id)) throw new Error(`duplicate service id: ${service.id}`);
    ids.add(service.id);
    if (!Array.isArray(service.domains) || !service.domains.length) throw new Error(`domains must be a non-empty string array for ${service.id}`);
    for (const domain of service.domains) {
      assertDomain(domain, `services.${service.id}.domains[]`);
      const owner = domainOwners.get(domain);
      if (owner) throw new Error(`duplicate domain ${domain}: ${owner} and ${service.id}`);
      domainOwners.set(domain, service.id);
    }
    const probeHost = new URL(service.probeUrl).hostname.toLowerCase();
    if (!service.domains.some((domain) => domainsRelated(probeHost, domain))) {
      throw new Error(`probeUrl host must belong to domains for ${service.id}`);
    }
  }
  return catalog as RestrictedServicesCatalog;
}

export async function loadRestrictedServicesCatalog(file = restrictedServicesCatalogPath()): Promise<RestrictedServicesCatalog> {
  return validateRestrictedServicesCatalog(JSON.parse(await readFile(file, "utf8")));
}

function assertRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
}

function assertBoolean(value: unknown, field: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
}

function assertNonNegativeInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${field} must be a non-negative integer`);
}

function assertNullableString(value: unknown, field: string): asserts value is string | null {
  if (value !== null && typeof value !== "string") throw new Error(`${field} must be a string or null`);
}

function assertIsoTimestamp(value: unknown, field: string): asserts value is string {
  assertString(value, field);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${field} must be an ISO timestamp`);
}

function validateProbeEvidence(value: unknown, field: string): RestrictedServiceProbeEvidence {
  assertRecord(value, field);
  assertNonNegativeInteger(value.attempt, `${field}.attempt`);
  if (value.attempt === 0) throw new Error(`${field}.attempt must be positive`);
  assertIsoTimestamp(value.startedAt, `${field}.startedAt`);
  assertNonNegativeInteger(value.durationMs, `${field}.durationMs`);
  if (value.curlExitCode !== null) assertNonNegativeInteger(value.curlExitCode, `${field}.curlExitCode`);
  assertBoolean(value.reachable, `${field}.reachable`);
  if (value.httpCode !== null) assertNonNegativeInteger(value.httpCode, `${field}.httpCode`);
  if (value.latencyMs !== null && (!Number.isFinite(value.latencyMs) || Number(value.latencyMs) < 0)) {
    throw new Error(`${field}.latencyMs must be a non-negative number or null`);
  }
  assertNullableString(value.remoteIp, `${field}.remoteIp`);
  assertNullableString(value.error, `${field}.error`);
  return value as unknown as RestrictedServiceProbeEvidence;
}

function validateProbeResult(value: unknown, field: string): RestrictedServiceStatusProbeResult {
  assertRecord(value, field);
  assertBoolean(value.reachable, `${field}.reachable`);
  if (!(["stable", "flaky", "down", "skipped"] as const).includes(value.stability as RestrictedProbeStability)) {
    throw new Error(`${field}.stability is invalid`);
  }
  assertNonNegativeInteger(value.attempts, `${field}.attempts`);
  assertNonNegativeInteger(value.successes, `${field}.successes`);
  if (value.successes > value.attempts) throw new Error(`${field}.successes cannot exceed attempts`);
  if (value.httpCode !== null) assertNonNegativeInteger(value.httpCode, `${field}.httpCode`);
  if (value.latencyMs !== null && (!Number.isFinite(value.latencyMs) || Number(value.latencyMs) < 0)) {
    throw new Error(`${field}.latencyMs must be a non-negative number or null`);
  }
  assertNullableString(value.remoteIp, `${field}.remoteIp`);
  assertNullableString(value.error, `${field}.error`);
  if (!Array.isArray(value.evidence)) throw new Error(`${field}.evidence must be an array`);
  value.evidence.forEach((attempt, index) => validateProbeEvidence(attempt, `${field}.evidence[${index}]`));
  if (value.evidence.length !== value.attempts) throw new Error(`${field}.evidence must contain one item per attempt`);
  if (value.stability === "skipped" && value.attempts !== 0) throw new Error(`${field}.skipped result cannot have attempts`);
  if (value.attempts === 0 && value.stability !== "skipped") throw new Error(`${field}.zero-attempt result must be skipped`);
  return value as unknown as RestrictedServiceStatusProbeResult;
}

/** Validate observational runtime status before rendering it in the admin UI. */
export function validateRestrictedServicesStatus(value: unknown): RestrictedServicesStatus {
  assertRecord(value, "restricted services status");
  if (value.schemaVersion !== 2) throw new Error("unsupported restricted services status schemaVersion");
  assertIsoTimestamp(value.generatedAt, "generatedAt");
  assertNonNegativeInteger(value.durationMs, "durationMs");
  assertIsoTimestamp(value.catalogUpdatedAt, "catalogUpdatedAt");
  if (value.observationalOnly !== true) throw new Error("observationalOnly must be true");

  assertRecord(value.run, "run");
  assertBoolean(value.run.probes, "run.probes");
  assertBoolean(value.run.externalFeeds, "run.externalFeeds");
  assertNonNegativeInteger(value.run.attempts, "run.attempts");
  assertNonNegativeInteger(value.run.laneConcurrency, "run.laneConcurrency");

  assertRecord(value.sourceSummary, "sourceSummary");
  for (const key of ["configured", "fetched", "failed", "skipped", "rules"]) {
    assertNonNegativeInteger(value.sourceSummary[key], `sourceSummary.${key}`);
  }

  if (!Array.isArray(value.feeds)) throw new Error("feeds must be an array");
  for (const [index, feed] of value.feeds.entries()) {
    assertRecord(feed, `feeds[${index}]`);
    assertString(feed.id, `feeds[${index}].id`);
    assertUrl(feed.url, `feeds[${index}].url`, ["https:"]);
    if (!(["ok", "error", "skipped"] as const).includes(feed.state as RestrictedFeedFetchState)) {
      throw new Error(`feeds[${index}].state is invalid`);
    }
    if (feed.fetchedAt !== null) assertIsoTimestamp(feed.fetchedAt, `feeds[${index}].fetchedAt`);
    assertNonNegativeInteger(feed.durationMs, `feeds[${index}].durationMs`);
    assertNonNegativeInteger(feed.ruleCount, `feeds[${index}].ruleCount`);
    assertNullableString(feed.error, `feeds[${index}].error`);
  }

  if (!Array.isArray(value.laneDefinitions) || !value.laneDefinitions.length) throw new Error("laneDefinitions must be a non-empty array");
  const laneIds = new Set<string>();
  for (const [index, lane] of value.laneDefinitions.entries()) {
    assertRecord(lane, `laneDefinitions[${index}]`);
    assertString(lane.id, `laneDefinitions[${index}].id`);
    assertString(lane.label, `laneDefinitions[${index}].label`);
    if (!(["direct", "sni", "http-proxy"] as const).includes(lane.kind as RestrictedProbeLaneKind)) {
      throw new Error(`laneDefinitions[${index}].kind is invalid`);
    }
    if (laneIds.has(lane.id)) throw new Error(`duplicate lane id: ${lane.id}`);
    laneIds.add(lane.id);
  }

  if (!Array.isArray(value.rows)) throw new Error("rows must be an array");
  const rowIds = new Set<string>();
  for (const [index, row] of value.rows.entries()) {
    assertRecord(row, `rows[${index}]`);
    assertString(row.id, `rows[${index}].id`);
    assertString(row.label, `rows[${index}].label`);
    assertString(row.restriction, `rows[${index}].restriction`);
    if (!(["local-proxy", "proxy", "vusa-proxy", "monitor"] as const).includes(row.route as RestrictedServiceRoute)) {
      throw new Error(`rows[${index}].route is invalid`);
    }
    if (rowIds.has(row.id)) throw new Error(`duplicate status row id: ${row.id}`);
    rowIds.add(row.id);
    if (!Array.isArray(row.externalFeeds) || row.externalFeeds.some((feed) => typeof feed !== "string")) {
      throw new Error(`rows[${index}].externalFeeds must be a string array`);
    }
    assertRecord(row.lanes, `rows[${index}].lanes`);
    for (const [laneId, result] of Object.entries(row.lanes)) {
      if (!laneIds.has(laneId)) throw new Error(`rows[${index}] contains unknown lane ${laneId}`);
      validateProbeResult(result, `rows[${index}].lanes.${laneId}`);
    }
  }

  assertRecord(value.summary, "summary");
  for (const laneId of laneIds) {
    const lane = value.summary[laneId];
    assertRecord(lane, `summary.${laneId}`);
    for (const key of ["reachable", "stable", "flaky", "down", "skipped", "total", "attempts", "successes"]) {
      assertNonNegativeInteger(lane[key], `summary.${laneId}.${key}`);
    }
  }
  return value as unknown as RestrictedServicesStatus;
}

export async function loadRestrictedServicesStatus(file = restrictedServicesStatusPath()): Promise<RestrictedServicesStatus | null> {
  try {
    return validateRestrictedServicesStatus(JSON.parse(await readFile(file, "utf8")));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function saveRestrictedServicesStatus(status: RestrictedServicesStatus, file = restrictedServicesStatusPath()): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

/** Add catalog-managed service domains without deleting administrator overrides, except retired catalog suffixes. */
export function mergeRestrictedServiceRoutes(policy: SmartDnsPolicy, catalog: RestrictedServicesCatalog): SmartDnsPolicy {
  const localProxySuffixes = new Set(policy.localProxySuffixes.map(normalizeDomain).filter(Boolean));
  const vusaProxySuffixes = new Set(policy.vusaProxySuffixes.map(normalizeDomain).filter(Boolean));
  // github.com was catalog-managed before Copilot's HTTPS-only route was narrowed.
  // DNS synthesis cannot distinguish Git SSH on :22, so remove the stale entry during sync.
  const proxySuffixes = new Set(policy.proxySuffixes.map(normalizeDomain).filter((domain) => domain && domain !== "github.com"));
  for (const service of catalog.services) {
    const target = service.route === "local-proxy"
      ? localProxySuffixes
      : service.route === "vusa-proxy"
        ? vusaProxySuffixes
        : service.route === "proxy"
          ? proxySuffixes
          : null;
    if (!target) continue;
    for (const domain of service.domains) target.add(normalizeDomain(domain));
  }
  return {
    ...policy,
    localProxySuffixes: [...localProxySuffixes].sort(),
    vusaProxySuffixes: [...vusaProxySuffixes].sort(),
    proxySuffixes: [...proxySuffixes].sort(),
  };
}

/** Parse the domain/full rules exposed by RunetFreedom release text files. */
export function parseRunetFreedomRules(text: string): string[] {
  const rules = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().toLowerCase();
    if (!line || line.startsWith("#") || line.startsWith("regexp:")) continue;
    const domain = line.replace(/^(domain|full):/, "").replace(/^\.+|\.+$/g, "");
    if (/^[a-z0-9._-]+$/.test(domain)) rules.add(domain);
  }
  return [...rules].sort();
}

/** Return true when a service root or one of its subdomains appears in a feed. */
export function matchesRunetFreedomRules(domains: string[], rules: string[]): boolean {
  return rules.some((rule) => domains.some((domain) => domainsRelated(domain, rule)));
}

/** Convert curl's compact write-out into a stable reachability record. */
export function classifyCurlProbe(exitCode: number | null, stdout: string, stderr = ""): RestrictedServiceProbeResult {
  const [rawCode = "000", rawSeconds = "", rawIp = ""] = stdout.trim().split("\t");
  const code = Number.parseInt(rawCode, 10);
  const seconds = Number.parseFloat(rawSeconds);
  const reachable = exitCode === 0 && Number.isFinite(code) && code >= 100 && code <= 599;
  return {
    reachable,
    stability: reachable ? "stable" : "down",
    attempts: 1,
    successes: reachable ? 1 : 0,
    httpCode: reachable ? code : null,
    latencyMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
    remoteIp: rawIp.trim() || null,
    error: reachable ? null : stderr.trim() || `curl exit ${exitCode ?? "unknown"}`,
  };
}

/** Aggregate repeated attempts so transient failures remain visible. */
export function combineProbeAttempts(attempts: RestrictedServiceProbeResult[]): RestrictedServiceProbeResult {
  if (!attempts.length) return { reachable: false, stability: "down", attempts: 0, successes: 0, httpCode: null, latencyMs: null, remoteIp: null, error: "not run" };
  const successful = attempts.filter((attempt) => attempt.reachable);
  const representative = [...successful].sort((a, b) => (a.latencyMs ?? Number.MAX_SAFE_INTEGER) - (b.latencyMs ?? Number.MAX_SAFE_INTEGER))[0] ?? attempts.at(-1)!;
  // One timeout is only weak evidence; require repeated failures before reporting a lane as down.
  const stability = successful.length === attempts.length ? "stable" : successful.length > 0 || attempts.length === 1 ? "flaky" : "down";
  return {
    ...representative,
    reachable: successful.length > 0,
    stability,
    attempts: attempts.length,
    successes: successful.length,
    error: successful.length === attempts.length ? null : `${attempts.length - successful.length}/${attempts.length} attempts failed`,
  };
}
