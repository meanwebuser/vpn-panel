import type {
  ProjectedScopeRoute,
  ProjectedServiceDomain,
  ServiceRoutingProjection,
} from "./service-catalog-activation.js";
import {
  normalizeSmartDnsPolicy,
  type SmartDnsPolicy,
} from "./smart-dns-policy.js";

const MANAGED_POLICY_LISTS = [
  "directDomains",
  "directSuffixes",
  "proxyDomains",
  "proxySuffixes",
  "localProxyDomains",
  "localProxySuffixes",
  "vusaProxyDomains",
  "vusaProxySuffixes",
] as const;

type ManagedPolicyList = (typeof MANAGED_POLICY_LISTS)[number];
type ProjectedProxy = Extract<ProjectedScopeRoute, { kind: "proxy" }>;
type PublicDnsProfile = "public" | "vusa";

type ProjectedPlacement =
  | { kind: "none" }
  | { kind: "direct" }
  | { kind: "local-proxy"; targetId: "vpn2" | "vusa" }
  | { kind: "proxy"; targetId: string; profileId: PublicDnsProfile };

interface PreparedDomain {
  domain: string;
  match: "exact" | "suffix";
  placement: ProjectedPlacement;
}

/** Render activation-ready catalog routes into an independent SmartDNS policy. */
export function renderCatalogSmartDnsPolicy(
  base: SmartDnsPolicy,
  previous: ServiceRoutingProjection | null,
  next: ServiceRoutingProjection,
): SmartDnsPolicy {
  const previousEntries = previous?.domains.map(prepareProjectedDomain) ?? [];
  const nextEntries = next.domains.map(prepareProjectedDomain);
  const managedDomains = new Set<string>();
  for (const entry of [...previousEntries, ...nextEntries]) managedDomains.add(entry.domain);

  const draft: SmartDnsPolicy = {
    ...base,
    ...Object.fromEntries(
      MANAGED_POLICY_LISTS.map((list) => [
        list,
        base[list].filter((value) => !managedDomains.has(normalizeDomain(value))),
      ]),
    ),
  } as SmartDnsPolicy;

  const placements = new Map<string, ProjectedPlacement>();
  for (const entry of nextEntries) {
    const identity = `${entry.match}\u0000${entry.domain}`;
    const priorPlacement = placements.get(identity);
    if (priorPlacement && placementKey(priorPlacement) !== placementKey(entry.placement)) {
      throw new Error(`conflicting duplicate projected domain: ${entry.match}/${entry.domain}`);
    }
    placements.set(identity, entry.placement);
    applyPreparedDomain(draft, entry);
  }
  return normalizeSmartDnsPolicy(draft);
}

function prepareProjectedDomain(entry: ProjectedServiceDomain): PreparedDomain {
  const domain = normalizeDomain(entry.domain);
  if (!domain) throw new Error("projected service domain must be non-empty");
  if (entry.match !== "exact" && entry.match !== "suffix") {
    throw new Error(`unsupported projected domain match for ${entry.serviceId}/${entry.domain}`);
  }

  const lan = entry.lan;
  const external = entry.external;
  validateRouteShape(lan, entry, "LAN");
  validateRouteShape(external, entry, "external");
  if (!lan && !external) throw new Error(`projected domain has no LAN or external route: ${entry.serviceId}/${entry.domain}`);
  const lanTarget = lan?.kind === "proxy" ? validateProxy(lan, entry, "LAN") : null;
  const externalTarget = external?.kind === "proxy" ? validateProxy(external, entry, "external") : null;
  if (lan?.kind === "proxy" && entry.match === "exact") {
    throw new Error(`exact LAN proxy is not representable: ${entry.serviceId}/${entry.domain}`);
  }

  if (external?.kind === "proxy") {
    if (!lan) throw new Error(`external-only proxy must be deferred: ${entry.serviceId}/${entry.domain}`);
    if (lan.kind !== "proxy") throw new Error(`combined LAN and external proxy is not representable: ${entry.serviceId}/${entry.domain}`);
    if (externalTarget === null || lanTarget === null) throw new Error(`malformed combined proxy: ${entry.serviceId}/${entry.domain}`);
    if (lanTarget?.targetId !== externalTarget?.targetId) {
      throw new Error(`combined LAN and external proxy targets differ: ${entry.serviceId}/${entry.domain}`);
    }
    return { domain, match: entry.match, placement: { kind: "proxy", targetId: externalTarget.targetId, profileId: externalTarget.profileId! } };
  }

  if (external?.kind === "direct") {
    if (lan?.kind === "proxy") throw new Error(`LAN proxy with external direct is not representable: ${entry.serviceId}/${entry.domain}`);
    return { domain, match: entry.match, placement: { kind: "direct" } };
  }

  if (lan?.kind === "proxy") {
    if (lanTarget === null) throw new Error(`malformed LAN proxy: ${entry.serviceId}/${entry.domain}`);
    return { domain, match: entry.match, placement: { kind: "local-proxy", targetId: lanTarget.targetId as "vpn2" | "vusa" } };
  }
  return { domain, match: entry.match, placement: { kind: "none" } };
}

