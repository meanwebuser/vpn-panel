import assert from "node:assert/strict";
import test from "node:test";

import { compileServiceCatalog } from "../src/service-catalog-compiler.js";
import type { ServiceCatalog, ServiceTargetCapability } from "../src/service-catalog.js";

const targets: ServiceTargetCapability[] = [
  { id: "lan-a", publicDnsEdge: false, lanEgress: true, lanBalancerTag: "lan-a-tag" },
  { id: "edge-a", publicDnsEdge: true, lanEgress: false },
  { id: "edge-b", publicDnsEdge: true, lanEgress: false },
  { id: "dual", publicDnsEdge: true, lanEgress: true, lanBalancerTag: "dual-tag" },
  { id: "dual-b", publicDnsEdge: true, lanEgress: true, lanBalancerTag: "dual-b-tag" },
];

function catalog(services: ServiceCatalog["services"]): ServiceCatalog {
  return { schemaVersion: 2, updatedAt: "2026-07-19T00:00:00.000Z", description: "compiler test", services };
}

test("expands both scopes and omits disabled services", () => {
  const compiled = compileServiceCatalog(catalog([
    {
      id: "both-service",
      label: "Both",
      domains: [{ match: "exact", value: "both.example.com" }],
      workIn: "both",
      routeTo: { kind: "direct" },
    },
    {
      id: "disabled-service",
      label: "Disabled",
      enabled: false,
      domains: [{ match: "exact", value: "disabled.example.com" }],
      workIn: "both",
      routeTo: { kind: "direct" },
    },
  ]), { targets, activePublicDnsEdgeId: null });

  assert.deepEqual(compiled.rules.map((rule) => [rule.serviceId, rule.scope, rule.domain]), [
    ["both-service", "lan", "both.example.com"],
    ["both-service", "external", "both.example.com"],
  ]);
});

test("orders exact rules before suffix rules and longer suffixes before shorter ones", () => {
  const compiled = compileServiceCatalog(catalog([
    { id: "short-suffix", label: "Short", domains: [{ match: "suffix", value: "example.com" }], workIn: "lan-only", routeTo: { kind: "direct" } },
    { id: "exact-z", label: "Exact Z", domains: [{ match: "exact", value: "z.example.net" }], workIn: "lan-only", routeTo: { kind: "direct" } },
    { id: "long-suffix", label: "Long", domains: [{ match: "suffix", value: "deep.example.com" }], workIn: "lan-only", routeTo: { kind: "direct" } },
    { id: "exact-a", label: "Exact A", domains: [{ match: "exact", value: "a.example.net" }], workIn: "lan-only", routeTo: { kind: "direct" } },
  ]), { targets, activePublicDnsEdgeId: null });

  assert.deepEqual(compiled.rules.map((rule) => `${rule.match}:${rule.domain}:${rule.serviceId}`), [
    "exact:a.example.net:exact-a",
    "exact:z.example.net:exact-z",
    "suffix:deep.example.com:long-suffix",
    "suffix:example.com:short-suffix",
  ]);
});

test("direct rules are ready without target, edge, or balancer bindings", () => {
  const compiled = compileServiceCatalog(catalog([
    { id: "direct-service", label: "Direct", domains: [{ match: "exact", value: "direct.example.com" }], workIn: "external", routeTo: { kind: "direct" } },
  ]), { targets: [], activePublicDnsEdgeId: null });

  assert.deepEqual(compiled.rules[0]?.route, { kind: "direct" });
  assert.deepEqual(compiled.rules[0]?.activation, { state: "ready", binding: { kind: "direct" } });
});

test("singleton LAN pool with direct fallback is deferred safely", () => {
  const compiled = compileServiceCatalog(catalog([
    { id: "lan-service", label: "LAN", domains: [{ match: "suffix", value: "lan.example.com" }], workIn: "lan-only", routeTo: { kind: "vps-pool", allowedVpsIds: ["lan-a"], onNoHealthyTarget: "direct" } },
  ]), { targets, activePublicDnsEdgeId: null });

  assert.deepEqual(compiled.rules[0]?.activation, { state: "deferred", code: "direct-fallback-unavailable" });
});

