import type { RestrictedServiceDefinition, RestrictedServicesCatalog } from "./restricted-services.js";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export type ServiceDomainMatch = "exact" | "suffix";
export type ServiceWorkIn = "lan-only" | "external" | "both";

export interface ServiceWorkInSelection {
  lan: boolean;
  external: boolean;
}

/** Convert independent editor checkboxes into the persisted WorkIn enum. */
export function normalizeServiceWorkIn(selection: ServiceWorkInSelection): ServiceWorkIn {
  if (selection.lan && selection.external) return "both";
  if (selection.lan) return "lan-only";
  if (selection.external) return "external";
  throw new Error("at least one WorkIn scope is required");
}

export type ServiceRouteTo =
  | { kind: "direct" }
  | { kind: "vps-pool"; allowedVpsIds: string[]; onNoHealthyTarget: "servfail" | "direct" };

export interface ServiceDomainRule {
  match: ServiceDomainMatch;
  value: string;
}

export interface ServiceDefinition {
  id: string;
  label: string;
  enabled?: boolean;
  probeUrl?: string;
  restriction?: string;
  domains: ServiceDomainRule[];
  workIn: ServiceWorkIn;
  routeTo: ServiceRouteTo;
}

export interface ServiceCatalog {
  schemaVersion: 2;
  updatedAt: string;
  description: string;
  services: ServiceDefinition[];
}

export interface ServiceTargetCapability {
  id: string;
  publicDnsEdge: boolean;
  lanEgress: boolean;
  lanBalancerTag?: string;
  dedicatedPublicDnsProfile?: "vusa";
}

export interface LegacyServiceCompilePools {
  defaultPoolIds: string[];
  localPoolIds: string[];
  vusaPoolIds: string[];
}

export interface ResolvedServiceRoute {
  service: ServiceDefinition;
  rule: ServiceDomainRule;
}

export interface SaveServiceCatalogOptions {
  /** Require the file to still carry this revision before replacing it. */
  expectedRevision?: string;
  /** Internal legacy-bootstrap exception: permit the first write when no file exists. */
  allowMissingExpectedRevision?: boolean;
}

export class ServiceCatalogRevisionConflictError extends Error {
  readonly code = "SERVICE_CATALOG_REVISION_CONFLICT";
  readonly expectedRevision: string;
  readonly currentRevision?: string;

  constructor(expectedRevision: string, currentRevision?: string) {
    super(`service catalog revision conflict: expected ${expectedRevision}, current ${currentRevision ?? "missing"}`);
    this.name = "ServiceCatalogRevisionConflictError";
    this.expectedRevision = expectedRevision;
    this.currentRevision = currentRevision;
  }
}

const saveLocks = new Map<string, Promise<void>>();

async function withSaveLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = saveLocks.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  saveLocks.set(filePath, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (saveLocks.get(filePath) === current) saveLocks.delete(filePath);
  }
}

/** Return the configured durable service-catalog path. */
export function serviceCatalogPath(): string {
  const configuredPath = process.env.VPN_PANEL_SERVICE_CATALOG;
  return configuredPath ? configuredPath : path.join(process.cwd(), "data", "service-catalog.json");
}

/** Load and validate a durable service catalog from disk. */
export async function loadServiceCatalog(filePath = serviceCatalogPath()): Promise<ServiceCatalog> {
  const raw = await readFile(filePath, "utf8");
  return validateServiceCatalog(JSON.parse(raw) as unknown);
}