function applyPreparedDomain(policy: SmartDnsPolicy, entry: PreparedDomain): void {
  switch (entry.placement.kind) {
    case "none":
      return;
    case "direct":
      addDomain(policy, entry.match, entry.domain, "directDomains", "directSuffixes");
      return;
    case "local-proxy":
      addDomain(policy, entry.match, entry.domain, "localProxyDomains", "localProxySuffixes");
      return;
    case "proxy":
      addProxyDomain(policy, entry.match, entry.domain, entry.placement.profileId);
      return;
  }
}

function validateRouteShape(route: ProjectedScopeRoute | undefined, entry: ProjectedServiceDomain, scope: string): void {
  if (route === undefined) return;
  if (route === null || typeof route !== "object" || (route.kind !== "direct" && route.kind !== "proxy")) {
    throw new Error(`malformed ${scope} route: ${entry.serviceId}/${entry.domain}`);
  }
}

function validateProxy(route: ProjectedProxy, entry: ProjectedServiceDomain, scope: string): { targetId: string; profileId?: PublicDnsProfile } {
  if (typeof route.targetId !== "string" || route.targetId.length === 0) {
    throw new Error(`${scope} proxy lacks targetId: ${entry.serviceId}/${entry.domain}`);
  }
  if (scope === "external") {
    if (route.profileId !== "public" && route.profileId !== "vusa") {
      throw new Error(`unsupported proxy profile ${String(route.profileId)}: ${entry.serviceId}/${entry.domain}`);
    }
    return { targetId: route.targetId, profileId: route.profileId };
  }
  if (route.targetId !== "vpn2" && route.targetId !== "vusa") {
    throw new Error(`unsupported proxy target ${route.targetId}: ${entry.serviceId}/${entry.domain}`);
  }
  return { targetId: route.targetId };
}

function addProxyDomain(policy: SmartDnsPolicy, match: "exact" | "suffix", domain: string, profileId: PublicDnsProfile): void {
  if (profileId === "public") addDomain(policy, match, domain, "proxyDomains", "proxySuffixes");
  else addDomain(policy, match, domain, "vusaProxyDomains", "vusaProxySuffixes");
}

function addDomain(
  policy: SmartDnsPolicy,
  match: "exact" | "suffix",
  domain: string,
  exactList: ManagedPolicyList,
  suffixList: ManagedPolicyList,
): void {
  policy[match === "exact" ? exactList : suffixList].push(domain);
}

function placementKey(placement: ProjectedPlacement): string {
  return placement.kind === "proxy" || placement.kind === "local-proxy"
    ? `${placement.kind}:${placement.targetId}:${placement.kind === "proxy" ? placement.profileId : ""}`
    : placement.kind;
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}