test("singleton LAN exact proxy is deferred as unrepresentable", () => {
  const compiled = compileServiceCatalog(catalog([
    { id: "lan-exact", label: "LAN exact", domains: [{ match: "exact", value: "lan.example.com" }], workIn: "lan-only", routeTo: { kind: "vps-pool", allowedVpsIds: ["lan-a"], onNoHealthyTarget: "servfail" } },
  ]), { targets, activePublicDnsEdgeId: null });

  assert.deepEqual(compiled.rules[0]?.activation, { state: "deferred", code: "lan-exact-proxy-unrepresentable" });
  assert.equal(compiled.diagnostics[0]?.message, "lan-exact lan exact proxy rule for lan.example.com is deferred because OpenWrt dnsmasq local/address rules also match subdomains; exact LAN proxy matching is not representable");
  assert.equal(compiled.activationReady, false);
});

test("exact direct rules and suffix LAN pools remain ready", () => {
  const compiled = compileServiceCatalog(catalog([
    { id: "lan-direct", label: "LAN direct", domains: [{ match: "exact", value: "direct.lan.example.com" }], workIn: "lan-only", routeTo: { kind: "direct" } },
    { id: "external-direct", label: "External direct", domains: [{ match: "exact", value: "direct.example.com" }], workIn: "external", routeTo: { kind: "direct" } },
    { id: "lan-suffix", label: "LAN suffix", domains: [{ match: "suffix", value: "suffix.example.com" }], workIn: "lan-only", routeTo: { kind: "vps-pool", allowedVpsIds: ["lan-a"], onNoHealthyTarget: "servfail" } },
  ]), { targets, activePublicDnsEdgeId: null });

  assert.equal(compiled.activationReady, true);
  assert.deepEqual(compiled.rules.map((rule) => `${rule.serviceId}:${rule.activation.state}:${rule.activation.state === "ready" ? rule.activation.binding.kind : rule.activation.code}`), [
    "lan-direct:ready:direct",
    "lan-suffix:ready:lan-balancer",
    "external-direct:ready:direct",
  ]);
});

test("singleton external-only pool is deferred even for the active public DNS edge", () => {
  const base = {
    id: "external-service",
    label: "External",
    domains: [{ match: "exact" as const, value: "external.example.com" }],
    workIn: "external" as const,
    routeTo: { kind: "vps-pool" as const, allowedVpsIds: ["edge-a"], onNoHealthyTarget: "servfail" as const },
  };
  const active = compileServiceCatalog(catalog([base]), { targets, activePublicDnsEdgeId: "edge-a" });
  assert.deepEqual(active.rules[0]?.activation, { state: "deferred", code: "external-only-pool-unavailable" });

  const deferred = compileServiceCatalog(catalog([base]), { targets, activePublicDnsEdgeId: "edge-b" });
  assert.deepEqual(deferred.rules[0]?.activation, { state: "deferred", code: "external-only-pool-unavailable" });
  assert.equal(deferred.activationReady, false);
  assert.equal(deferred.diagnostics[0]?.code, "external-only-pool-unavailable");
});

test("both-scope VUSA singleton uses its explicit public profile while VPN2 stays active", () => {
  const compiled = compileServiceCatalog(catalog([
    { id: "antigravity", label: "Antigravity", domains: [{ match: "suffix", value: "antigravity.google" }], workIn: "both", routeTo: { kind: "vps-pool", allowedVpsIds: ["vusa"], onNoHealthyTarget: "servfail" } },
  ]), {
    targets: [
      { id: "vpn2", publicDnsEdge: true, lanEgress: true, lanBalancerTag: "proxy" },
      { id: "vusa", publicDnsEdge: true, lanEgress: true, lanBalancerTag: "us-auto", dedicatedPublicDnsProfile: "vusa" },
    ],
    activePublicDnsEdgeId: "vpn2",
  });

  assert.equal(compiled.activationReady, true);
  assert.deepEqual(compiled.rules.map((rule) => rule.activation), [
    { state: "ready", binding: { kind: "lan-balancer", targetId: "vusa", balancerTag: "us-auto" } },
    { state: "ready", binding: { kind: "public-edge-profile", targetId: "vusa", profileId: "vusa" } },
  ]);
});