/** Validate and atomically persist a service catalog without mutating its input. */
export async function saveServiceCatalog(catalog: ServiceCatalog, filePath = serviceCatalogPath(), options: SaveServiceCatalogOptions = {}): Promise<ServiceCatalog> {
  const validated = validateServiceCatalog(catalog);

  const canonicalPath = path.resolve(filePath);
  return withSaveLock(canonicalPath, async () => {
    let current: ServiceCatalog | undefined;
    if (options.expectedRevision !== undefined) {
      try {
        current = await loadServiceCatalog(canonicalPath);
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT" && options.allowMissingExpectedRevision) {
          current = undefined;
        } else if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
          throw new ServiceCatalogRevisionConflictError(options.expectedRevision);
        } else {
          throw error;
        }
      }
      if (current && (options.allowMissingExpectedRevision || current.updatedAt !== options.expectedRevision)) {
        throw new ServiceCatalogRevisionConflictError(options.expectedRevision, current.updatedAt);
      }
    }
    const currentTimestamp = current ? Date.parse(current.updatedAt) : 0;
    const updatedAt = new Date(Math.max(Date.now(), Number.isFinite(currentTimestamp) ? currentTimestamp + 1 : 0)).toISOString();
    const saved = JSON.parse(JSON.stringify({ ...validated, updatedAt })) as ServiceCatalog;
    validateServiceCatalog(saved);
    const parentDirectory = path.dirname(canonicalPath);
    const temporaryPath = `${canonicalPath}.tmp-${process.pid}-${randomUUID()}`;
    await mkdir(parentDirectory, { recursive: true });
    try {
      await writeFile(temporaryPath, `${JSON.stringify(saved, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporaryPath, canonicalPath);
    } catch (error) {
      try {
        await unlink(temporaryPath);
      } catch {
        // The temporary file may already have been renamed or never created.
      }
      throw error;
    }
    return saved;
  });
}

const SERVICE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
}

function assertDomain(value: unknown, field: string): asserts value is string {
  assertString(value, field);
  if (value !== normalizeDomain(value) || !DOMAIN_PATTERN.test(value)) {
    throw new Error(`${field} must be a normalized domain name`);
  }
}

function scopesFor(workIn: ServiceWorkIn): Array<Exclude<ServiceWorkIn, "both">> {
  if (workIn === "both") return ["lan-only", "external"];
  return [workIn];
}

function routeSignature(routeTo: ServiceRouteTo): string {
  return routeTo.kind === "direct"
    ? "direct"
    : `${routeTo.kind}:${routeTo.allowedVpsIds.join(",")}:${routeTo.onNoHealthyTarget}`;
}

function validateRouteTo(value: unknown, field: string): asserts value is ServiceRouteTo {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  const route = value as Partial<ServiceRouteTo> & { allowedVpsIds?: unknown; onNoHealthyTarget?: unknown };
  const ownFields = Object.keys(route);
  if (route.kind === "direct") {
    if (ownFields.length !== 1 || ownFields[0] !== "kind") {
      throw new Error(`${field} must contain exactly kind for direct routes`);
    }
    return;
  }
  if (route.kind !== "vps-pool") throw new Error(`${field}.kind must be direct or vps-pool`);
  const expectedPoolFields = ["kind", "allowedVpsIds", "onNoHealthyTarget"];
  if (ownFields.length !== expectedPoolFields.length || expectedPoolFields.some((key) => !ownFields.includes(key))) {
    throw new Error(`${field} must contain exactly kind, allowedVpsIds, onNoHealthyTarget for vps-pool routes`);
  }
  if (!Array.isArray(route.allowedVpsIds) || route.allowedVpsIds.length === 0) {
    throw new Error(`${field}.allowedVpsIds must be a non-empty array`);
  }
  const ids = new Set<string>();
  for (const id of route.allowedVpsIds) {
    assertString(id, `${field}.allowedVpsIds[]`);
    if (ids.has(id)) throw new Error(`${field}.allowedVpsIds must not contain duplicates`);
    ids.add(id);
  }
  if (route.onNoHealthyTarget !== "servfail" && route.onNoHealthyTarget !== "direct") {
    throw new Error(`${field}.onNoHealthyTarget must be servfail or direct`);
  }
}

/** Validate the canonical v2 service catalog before it can affect routing. */
export function validateServiceCatalog(value: unknown): ServiceCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("service catalog must be an object");
  const catalog = value as Partial<ServiceCatalog>;
  if (catalog.schemaVersion !== 2) throw new Error("unsupported service catalog schemaVersion");
  assertString(catalog.updatedAt, "updatedAt");
  if (Number.isNaN(Date.parse(catalog.updatedAt))) throw new Error("updatedAt must be an ISO date or timestamp");
  assertString(catalog.description, "description");
  if (!Array.isArray(catalog.services)) throw new Error("services must be an array");

  const serviceIds = new Set<string>();
  const ruleOwners = new Map<string, string>();
  for (const service of catalog.services) {
    if (!service || typeof service !== "object") throw new Error("services[] must be an object");
    assertString(service.id, "services[].id");
    if (!SERVICE_ID.test(service.id)) throw new Error(`invalid service id: ${service.id}`);
    if (serviceIds.has(service.id)) throw new Error(`duplicate service id: ${service.id}`);
    serviceIds.add(service.id);
    assertString(service.label, `services.${service.id}.label`);
    if (service.enabled !== undefined && typeof service.enabled !== "boolean") {
      throw new Error(`services.${service.id}.enabled must be a boolean`);
    }
    if (service.probeUrl !== undefined) {
      assertString(service.probeUrl, `services.${service.id}.probeUrl`);
      if (new URL(service.probeUrl).protocol !== "https:") throw new Error(`services.${service.id}.probeUrl must use https`);
    }
    if (service.restriction !== undefined) assertString(service.restriction, `services.${service.id}.restriction`);
    if (service.workIn !== "lan-only" && service.workIn !== "external" && service.workIn !== "both") {
      throw new Error(`invalid workIn for ${service.id}`);
    }
    validateRouteTo(service.routeTo, `services.${service.id}.routeTo`);
    if (!Array.isArray(service.domains) || service.domains.length === 0) {
      throw new Error(`services.${service.id}.domains must be a non-empty array`);
    }
    for (const rule of service.domains) {
      if (!rule || typeof rule !== "object") throw new Error(`services.${service.id}.domains[] must be an object`);
      if (rule.match !== "exact" && rule.match !== "suffix") throw new Error(`invalid domain match for ${service.id}`);
      assertDomain(rule.value, `services.${service.id}.domains[].value`);
      const key = `${rule.match}:${rule.value}`;
      const owner = ruleOwners.get(key);
      if (owner) throw new Error(`conflicting ${rule.match} domain rule ${rule.value}: ${owner} and ${service.id}`);
      ruleOwners.set(key, service.id);
    }
  }
  return catalog as ServiceCatalog;
}

/** Reject pools that cannot carry the service in every selected execution scope. */
export function validateServiceTargetCapabilities(catalog: ServiceCatalog, targets: ServiceTargetCapability[]): void {
  const byId = new Map(targets.map((target) => [target.id, target]));
  for (const service of catalog.services) {
    if (service.routeTo.kind === "direct") continue;
    for (const id of service.routeTo.allowedVpsIds) {
      const target = byId.get(id);
      if (!target) throw new Error(`service ${service.id} references unknown VPS ${id}`);
      if ((service.workIn === "external" || service.workIn === "both") && !target.publicDnsEdge) {
        throw new Error(`service ${service.id} VPS ${id} does not support public DNS`);
      }
      if ((service.workIn === "lan-only" || service.workIn === "both") && (!target.lanEgress || !target.lanBalancerTag)) {
        throw new Error(`service ${service.id} VPS ${id} does not support LAN egress`);
      }
    }
  }
}

function legacyRoute(service: RestrictedServiceDefinition, pools: LegacyServiceCompilePools): Pick<ServiceDefinition, "workIn" | "routeTo"> {
  switch (service.route) {
    case "local-proxy":
      return { workIn: "lan-only", routeTo: { kind: "vps-pool", allowedVpsIds: [...pools.localPoolIds], onNoHealthyTarget: "servfail" } };
    case "proxy":
      return { workIn: "both", routeTo: { kind: "vps-pool", allowedVpsIds: [...pools.defaultPoolIds], onNoHealthyTarget: "servfail" } };
    case "vusa-proxy":
      return { workIn: "both", routeTo: { kind: "vps-pool", allowedVpsIds: [...pools.vusaPoolIds], onNoHealthyTarget: "servfail" } };
    case "monitor":
      return { workIn: "lan-only", routeTo: { kind: "direct" } };
  }
}

/** Compile legacy v1 service rows into v2 without modifying the checked-in source catalog. */
export function compileLegacyServiceCatalog(legacy: RestrictedServicesCatalog, pools: LegacyServiceCompilePools): ServiceCatalog {
  const catalog: ServiceCatalog = {
    schemaVersion: 2,
    updatedAt: legacy.updatedAt,
    description: legacy.description,
    services: legacy.services.map((service) => ({
      id: service.id,
      label: service.label,
      enabled: true,
      probeUrl: service.probeUrl,
      restriction: service.restriction,
      domains: service.domains.map((value) => ({ match: "suffix" as const, value })),
      ...legacyRoute(service, pools),
    })),
  };
  return validateServiceCatalog(catalog);
}

function matches(host: string, rule: ServiceDomainRule): boolean {
  return rule.match === "exact" ? host === rule.value : host === rule.value || host.endsWith(`.${rule.value}`);
}

/** Resolve one scope with deterministic exact-then-longest-suffix precedence. */
export function resolveServiceRoute(host: string, scope: Exclude<ServiceWorkIn, "both">, catalog: ServiceCatalog): ResolvedServiceRoute | null {
  const normalizedHost = normalizeDomain(host);
  const candidates: ResolvedServiceRoute[] = [];
  for (const service of catalog.services) {
    if (service.enabled === false || !scopesFor(service.workIn).includes(scope)) continue;
    for (const rule of service.domains) {
      if (matches(normalizedHost, rule)) candidates.push({ service, rule });
    }
  }
  candidates.sort((left, right) => {
    if (left.rule.match !== right.rule.match) return left.rule.match === "exact" ? -1 : 1;
    return right.rule.value.length - left.rule.value.length;
  });
  return candidates[0] ?? null;
}
