import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ProjectedScopeRoute,
  ProjectedServiceDomain,
  ServiceRoutingProjection,
} from "./service-catalog-activation.js";

const SERVICE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Return the configured durable activation projection path. */
export function activeServiceCatalogProjectionPath(): string {
  return process.env.VPN_PANEL_SERVICE_CATALOG_ACTIVE_PROJECTION
    || path.join(process.cwd(), "data", "service-catalog-active-projection.json");
}

/** Load and strictly validate the active projection, treating only ENOENT as absent. */
export async function loadActiveServiceCatalogProjection(filePath = activeServiceCatalogProjectionPath()): Promise<ServiceRoutingProjection | null> {
  try {
    return validateActiveServiceCatalogProjection(JSON.parse(await readFile(filePath, "utf8")) as unknown);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
    throw error;
  }
}

/** Validate and atomically persist a canonical projection without mutating its input. */
export async function saveActiveServiceCatalogProjection(
  projection: ServiceRoutingProjection,
  filePath = activeServiceCatalogProjectionPath(),
): Promise<void> {
  const saved = validateActiveServiceCatalogProjection(projection);
  const canonicalPath = path.resolve(filePath);
  const temporaryPath = `${canonicalPath}.tmp-${process.pid}-${randomUUID()}`;
  await mkdir(path.dirname(canonicalPath), { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(saved, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, canonicalPath);
  } catch (error: unknown) {
    try {
      await unlink(temporaryPath);
    } catch {
      // The temporary file may already have been renamed or never created.
    }
    throw error;
  }
}

function validateActiveServiceCatalogProjection(value: unknown): ServiceRoutingProjection {
  const projection = asRecord(value, "active service catalog projection");
  requireExactKeys(projection, ["schemaVersion", "sourceCatalogRevision", "activePublicDnsEdgeId", "domains"], "projection");
  if (projection.schemaVersion !== 1) throw new Error("unsupported active projection schemaVersion");
  const sourceCatalogRevision = canonicalString(projection.sourceCatalogRevision, "sourceCatalogRevision");
  const activePublicDnsEdgeId = canonicalString(projection.activePublicDnsEdgeId, "activePublicDnsEdgeId");
  if (!Array.isArray(projection.domains)) throw new Error("projection.domains must be an array");

  const seen = new Set<string>();
  const domains = projection.domains.map((value, index) => {
    const entry = asRecord(value, `projection.domains[${index}]`);
    requireExactKeys(entry, ["serviceId", "match", "domain"], `projection.domains[${index}]`, ["lan", "external"]);
    const serviceId = canonicalServiceId(entry.serviceId, `projection.domains[${index}].serviceId`);
    if (entry.match !== "exact" && entry.match !== "suffix") throw new Error(`invalid projection match for ${serviceId}`);
    const domain = canonicalDomain(entry.domain, `projection.domains[${index}].domain`);
    const identity = `${entry.match}\u0000${domain}`;
    if (seen.has(identity)) throw new Error(`duplicate projected domain: ${serviceId}/${domain}`);
    seen.add(identity);
    const lan = entry.lan === undefined ? undefined : validateRoute(entry.lan, "LAN", serviceId, domain);
    const external = entry.external === undefined ? undefined : validateRoute(entry.external, "external", serviceId, domain);
    if (lan === undefined && external === undefined) throw new Error(`projected domain has no route: ${serviceId}/${domain}`);
    if (lan?.kind === "proxy" && entry.match === "exact") throw new Error(`exact LAN proxy is not representable: ${serviceId}/${domain}`);
    if (external?.kind === "proxy") {
      if (!lan) throw new Error(`external-only proxy must be deferred: ${serviceId}/${domain}`);
      if (lan.kind !== "proxy" || lan.targetId !== external.targetId) {
        throw new Error(`combined LAN and external proxy targets differ: ${serviceId}/${domain}`);
      }
    }
    if (external?.kind === "direct" && lan?.kind === "proxy") {
      throw new Error(`LAN proxy with external direct is not representable: ${serviceId}/${domain}`);
    }
    return {
      serviceId,
      match: entry.match,
      domain,
      ...(lan === undefined ? {} : { lan }),
      ...(external === undefined ? {} : { external }),
    } satisfies ProjectedServiceDomain;
  });

  domains.sort(compareProjectedDomains);
  return { schemaVersion: 1, sourceCatalogRevision, activePublicDnsEdgeId, domains };
}

function validateRoute(value: unknown, scope: string, serviceId: string, domain: string): ProjectedScopeRoute {
  const route = asRecord(value, `${scope} route for ${serviceId}/${domain}`);
  if (route.kind === "direct") {
    requireExactKeys(route, ["kind"], `${scope} route for ${serviceId}/${domain}`);
    return { kind: "direct" };
  }
  if (route.kind !== "proxy") throw new Error(`malformed ${scope} route: ${serviceId}/${domain}`);
  const isLan = scope === "LAN";
  requireExactKeys(
    route,
    isLan ? ["kind", "targetId", "balancerTag"] : ["kind", "targetId"],
    `${scope} route for ${serviceId}/${domain}`,
    isLan ? [] : ["profileId"],
  );
  const targetId = canonicalString(route.targetId, `${scope} targetId for ${serviceId}/${domain}`);
  if (!isLan) {
    const profileId = route.profileId;
    if (profileId !== "public" && profileId !== "vusa") {
      throw new Error(`unsupported proxy profile ${String(profileId)}: ${serviceId}/${domain}`);
    }
    return { kind: "proxy", targetId, profileId };
  }
  return { kind: "proxy", targetId, balancerTag: canonicalString(route.balancerTag, `LAN balancerTag for ${serviceId}/${domain}`) };
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function requireExactKeys(value: Record<string, unknown>, required: string[], field: string, optional: string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  const actual = Object.keys(value);
  if (actual.some((key) => !allowed.has(key)) || required.some((key) => !actual.includes(key))) {
    throw new Error(`${field} contains unexpected or missing fields`);
  }
}

function canonicalString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || /\s/.test(value)) throw new Error(`${field} must be a canonical non-empty string`);
  return value;
}

function canonicalServiceId(value: unknown, field: string): string {
  const serviceId = canonicalString(value, field);
  if (!SERVICE_ID.test(serviceId)) throw new Error(`${field} must be a canonical service ID`);
  return serviceId;
}

function canonicalDomain(value: unknown, field: string): string {
  const domain = canonicalString(value, field);
  if (!DOMAIN.test(domain)) throw new Error(`${field} must be a canonical domain name`);
  return domain;
}

function compareProjectedDomains(left: ProjectedServiceDomain, right: ProjectedServiceDomain): number {
  if (left.match !== right.match) return left.match === "exact" ? -1 : 1;
  if (left.match === "suffix" && left.domain.length !== right.domain.length) return right.domain.length - left.domain.length;
  if (left.domain !== right.domain) return left.domain < right.domain ? -1 : 1;
  return left.serviceId === right.serviceId ? 0 : left.serviceId < right.serviceId ? -1 : 1;
}