test("inactive public VPS without an explicit profile remains deferred", () => {
  const compiled = compileServiceCatalog(catalog([
    { id: "arbitrary", label: "Arbitrary", domains: [{ match: "suffix", value: "arbitrary.example.com" }], workIn: "both", routeTo: { kind: "vps-pool", allowedVpsIds: ["inactive"], onNoHealthyTarget: "servfail" } },
  ]), {
    targets: [{ id: "inactive", publicDnsEdge: true, lanEgress: true, lanBalancerTag: "inactive-lan" }],
    activePublicDnsEdgeId: "vpn2",
  });

  assert.deepEqual(compiled.rules.find((rule) => rule.scope === "external")?.activation, { state: "deferred", code: "public-target-not-active" });
});

test("external-only VUSA pool remains deferred despite its dedicated profile", () => {
  const compiled = compileServiceCatalog(catalog([
    { id: "external-vusa", label: "External VUSA", domains: [{ match: "suffix", value: "external-vusa.example.com" }], workIn: "external", routeTo: { kind: "vps-pool", allowedVpsIds: ["vusa"], onNoHealthyTarget: "servfail" } },
  ]), {
    targets: [{ id: "vusa", publicDnsEdge: true, lanEgress: true, lanBalancerTag: "us-auto", dedicatedPublicDnsProfile: "vusa" }],
    activePublicDnsEdgeId: "vpn2",
  });

  assert.deepEqual(compiled.rules[0]?.activation, { state: "deferred", code: "external-only-pool-unavailable" });
});

test("multi-VPS pools preserve sorted IDs and fallback while deferring activation", () => {
  const compiled = compileServiceCatalog(catalog([
    { id: "pool-service", label: "Pool", domains: [{ match: "suffix", value: "pool.example.com" }], workIn: "lan-only", routeTo: { kind: "vps-pool", allowedVpsIds: ["dual-b", "dual"], onNoHealthyTarget: "servfail" } },
  ]), { targets, activePublicDnsEdgeId: "edge-a" });

  assert.deepEqual(compiled.rules[0]?.route, { kind: "vps-pool", allowedVpsIds: ["dual", "dual-b"], selection: "fastest-healthy", onNoHealthyTarget: "servfail" });
  assert.deepEqual(compiled.rules[0]?.activation, { state: "deferred", code: "multi-vps-selector-unavailable" });
  assert.equal(compiled.diagnostics[0]?.serviceId, "pool-service");
});

test("external-only precedence wins over multi-VPS selector deferral", () => {
  const compiled = compileServiceCatalog(catalog([
    { id: "external-multi", label: "External multi", domains: [{ match: "exact", value: "external-multi.example.com" }], workIn: "external", routeTo: { kind: "vps-pool", allowedVpsIds: ["edge-b", "edge-a"], onNoHealthyTarget: "servfail" } },
  ]), { targets, activePublicDnsEdgeId: "edge-a" });

  assert.deepEqual(compiled.rules[0]?.activation, { state: "deferred", code: "external-only-pool-unavailable" });
  assert.equal(compiled.diagnostics[0]?.code, "external-only-pool-unavailable");
});

test("external-only precedence wins when multi-VPS also uses direct fallback", () => {
  const compiled = compileServiceCatalog(catalog([
    { id: "external-multi-direct", label: "External multi direct", domains: [{ match: "exact", value: "external-multi-direct.example.com" }], workIn: "external", routeTo: { kind: "vps-pool", allowedVpsIds: ["edge-b", "edge-a"], onNoHealthyTarget: "direct" } },
  ]), { targets, activePublicDnsEdgeId: "edge-a" });

  assert.deepEqual(compiled.rules[0]?.activation, { state: "deferred", code: "external-only-pool-unavailable" });
  assert.equal(compiled.diagnostics[0]?.code, "external-only-pool-unavailable");
  assert.equal(compiled.activationReady, false);
});

test("direct-fallback precedence wins over multi-VPS selector deferral", () => {
  const compiled = compileServiceCatalog(catalog([
    { id: "fallback-multi", label: "Fallback multi", domains: [{ match: "exact", value: "fallback-multi.example.com" }], workIn: "lan-only", routeTo: { kind: "vps-pool", allowedVpsIds: ["dual-b", "dual"], onNoHealthyTarget: "direct" } },
  ]), { targets, activePublicDnsEdgeId: "edge-a" });

  assert.deepEqual(compiled.rules[0]?.activation, { state: "deferred", code: "direct-fallback-unavailable" });
  assert.equal(compiled.diagnostics[0]?.code, "direct-fallback-unavailable");
});

