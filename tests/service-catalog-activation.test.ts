import assert from "node:assert/strict";
import test from "node:test";

import { compileServiceCatalog, type CompiledServiceCatalog } from "../src/service-catalog-compiler.js";
import { lowerActivationReadyCatalog } from "../src/service-catalog-activation.js";
import type { ServiceCatalog, ServiceTargetCapability } from "../src/service-catalog.js";

const targets: ServiceTargetCapability[] = [
  { id: "edge-a", publicDnsEdge: true, lanEgress: true, lanBalancerTag: "edge-a-lan" },
];

function catalog(services: ServiceCatalog["services"]): ServiceCatalog {
  return { schemaVersion: 2, updatedAt: "2026-07-19T00:00:00.000Z", description: "activation test", services };
}

function compile(services: ServiceCatalog["services"]): CompiledServiceCatalog {
  return compileServiceCatalog(catalog(services), { targets, activePublicDnsEdgeId: "edge-a" });
}

test("every deferred activation reason blocks lowering", () => {
  const cases: Array<[string, ServiceCatalog["services"][number], string]> = [
    ["multi", { id: "multi", label: "Multi", domains: [{ match: "exact", value: "multi.example.com" }], workIn: "lan-only", routeTo: { kind: "vps-pool", allowedVpsIds: ["edge-a", "edge-a-2"], onNoHealthyTarget: "servfail" } }, "multi-VPS"],
    ["external", { id: "external", label: "External", domains: [{ match: "exact", value: "external.example.com" }], workIn: "external", routeTo: { kind: "vps-pool", allowedVpsIds: ["edge-a"], onNoHealthyTarget: "servfail" } }, "external-only"],
    ["fallback", { id: "fallback", label: "Fallback", domains: [{ match: "exact", value: "fallback.example.com" }], workIn: "lan-only", routeTo: { kind: "vps-pool", allowedVpsIds: ["edge-a"], onNoHealthyTarget: "direct" } }, "direct-fallback"],
    ["inactive", { id: "inactive", label: "Inactive", domains: [{ match: "exact", value: "inactive.example.com" }], workIn: "both", routeTo: { kind: "vps-pool", allowedVpsIds: ["edge-a"], onNoHealthyTarget: "servfail" } }, "public-target"],
  ];
  for (const [, service, diagnostic] of cases) {
    const environmentTargets = service.routeTo.kind === "vps-pool" && service.routeTo.allowedVpsIds.includes("edge-a-2")
      ? [...targets, { id: "edge-a-2", publicDnsEdge: true, lanEgress: true, lanBalancerTag: "edge-a-2-lan" }]
      : targets;
    const compiled = compileServiceCatalog(catalog([service]), { targets: environmentTargets, activePublicDnsEdgeId: service.id === "inactive" ? "edge-a-2" : "edge-a" });
    assert.equal(compiled.activationReady, false);
    assert.throws(() => lowerActivationReadyCatalog(compiled), new RegExp(diagnostic));
  }
});

test("both-scope pool projects LAN balancer and active public target together", () => {
  const projection = lowerActivationReadyCatalog(compile([
    { id: "both", label: "Both", domains: [{ match: "suffix", value: "both.example.com" }], workIn: "both", routeTo: { kind: "vps-pool", allowedVpsIds: ["edge-a"], onNoHealthyTarget: "servfail" } },
  ]));
  assert.deepEqual(projection.domains, [{
    serviceId: "both", match: "suffix", domain: "both.example.com",
    lan: { kind: "proxy", targetId: "edge-a", balancerTag: "edge-a-lan" },
    external: { kind: "proxy", targetId: "edge-a", profileId: "public" },
  }]);
});

test("mixed supported suffix and exact LAN proxy rules cannot lower partially", () => {
  const compiled = compile([
    { id: "mixed", label: "Mixed", domains: [{ match: "suffix", value: "suffix.example.com" }, { match: "exact", value: "exact.example.com" }], workIn: "lan-only", routeTo: { kind: "vps-pool", allowedVpsIds: ["edge-a"], onNoHealthyTarget: "servfail" } },
  ]);

  assert.equal(compiled.rules.find((rule) => rule.match === "suffix")?.activation.state, "ready");
  assert.deepEqual(compiled.rules.find((rule) => rule.match === "exact")?.activation, { state: "deferred", code: "lan-exact-proxy-unrepresentable" });
  assert.throws(() => lowerActivationReadyCatalog(compiled), /service catalog activation is not ready/);
});

