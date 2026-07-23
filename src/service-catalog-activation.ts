import type { ServiceDomainMatch } from "./service-catalog.js";
import type {
  CompiledServiceCatalog,
  CompiledServiceRule,
} from "./service-catalog-compiler.js";

export interface ServiceRoutingProjection {
  schemaVersion: 1;
  sourceCatalogRevision: string;
  activePublicDnsEdgeId: string | null;
  domains: ProjectedServiceDomain[];
}

export interface ProjectedServiceDomain {
  serviceId: string;
  match: ServiceDomainMatch;
  domain: string;
  lan?: ProjectedScopeRoute;
  external?: ProjectedScopeRoute;
}

export type ProjectedScopeRoute =
  | { kind: "direct" }
  | { kind: "proxy"; targetId: string; balancerTag?: string; profileId?: "public" | "vusa" };

interface DomainGroup {
  serviceId: string;
  match: ServiceDomainMatch;
  domain: string;
  lan?: ProjectedScopeRoute;
  external?: ProjectedScopeRoute;
}

/** Lower an activation-ready compile result into the single runtime projection. */
export function lowerActivationReadyCatalog(compiled: CompiledServiceCatalog): ServiceRoutingProjection {
  assertActivationReady(compiled);
  const groups = new Map<string, DomainGroup>();
  for (const rule of compiled.rules) {
    const key = `${rule.serviceId}\u0000${rule.match}\u0000${rule.domain}`;
    let group = groups.get(key);
    if (!group) {
      group = { serviceId: rule.serviceId, match: rule.match, domain: rule.domain };
      groups.set(key, group);
    }
    const scopeKey = rule.scope;
    if (group[scopeKey] !== undefined) {
      throw new Error(`conflicting duplicate ${scopeKey} route for ${rule.serviceId} ${rule.match} ${rule.domain}`);
    }
    group[scopeKey] = projectRule(rule);
  }

  const domains = [...groups.values()];
  domains.sort(compareProjectedDomains);
  return {
    schemaVersion: 1,
    sourceCatalogRevision: compiled.sourceCatalogUpdatedAt,
    activePublicDnsEdgeId: compiled.activePublicDnsEdgeId,
    domains: domains.map((group) => ({ ...group })),
  };
}

function assertActivationReady(compiled: CompiledServiceCatalog): void {
  for (const rule of compiled.rules) {
    if (rule.scope === "lan" && rule.match === "exact" && rule.route.kind === "vps-pool" && rule.activation.state === "ready") {
      throw new Error(`unsupported ready LAN exact proxy rule for ${rule.serviceId}/${rule.domain}`);
    }
  }
  const deferred = compiled.rules
    .filter((rule) => rule.activation.state === "deferred")
    .map(formatDeferredRule);
  const diagnostics = compiled.diagnostics.map((diagnostic) => diagnostic.message || diagnostic.code);
  if (!compiled.activationReady || deferred.length > 0) {
    const details = [...deferred, ...diagnostics];
    throw new Error(`service catalog activation is not ready${details.length > 0 ? `: ${details.join("; ")}` : ""}`);
  }
  for (const rule of compiled.rules) {
    if (rule.activation.state !== "ready") {
      throw new Error(`service catalog activation is not ready: ${rule.serviceId}/${rule.scope}/${rule.domain}`);
    }
  }
}

function formatDeferredRule(rule: CompiledServiceRule): string {
  return rule.activation.state === "deferred"
    ? `${rule.serviceId}/${rule.scope}/${rule.domain}:${rule.activation.code}`
    : `${rule.serviceId}/${rule.scope}/${rule.domain}:unknown`;
}

function projectRule(rule: CompiledServiceRule): ProjectedScopeRoute {
  const activation = rule.activation;
  if (activation.state !== "ready") {
    throw new Error(`service catalog activation is not ready: ${rule.serviceId}/${rule.scope}/${rule.domain}`);
  }
  const binding = activation.binding;
  if (rule.route.kind === "direct") {
    if (!isExactBinding(binding, "direct")) throw malformedBinding(rule);
    return { kind: "direct" };
  }
  if (rule.scope === "lan") {
    if (!isLanBinding(binding)) throw malformedBinding(rule);
    return { kind: "proxy", targetId: binding.targetId, balancerTag: binding.balancerTag };
  }
  if (!isPublicBinding(binding)) throw malformedBinding(rule);
  if (binding.kind === "public-active-edge") return { kind: "proxy", targetId: binding.targetId, profileId: "public" };
  return { kind: "proxy", targetId: binding.targetId, profileId: binding.profileId };
}

function isLanBinding(binding: unknown): binding is { kind: "lan-balancer"; targetId: string; balancerTag: string } {
  return isExactKeys(binding, ["kind", "targetId", "balancerTag"])
    && binding.kind === "lan-balancer"
    && nonEmptyString(binding.targetId)
    && nonEmptyString(binding.balancerTag);
}

type PublicBinding =
  | { kind: "public-active-edge"; targetId: string }
  | { kind: "public-edge-profile"; targetId: string; profileId: "vusa" };

function isPublicBinding(binding: unknown): binding is PublicBinding {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) return false;
  const candidate = binding as Record<string, unknown>;
  if (candidate.kind === "public-active-edge") {
    return isExactKeys(candidate, ["kind", "targetId"]) && nonEmptyString(candidate.targetId);
  }
  return isExactKeys(candidate, ["kind", "targetId", "profileId"])
    && candidate.kind === "public-edge-profile"
    && nonEmptyString(candidate.targetId)
    && candidate.profileId === "vusa";
}

function isExactBinding(binding: unknown, kind: "direct"): binding is { kind: "direct" } {
  return isExactKeys(binding, ["kind"]) && binding.kind === kind;
}

function isExactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function malformedBinding(rule: CompiledServiceRule): Error {
  return new Error(`malformed ready binding for ${rule.serviceId}/${rule.scope}/${rule.domain}`);
}

function compareProjectedDomains(left: DomainGroup, right: DomainGroup): number {
  if (left.match !== right.match) return left.match === "exact" ? -1 : 1;
  if (left.match === "suffix" && left.domain.length !== right.domain.length) {
    return right.domain.length - left.domain.length;
  }
  const domainOrder = lexicalCompare(left.domain, right.domain);
  return domainOrder !== 0 ? domainOrder : lexicalCompare(left.serviceId, right.serviceId);
}

function lexicalCompare(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