test("unknown or incompatible target capabilities are configuration errors", () => {
  const unknown = catalog([{ id: "unknown-service", label: "Unknown", domains: [{ match: "exact", value: "unknown.example.com" }], workIn: "external", routeTo: { kind: "vps-pool", allowedVpsIds: ["missing"], onNoHealthyTarget: "servfail" } }]);
  assert.throws(() => compileServiceCatalog(unknown, { targets, activePublicDnsEdgeId: null }), /references unknown VPS missing/);

  const incompatible = catalog([{ id: "incompatible-service", label: "Incompatible", domains: [{ match: "exact", value: "incompatible.example.com" }], workIn: "lan-only", routeTo: { kind: "vps-pool", allowedVpsIds: ["edge-a"], onNoHealthyTarget: "servfail" } }]);
  assert.throws(() => compileServiceCatalog(incompatible, { targets, activePublicDnsEdgeId: null }), /does not support LAN egress/);
});

test("reordering inputs yields deeply equal output without mutating inputs", () => {
  const services: ServiceCatalog["services"] = [
    { id: "z-service", label: "Z", domains: [{ match: "suffix", value: "z.example.com" }, { match: "exact", value: "z.example.net" }], workIn: "both", routeTo: { kind: "vps-pool", allowedVpsIds: ["dual-b", "dual"], onNoHealthyTarget: "servfail" } },
    { id: "a-service", label: "A", domains: [{ match: "exact", value: "a.example.com" }], workIn: "lan-only", routeTo: { kind: "direct" } },
  ];
  const first = catalog(services);
  const second = catalog([
    { ...services[1], domains: [...services[1].domains].reverse() },
    { ...services[0], domains: [...services[0].domains].reverse(), routeTo: { ...services[0].routeTo, allowedVpsIds: [...services[0].routeTo.allowedVpsIds].reverse() } },
  ]);
  const firstBefore = structuredClone(first);
  const secondBefore = structuredClone(second);
  const output1 = compileServiceCatalog(first, { targets: [...targets], activePublicDnsEdgeId: "edge-a" });
  const output2 = compileServiceCatalog(second, { targets: [...targets].reverse(), activePublicDnsEdgeId: "edge-a" });
  assert.deepEqual(output1, output2);
  assert.deepEqual(first, firstBefore);
  assert.deepEqual(second, secondBefore);
});

test("diagnostics are one-to-one with deferred rules and follow compiled rule order", () => {
  const compiled = compileServiceCatalog(catalog([
    { id: "inactive-edge", label: "Inactive edge", domains: [{ match: "exact", value: "deferred.example.com" }], workIn: "external", routeTo: { kind: "vps-pool", allowedVpsIds: ["edge-a"], onNoHealthyTarget: "servfail" } },
    { id: "multi-lan", label: "Multi LAN", domains: [{ match: "exact", value: "multi.example.com" }], workIn: "lan-only", routeTo: { kind: "vps-pool", allowedVpsIds: ["dual-b", "dual"], onNoHealthyTarget: "direct" } },
    { id: "multi-external", label: "Multi external", domains: [{ match: "suffix", value: "multi.example.net" }], workIn: "external", routeTo: { kind: "vps-pool", allowedVpsIds: ["edge-b", "edge-a"], onNoHealthyTarget: "direct" } },
  ]), { targets, activePublicDnsEdgeId: "edge-b" });

  const deferredRules = compiled.rules.filter((rule) => rule.activation.state === "deferred");
  assert.equal(compiled.activationReady, false);
  assert.equal(compiled.diagnostics.length, deferredRules.length);
  assert.deepEqual(compiled.diagnostics.map(({ code, serviceId, scope, domain }) => ({ code, serviceId, scope, domain })), deferredRules.map((rule) => ({
    code: rule.activation.state === "deferred" ? rule.activation.code : undefined,
    serviceId: rule.serviceId,
    scope: rule.scope,
    domain: rule.domain,
  })));
});