test("projection rejects a forged ready exact LAN proxy rule", () => {
  const compiled = compile([{ id: "forged", label: "Forged", domains: [{ match: "suffix", value: "forged.example.com" }], workIn: "lan-only", routeTo: { kind: "vps-pool", allowedVpsIds: ["edge-a"], onNoHealthyTarget: "servfail" } }]);
  const rule = compiled.rules[0]!;
  rule.match = "exact";
  assert.throws(() => lowerActivationReadyCatalog(compiled), /unsupported ready LAN exact proxy rule/);
});

test("direct projects neither target nor balancer", () => {
  const projection = lowerActivationReadyCatalog(compile([
    { id: "direct", label: "Direct", domains: [{ match: "exact", value: "direct.example.com" }], workIn: "both", routeTo: { kind: "direct" } },
  ]));
  assert.deepEqual(projection.domains[0], {
    serviceId: "direct", match: "exact", domain: "direct.example.com",
    lan: { kind: "direct" }, external: { kind: "direct" },
  });
});

test("regroups and orders exact/suffix domains deterministically", () => {
  const projection = lowerActivationReadyCatalog(compile([
    { id: "z", label: "Z", domains: [{ match: "suffix", value: "example.com" }, { match: "exact", value: "z.example.net" }], workIn: "both", routeTo: { kind: "direct" } },
    { id: "a", label: "A", domains: [{ match: "suffix", value: "deep.example.com" }, { match: "exact", value: "a.example.net" }], workIn: "both", routeTo: { kind: "direct" } },
  ]));
  assert.deepEqual(projection.domains.map(({ serviceId, match, domain }) => `${match}:${domain}:${serviceId}`), [
    "exact:a.example.net:a", "exact:z.example.net:z", "suffix:deep.example.com:a", "suffix:example.com:z",
  ]);
});

test("malformed and conflicting ready bindings reject", () => {
  const malformed = compile([{ id: "bad", label: "Bad", domains: [{ match: "exact", value: "bad.example.com" }], workIn: "lan-only", routeTo: { kind: "direct" } }]);
  malformed.rules[0]!.activation = { state: "ready", binding: { kind: "lan-balancer", targetId: "edge-a", balancerTag: "" } };
  assert.throws(() => lowerActivationReadyCatalog(malformed), /malformed ready binding/);

  const conflicting = compile([{ id: "same", label: "Same", domains: [{ match: "exact", value: "same.example.com" }], workIn: "lan-only", routeTo: { kind: "direct" } }]);
  conflicting.rules.push({ ...conflicting.rules[0]! });
  assert.throws(() => lowerActivationReadyCatalog(conflicting), /conflicting duplicate lan route/);
});

test("disabled services have no projection after compile", () => {
  const projection = lowerActivationReadyCatalog(compile([{ id: "off", label: "Off", enabled: false, domains: [{ match: "exact", value: "off.example.com" }], workIn: "both", routeTo: { kind: "direct" } }]));
  assert.deepEqual(projection.domains, []);
});

test("reordered inputs produce equal projection without mutation", () => {
  const services: ServiceCatalog["services"] = [
    { id: "z", label: "Z", domains: [{ match: "suffix", value: "z.example.com" }, { match: "suffix", value: "z.example.net" }], workIn: "both", routeTo: { kind: "vps-pool", allowedVpsIds: ["edge-a"], onNoHealthyTarget: "servfail" } },
    { id: "a", label: "A", domains: [{ match: "exact", value: "a.example.com" }], workIn: "lan-only", routeTo: { kind: "direct" } },
  ];
  const first = compile(services);
  const second = compile([...services].reverse().map((service) => ({ ...service, domains: [...service.domains].reverse() })));
  const before = structuredClone(first);
  assert.deepEqual(lowerActivationReadyCatalog(first), lowerActivationReadyCatalog(second));
  assert.deepEqual(first, before);
});
